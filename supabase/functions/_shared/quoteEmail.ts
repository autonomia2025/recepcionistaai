// Pure helpers for quotes sent by email (F4): reply addresses, the Resend
// webhook signature, the message body and the customer's reply text.
// No Deno-only APIs, so the unit tests run them as they are.

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const LOCAL_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const REPLY_PREFIX = 'r-';

// "https://www.Soc.cl/" or "ventas@cotizaciones.soc.cl" -> "soc.cl" / "cotizaciones.soc.cl"
export function normalizeDomain(input: string): string | null {
  let value = String(input ?? '').trim().toLowerCase();
  value = value.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
  if (value.includes('@')) value = value.slice(value.lastIndexOf('@') + 1);
  value = value.replace(/\.$/, '');
  if (value.length > 200 || !DOMAIN_RE.test(value)) return null;
  return value;
}

export function isValidSenderLocal(value: string): boolean {
  return LOCAL_RE.test(value) && !value.startsWith(REPLY_PREFIX);
}

// 24 random characters from [a-z0-9]: not guessable, safe in an address.
export function newReplyToken(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export const replyAddress = (token: string, domain: string) => `${REPLY_PREFIX}${token}@${domain}`;

// Finds our token among the addresses a reply was sent to ("Name <r-abc@x>" too).
export function extractReplyToken(addresses: unknown[], domain: string): string | null {
  const suffix = `@${domain.toLowerCase()}`;
  for (const raw of addresses) {
    if (typeof raw !== 'string') continue;
    const match = raw.match(/<([^>]+)>/);
    const address = (match ? match[1] : raw).trim().toLowerCase();
    if (!address.endsWith(suffix) || !address.startsWith(REPLY_PREFIX)) continue;
    const token = address.slice(REPLY_PREFIX.length, -suffix.length);
    if (/^[a-z0-9]{16,40}$/.test(token)) return token;
  }
  return null;
}

// "Jorge Pérez · SOC Ingeniería" <cotizaciones@cotizaciones.soc.cl>
export function formatFrom(displayName: string, address: string): string {
  const clean = displayName.replace(/[\r\n"<>\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return clean ? `"${clean}" <${address}>` : address;
}

export function senderDisplayName(sellerName: string | null | undefined, companyName: string | null | undefined): string {
  const seller = (sellerName ?? '').trim();
  const company = (companyName ?? '').trim();
  if (seller && company) return `${seller} · ${company}`;
  return seller || company;
}

// ---------------------------------------------------------------------------
// Webhook signature (Svix scheme used by Resend): HMAC-SHA256 over
// "<svix-id>.<svix-timestamp>.<raw body>" with the base64 secret after "whsec_".
const TOLERANCE_SECONDS = 5 * 60;

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyWebhookSignature(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return false;

  let keyBytes: Uint8Array<ArrayBuffer>;
  try {
    keyBytes = base64ToBytes(secret.startsWith('whsec_') ? secret.slice(6) : secret);
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  const expected = bytesToBase64(new Uint8Array(mac));

  return signature.split(' ').some((part) => {
    const [version, value] = part.split(',', 2);
    return version === 'v1' && typeof value === 'string' && timingSafeEqual(value, expected);
  });
}

// ---------------------------------------------------------------------------
// The message the customer receives. The seller writes plain text; we turn it
// into simple, escaped HTML with the company signature.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EmailSignature {
  sellerName: string | null;
  sellerEmail: string | null;
  companyName: string | null;
  phones: string[];
  companyEmail: string | null;
}

export function signatureLines(sig: EmailSignature): string[] {
  const lines: string[] = [];
  if (sig.sellerName) lines.push(sig.sellerName);
  if (sig.companyName) lines.push(sig.companyName);
  const contact = [sig.phones.filter(Boolean).join(' / '), sig.sellerEmail || sig.companyEmail].filter(Boolean).join(' · ');
  if (contact) lines.push(contact);
  return lines;
}

export function buildEmailText(body: string, sig: EmailSignature): string {
  const lines = signatureLines(sig);
  return lines.length ? `${body.trim()}\n\n--\n${lines.join('\n')}` : body.trim();
}

export function buildEmailHtml(body: string, sig: EmailSignature, color = '#1A9387'): string {
  const safeColor = /^#[0-9a-f]{6}$/i.test(color) ? color : '#1A9387';
  const paragraphs = body
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const [first, ...rest] = signatureLines(sig);
  const signature = first
    ? `<p style="margin:22px 0 0;padding-top:14px;border-top:3px solid ${safeColor};color:#444;font-size:13px;line-height:1.5">` +
      `<strong style="color:#222">${escapeHtml(first)}</strong>` +
      rest.map((line) => `<br>${escapeHtml(line)}`).join('') +
      '</p>'
    : '';
  return (
    '<!doctype html><html><body style="margin:0;padding:0;background:#ffffff">' +
    '<div style="max-width:600px;padding:20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222">' +
    paragraphs +
    signature +
    '</div></body></html>'
  );
}

// ---------------------------------------------------------------------------
// The customer's reply: plain text only (we never render their HTML), split
// into what they wrote now and the quoted history below it.
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const QUOTE_MARKERS = [
  /^El .{3,200}escribió:\s*$/i,
  /^On .{3,200}wrote:\s*$/i,
  /^-{2,}\s*(Mensaje original|Original Message)\s*-{2,}/i,
  /^_{5,}\s*$/,
  /^(De|From):\s.+/i,
  /^Enviado desde mi /i,
  /^Sent from my /i,
];

export function splitReply(text: string): { fresh: string; quoted: string | null } {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Gmail sometimes wraps "El ... escribió:" over two lines.
    const joined = i + 1 < lines.length ? `${line} ${lines[i + 1].trim()}` : line;
    if (QUOTE_MARKERS.some((re) => re.test(line)) || /^El .{3,200}escribió:\s*$/i.test(joined) || /^>/.test(line)) {
      cut = i;
      break;
    }
  }
  if (cut <= 0) {
    const fresh = text.trim();
    return cut === 0 ? { fresh: '', quoted: fresh || null } : { fresh, quoted: null };
  }
  const fresh = lines.slice(0, cut).join('\n').trim();
  const quoted = lines.slice(cut).join('\n').trim();
  return { fresh, quoted: quoted || null };
}

// Storage-safe file name that keeps the extension readable.
export function safeFileName(name: string, fallback = 'adjunto'): string {
  const cleaned = String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(-100);
  return cleaned || fallback;
}

// "Nombre Apellido <correo@x.cl>" -> { name, email }
export function parseMailbox(value: string | null | undefined): { name: string | null; email: string | null } {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (match) {
    const name = match[1].replace(/^"|"$/g, '').trim();
    return { name: name || null, email: match[2].trim().toLowerCase() || null };
  }
  return { name: null, email: raw ? raw.toLowerCase() : null };
}

// Status order for delivery events: never go back (e.g. delivered -> sent).
const STATUS_RANK: Record<string, number> = { sending: 0, sent: 1, delayed: 2, delivered: 3, bounced: 4, complained: 4, failed: 4 };
export function nextEmailStatus(current: string, incoming: string): string {
  if (!(incoming in STATUS_RANK)) return current;
  return (STATUS_RANK[incoming] ?? 0) >= (STATUS_RANK[current] ?? 0) ? incoming : current;
}

export const EVENT_STATUS: Record<string, string> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
};
