export class EmailValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmailValidationError'
  }
}

export interface MailAddress {
  email: string
  name?: string | null
}

export interface MailAttachment {
  filename: string
  contentType: string
  content: Uint8Array
}

export interface MimeMessageInput {
  from: MailAddress
  to: string[]
  cc?: string[]
  replyTo?: string
  subject: string
  html: string
  text?: string
  attachments?: MailAttachment[]
  inReplyTo?: string
  references?: string
}

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/
const CONTENT_TYPE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i
const PRINTABLE_ASCII_RE = /^[\x20-\x7E]*$/
const MAX_RECIPIENTS = 50
const encoder = new TextEncoder()

export function assertSafeHeaderValue(value: string, field: string): void {
  if (typeof value !== 'string' || /[\r\n\0]/.test(value)) {
    throw new EmailValidationError(`${field}: no se permiten saltos de línea`)
  }
}

export function parseAddressList(value: string | string[], field: string): string[] {
  const parts = Array.isArray(value) ? value : String(value).split(',')
  const addresses = parts
    .map((part) => {
      assertSafeHeaderValue(part, field)
      return part.trim()
    })
    .filter((part) => part.length > 0)

  if (addresses.length === 0) {
    throw new EmailValidationError(`${field}: falta al menos una dirección`)
  }
  if (addresses.length > MAX_RECIPIENTS) {
    throw new EmailValidationError(`${field}: máximo ${MAX_RECIPIENTS} direcciones`)
  }
  for (const address of addresses) {
    if (address.length > 254 || !EMAIL_RE.test(address)) {
      throw new EmailValidationError(`${field}: dirección inválida "${address}"`)
    }
  }
  return addresses
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join('\r\n') ?? ''
}

function encodeText(value: string): string {
  return wrapBase64(bytesToBase64(encoder.encode(value)))
}

function encodedWord(value: string): string {
  return `=?UTF-8?B?${bytesToBase64(encoder.encode(value))}?=`
}

function formatMailbox({ email, name }: MailAddress): string {
  const [address] = parseAddressList([email], 'from')
  if (!name) return address
  assertSafeHeaderValue(name, 'from_name')
  const displayName = PRINTABLE_ASCII_RE.test(name)
    ? `"${name.replace(/(["\\])/g, '\\$1')}"`
    : encodedWord(name)
  return `${displayName} <${address}>`
}

function asciiHeader(value: string, field: string): string {
  assertSafeHeaderValue(value, field)
  if (!PRINTABLE_ASCII_RE.test(value)) {
    throw new EmailValidationError(`${field}: solo admite caracteres ASCII`)
  }
  return value
}

function attachmentPart(attachment: MailAttachment, boundary: string): string[] {
  assertSafeHeaderValue(attachment.filename, 'attachment filename')
  if (!CONTENT_TYPE_RE.test(attachment.contentType)) {
    throw new EmailValidationError(`attachment content_type inválido: "${attachment.contentType}"`)
  }
  const fallbackName = attachment.filename.replace(/[^\x20-\x7E]|["\\]/g, '_')
  const encodedName = encodeURIComponent(attachment.filename)
    .replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return [
    `--${boundary}`,
    `Content-Type: ${attachment.contentType}; name="${fallbackName}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`,
    '',
    wrapBase64(bytesToBase64(attachment.content)),
  ]
}

export function buildMimeMessage(input: MimeMessageInput): string {
  const headers = [
    `From: ${formatMailbox(input.from)}`,
    `To: ${parseAddressList(input.to, 'to').join(', ')}`,
  ]
  if (input.cc && input.cc.length > 0) {
    headers.push(`Cc: ${parseAddressList(input.cc, 'cc').join(', ')}`)
  }
  if (input.replyTo) {
    headers.push(`Reply-To: ${parseAddressList([input.replyTo], 'reply_to')[0]}`)
  }
  if (input.inReplyTo) headers.push(`In-Reply-To: ${asciiHeader(input.inReplyTo, 'in_reply_to')}`)
  if (input.references) headers.push(`References: ${asciiHeader(input.references, 'references')}`)
  assertSafeHeaderValue(input.subject, 'subject')
  headers.push(`Subject: ${encodedWord(input.subject)}`, 'MIME-Version: 1.0')

  const alternativeBoundary = `alt_${crypto.randomUUID()}`
  const alternativeBody = [
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodeText(input.text || input.subject),
    `--${alternativeBoundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodeText(input.html),
    `--${alternativeBoundary}--`,
  ]

  const attachments = input.attachments ?? []
  if (attachments.length === 0) {
    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
      '',
      ...alternativeBody,
      '',
    ].join('\r\n')
  }

  const mixedBoundary = `mixed_${crypto.randomUUID()}`
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    '',
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    '',
    ...alternativeBody,
    ...attachments.flatMap((attachment) => attachmentPart(attachment, mixedBoundary)),
    `--${mixedBoundary}--`,
    '',
  ].join('\r\n')
}

export function toBase64Url(message: string): string {
  return btoa(message).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
