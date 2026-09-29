import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bytesToBase64 } from "../_shared/mime.ts";
import {
  buildEmailHtml, buildEmailText, EVENT_STATUS, formatFrom, htmlToText, nextEmailStatus, parseMailbox, safeFileName, splitReply,
  verifyWebhookSignature,
} from "../_shared/quoteEmail.ts";
import { resendRequest } from "../_shared/resend.ts";

// Resend webhook (F4). Signed with the RESEND_WEBHOOK_SECRET secret.
// - email.received: a customer answered a quote email. We match the reply
//   address token, store the reply (plain text + attachments) on the quote,
//   notify the seller in the panel and forward a copy to the seller's inbox.
// - email.sent / delivered / delivery_delayed / bounced / complained / failed:
//   delivery status of the emails sent from the panel.

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_FORWARD_BYTES = 20 * 1024 * 1024;
const APP_URL = (Deno.env.get('APP_URL') || 'https://recepcionistaai.lovable.app').replace(/\/$/, '');

// deno-lint-ignore no-explicit-any
type Supabase = any;

interface ReceivedEmail {
  id: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string | null;
  html: string | null;
  text: string | null;
  headers?: Record<string, string>;
  message_id?: string | null;
  authentication?: { spf?: string; dkim?: string; dmarc?: string } | null;
}

interface ReceivedAttachment {
  id: string;
  filename: string;
  size: number;
  content_type: string;
  content_disposition: string | null;
  content_id: string | null;
  download_url: string;
}

// r-<token>@<domain> among every address the email was delivered to.
function candidateTokens(addresses: unknown[]): Array<{ token: string; domain: string }> {
  const found: Array<{ token: string; domain: string }> = [];
  for (const raw of addresses) {
    if (typeof raw !== 'string') continue;
    const address = (raw.match(/<([^>]+)>/)?.[1] ?? raw).trim().toLowerCase();
    const match = address.match(/^r-([a-z0-9]{16,40})@([a-z0-9.-]+)$/);
    if (match) found.push({ token: match[1], domain: match[2] });
  }
  return found;
}

async function handleStatus(supabase: Supabase, type: string, data: Record<string, unknown>) {
  const emailId = data.email_id as string | undefined;
  if (!emailId) return;
  const { data: row } = await supabase.from('quote_emails')
    .select('id, status, workshop_id, sent_by, quote_id').eq('provider_email_id', emailId).maybeSingle();
  if (!row) return;

  const status = nextEmailStatus(row.status, EVENT_STATUS[type]);
  const bounce = data.bounce as { message?: string } | undefined;
  const detail = type === 'email.bounced' ? bounce?.message ?? 'El correo rebotó'
    : type === 'email.complained' ? 'El destinatario lo marcó como spam'
    : null;
  if (status === row.status && !detail) return;
  await supabase.from('quote_emails').update({ status, ...(detail ? { status_detail: detail } : {}) }).eq('id', row.id);

  if (type === 'email.bounced' && row.status !== 'bounced') {
    const { data: quote } = await supabase.from('quotes').select('quote_number').eq('id', row.quote_id).maybeSingle();
    await supabase.from('notifications').insert({
      workshop_id: row.workshop_id,
      user_id: row.sent_by,
      type: 'quote_email_bounced',
      title: `No se pudo entregar la ${quote?.quote_number ?? 'cotización'}`,
      message: 'El correo del cliente rebotó. Revisa la dirección en la solicitud y envíala de nuevo.',
    });
  }
}

async function forward(input: {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  body: string;
  color?: string;
  attachments: Array<{ filename: string; content: string; content_type: string }>;
  idempotencyKey: string;
}) {
  const sig = { sellerName: null, sellerEmail: null, companyName: null, phones: [], companyEmail: null };
  const result = await resendRequest('/emails', {
    idempotencyKey: input.idempotencyKey,
    body: {
      from: input.from,
      to: [input.to],
      reply_to: input.replyTo,
      subject: input.subject,
      html: buildEmailHtml(input.body, sig, input.color),
      text: buildEmailText(input.body, sig),
      attachments: input.attachments.length ? input.attachments : undefined,
    },
  });
  if (!result.ok) console.error('Forward failed:', result.error);
}

