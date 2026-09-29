// Pure helpers for client email (F4): the message body we send, the text of
// what the client wrote, and which contact an email belongs to.
// No Deno-only APIs, so the unit tests run them as they are.

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

// The message as an HTML fragment (used on its own above a quoted reply).
export function buildEmailFragment(body: string, sig: EmailSignature, color = '#1A9387'): string {
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
    '<div style="max-width:600px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222">' +
    paragraphs +
    signature +
    '</div>'
  );
}

export function buildEmailHtml(body: string, sig: EmailSignature, color = '#1A9387'): string {
  return `<!doctype html><html><body style="margin:0;padding:20px;background:#ffffff">${buildEmailFragment(body, sig, color)}</body></html>`;
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

// ---------------------------------------------------------------------------
// Which contact an email belongs to.
export interface GraphRecipient {
  emailAddress?: { address?: string | null; name?: string | null } | null;
}

export function normalizeAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const address = value.trim().toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address) ? address : null;
}

export function recipientAddresses(list: GraphRecipient[] | null | undefined): string[] {
  const out: string[] = [];
  for (const r of list ?? []) {
    const address = normalizeAddress(r?.emailAddress?.address);
    if (address && !out.includes(address)) out.push(address);
  }
  return out;
}

export function toGraphRecipients(addresses: string[]): GraphRecipient[] {
  return addresses.map((address) => ({ emailAddress: { address } }));
}

export interface ConversationLink {
  contact_id: string;
  quote_id: string | null;
  service_request_id: string | null;
}

export interface MessageForMatch {
  direction: 'in' | 'out';
  conversationId: string | null;
  from: string | null;
  to: string[];
  cc: string[];
}

// A thread the panel already knows wins (e.g. the client answers from another
// address). Otherwise: incoming mail must come FROM a contact; outgoing mail
// must be addressed to one. Nothing else from the mailbox is ever stored.
export function matchMessage(
  msg: MessageForMatch,
  mailboxEmail: string,
  contactsByEmail: Map<string, string>,
  conversations: Map<string, ConversationLink>,
): ConversationLink | null {
  if (msg.conversationId && conversations.has(msg.conversationId)) return conversations.get(msg.conversationId)!;
  const own = mailboxEmail.toLowerCase();
  const candidates = msg.direction === 'in' ? [msg.from] : [...msg.to, ...msg.cc];
  for (const address of candidates) {
    if (!address || address === own) continue;
    const contactId = contactsByEmail.get(address);
    if (contactId) return { contact_id: contactId, quote_id: null, service_request_id: null };
  }
  return null;
}