async function handleReceived(supabase: Supabase, data: Record<string, unknown>) {
  const emailId = data.email_id as string | undefined;
  if (!emailId) return;

  const { data: already } = await supabase.from('quote_email_replies').select('id').eq('provider_email_id', emailId).maybeSingle();
  if (already) return;

  const addresses = [
    ...((data.to as unknown[]) || []),
    ...((data.cc as unknown[]) || []),
    ...((data.received_for as unknown[]) || []),
  ];

  // Which quote does it answer?
  // deno-lint-ignore no-explicit-any
  let sentEmail: Record<string, any> | null = null;
  for (const { token, domain } of candidateTokens(addresses)) {
    const { data: rows } = await supabase.from('quote_emails')
      .select('id, workshop_id, quote_id, service_request_id, sent_by, reply_token, from_address, subject')
      .eq('reply_token', token).order('created_at', { ascending: false }).limit(1);
    const candidate = rows?.[0];
    if (!candidate) continue;
    const { data: mailDomain } = await supabase.from('workshop_email_domains').select('domain')
      .eq('workshop_id', candidate.workshop_id).maybeSingle();
    if (mailDomain?.domain === domain) { sentEmail = candidate; break; }
  }

  const full = await resendRequest<ReceivedEmail>(`/emails/receiving/${emailId}`);
  if (!full.ok || !full.data) throw new Error(`No se pudo leer el correo recibido: ${full.error}`);
  const email = full.data;
  const sender = parseMailbox(email.headers?.from ?? email.from);
  const fromAddress = (email.from || sender.email || '').toLowerCase();
  const text = (email.text && email.text.trim()) ? email.text : email.html ? htmlToText(email.html) : '';
  const { fresh, quoted } = splitReply(text);

  if (!sentEmail) {
    // Written to the sender address directly (not a reply): pass it on to the
    // business so nothing is lost.
    const toDomains = addresses.filter((a): a is string => typeof a === 'string').map((a) => (a.match(/<([^>]+)>/)?.[1] ?? a).split('@')[1]?.toLowerCase());
    const { data: owner } = await supabase.from('workshop_email_domains').select('workshop_id, domain, sender_local')
      .in('domain', toDomains.filter(Boolean) as string[]).limit(1).maybeSingle();
    if (!owner) return;
    const { data: settings } = await supabase.from('commercial_settings').select('email, primary_color').eq('workshop_id', owner.workshop_id).maybeSingle();
    await supabase.from('health_logs').insert({
      workshop_id: owner.workshop_id, event_type: 'info', category: 'quote_email',
      message: `Correo recibido sin cotización asociada de ${fromAddress}: ${email.subject ?? '(sin asunto)'}`,
      metadata: { provider_email_id: emailId, forwarded_to: settings?.email ?? null },
    });
    if (settings?.email) {
      await forward({
        from: formatFrom('Panel de cotizaciones', `${owner.sender_local}@${owner.domain}`),
        to: settings.email,
        replyTo: fromAddress,
        subject: `Reenviado: ${email.subject ?? '(sin asunto)'}`,
        body: `${sender.name ? `${sender.name} ` : ''}<${fromAddress}> escribió a ${owner.sender_local}@${owner.domain}:\n\n${text || '(sin texto)'}`,
        color: settings.primary_color ?? undefined,
        attachments: [],
        idempotencyKey: `inbound-orphan-${emailId}`,
      });
    }
    return;
  }

  const replyId = crypto.randomUUID();
  const workshopId = sentEmail.workshop_id as string;

  // Attachments the customer sent (not the inline images of their signature).
  const stored: Array<{ filename: string; content_type: string; size: number; path: string }> = [];
  const forwardFiles: Array<{ filename: string; content: string; content_type: string }> = [];
  let forwardBytes = 0;
  const hasFiles = Array.isArray(data.attachments) && (data.attachments as unknown[]).length > 0;
  if (hasFiles) {
    const list = await resendRequest<{ data: ReceivedAttachment[] }>(`/emails/receiving/${emailId}/attachments`);
    for (const file of list.data?.data ?? []) {
      if (file.content_disposition === 'inline' && file.content_id) continue;
      if (file.size > MAX_ATTACHMENT_BYTES) continue;
      const download = await fetch(file.download_url).catch(() => null);
      if (!download?.ok) continue;
      const bytes = new Uint8Array(await download.arrayBuffer());
      const name = safeFileName(file.filename);
      const path = `${workshopId}/replies/${replyId}/${stored.length + 1}-${name}`;
      const { error } = await supabase.storage.from('quotations').upload(path, bytes, { contentType: file.content_type || 'application/octet-stream' });
      if (error) { console.error('Attachment upload failed:', error); continue; }
      stored.push({ filename: file.filename || name, content_type: file.content_type, size: bytes.length, path });
      if (forwardBytes + bytes.length <= MAX_FORWARD_BYTES) {
        forwardBytes += bytes.length;
        forwardFiles.push({ filename: file.filename || name, content: bytesToBase64(bytes), content_type: file.content_type });
      }
    }
  }

  const auth = email.authentication;
  const { error: insertError } = await supabase.from('quote_email_replies').insert({
    id: replyId,
    workshop_id: workshopId,
    quote_id: sentEmail.quote_id,
    quote_email_id: sentEmail.id,
    service_request_id: sentEmail.service_request_id,
    provider_email_id: emailId,
    message_id: email.message_id ?? (data.message_id as string | undefined) ?? null,
    from_address: fromAddress,
    from_name: sender.name,
    subject: email.subject,
    body_text: fresh || (quoted ? '' : text),
    quoted_text: quoted,
    attachments: stored,
    sender_verified: auth ? auth.dmarc === 'pass' || auth.dkim === 'pass' : null,
  });
  if (insertError) {
    if ((insertError as { code?: string }).code === '23505') return; // a retry already stored it
    throw insertError;
  }

  const [{ data: quote }, { data: seller }, { data: settings }, { data: mailDomain }] = await Promise.all([
    supabase.from('quotes').select('quote_number, client_name, client_company').eq('id', sentEmail.quote_id).maybeSingle(),
    sentEmail.sent_by ? supabase.from('profiles').select('email').eq('id', sentEmail.sent_by).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('commercial_settings').select('primary_color').eq('workshop_id', workshopId).maybeSingle(),
    supabase.from('workshop_email_domains').select('domain, sender_local').eq('workshop_id', workshopId).maybeSingle(),
  ]);
  const who = quote?.client_company || quote?.client_name || sender.name || fromAddress;

  await supabase.from('notifications').insert({
    workshop_id: workshopId,
    user_id: sentEmail.sent_by,
    type: 'quote_reply',
    title: `${who} respondió la ${quote?.quote_number ?? 'cotización'}`,
    message: 'Llegó una respuesta por correo. Está en la solicitud, dentro de la cotización.',
  });

  // Copy to the seller's own inbox; answering it goes straight to the customer.
  if (seller?.email && mailDomain) {
    const files = stored.length
      ? `\n\nAdjuntos: ${stored.map((f) => f.filename).join(', ')}${forwardFiles.length < stored.length ? ' (algunos solo están en el panel por su tamaño)' : ''}`
      : '';
    await forward({
      from: formatFrom(`${who} (vía panel)`, `${mailDomain.sender_local}@${mailDomain.domain}`),
      to: seller.email,
      replyTo: fromAddress,
      subject: `Respuesta a ${quote?.quote_number ?? 'tu cotización'}: ${email.subject ?? ''}`.trim(),
      body: `${who} <${fromAddress}> respondió:\n\n${fresh || text || '(sin texto)'}${files}\n\nTambién quedó guardado en el panel: ${APP_URL}/requests\nSi respondes desde el panel, la conversación queda registrada en la solicitud.`,
      color: settings?.primary_color ?? undefined,
      attachments: forwardFiles,
      idempotencyKey: `inbound-forward-${emailId}`,
    });
  }
}

serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '';
  const raw = await req.text();
  const valid = await verifyWebhookSignature(secret, {
    id: req.headers.get('svix-id'),
    timestamp: req.headers.get('svix-timestamp'),
    signature: req.headers.get('svix-signature'),
  }, raw);
  if (!valid) return json(401, { error: 'Invalid signature' });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const event = JSON.parse(raw) as { type?: string; data?: Record<string, unknown> };
    const type = event.type ?? '';
    const data = event.data ?? {};
    if (type === 'email.received') await handleReceived(supabase, data);
    else if (type in EVENT_STATUS) await handleStatus(supabase, type, data);
    return json(200, { ok: true });
  } catch (error) {
    // 500 makes Resend retry; storing is idempotent by provider_email_id.
    console.error('resend-webhook error:', error);
    return json(500, { error: error instanceof Error ? error.message : 'Error inesperado' });
  }
});
