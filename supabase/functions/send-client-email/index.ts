import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWorkshopFeatures } from "../_shared/features.ts";
import { assertSafeHeaderValue, bytesToBase64, EmailValidationError, parseAddressList } from "../_shared/mime.ts";
import { buildEmailFragment, buildEmailHtml, toGraphRecipients } from "../_shared/mail.ts";
import { accessTokenFor, graph, GraphError, type MailboxRow, MailboxDisconnectedError } from "../_shared/microsoftGraph.ts";

// Sends an email to a client from the seller's own Outlook (F4):
// - kind 'quote': the official quote with its PDF; the first time it also
//   marks the quote as sent, like "Marcar como enviada".
// - kind 'answer': a reply to an email in contact_emails, in the same thread.
// The sent message is stored in contact_emails right away (same id the sync
// later finds in Sent Items, so it is never duplicated).
//
// POST { kind, quote_id?, reply_to_email_id?, to, cc?, subject, message }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const MAX_RECIPIENTS = 10;
const MAX_MESSAGE = 10_000;
const MAX_PDF_BYTES = 3 * 1024 * 1024; // Graph limit for attachments sent inline

interface GraphMessage {
  id: string;
  conversationId?: string | null;
  internetMessageId?: string | null;
  body?: { contentType?: string; content?: string };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json(401, { error: 'Unauthorized' });
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const { data: auth } = await userClient.auth.getUser();
    if (!auth?.user) return json(401, { error: 'Unauthorized' });

    const body = await req.json().catch(() => ({}));
    const kind = body.kind === 'answer' ? 'answer' : 'quote';

    // What is being answered / sent, read as the caller (row-level security).
    // deno-lint-ignore no-explicit-any
    let quote: Record<string, any> | null = null;
    // deno-lint-ignore no-explicit-any
    let original: Record<string, any> | null = null;
    if (kind === 'answer') {
      if (!body.reply_to_email_id) return json(400, { error: 'Falta el correo a responder' });
      const { data } = await userClient.from('contact_emails').select('*').eq('id', body.reply_to_email_id).maybeSingle();
      if (!data) return json(404, { error: 'Correo no encontrado' });
      original = data;
      if (data.quote_id) {
        const { data: q } = await userClient.from('quotes').select('*').eq('id', data.quote_id).maybeSingle();
        quote = q;
      }
    } else {
      if (!body.quote_id) return json(400, { error: 'Falta la cotización' });
      const { data } = await userClient.from('quotes').select('*').eq('id', body.quote_id).maybeSingle();
      if (!data) return json(404, { error: 'Cotización no encontrada' });
      quote = data;
      if (data.status !== 'issued' && data.status !== 'sent') {
        return json(409, { error: 'Solo se envía una cotización oficial vigente (ni borrador, ni cerrada, ni anulada)' });
      }
      if (!data.pdf_path) return json(409, { error: 'Primero crea el PDF de la cotización' });
    }

    const workshopId = (quote?.workshop_id ?? original!.workshop_id) as string;
    const contactId = (quote?.contact_id ?? original!.contact_id) as string;
    const { data: allowed } = await userClient.rpc('can_work_quote', { _workshop_id: workshopId, _contact_id: contactId });
    if (allowed !== true) return json(403, { error: 'Acceso denegado' });
    if (!(await fetchWorkshopFeatures(supabase, workshopId)).commercial) return json(403, { error: 'Módulo comercial no activo' });

    // Inputs.
    const to = parseAddressList(body.to ?? '', 'Para');
    const cc = body.cc && (Array.isArray(body.cc) ? body.cc.length : String(body.cc).trim()) ? parseAddressList(body.cc, 'Copia') : [];
    if (to.length + cc.length > MAX_RECIPIENTS) return json(400, { error: `Máximo ${MAX_RECIPIENTS} destinatarios` });
    const subject = String(body.subject ?? '').trim();
    assertSafeHeaderValue(subject, 'Asunto');
    if (!subject || subject.length > 200) return json(400, { error: 'Escribe un asunto (máximo 200 caracteres)' });
    const message = String(body.message ?? '').trim();
    if (!message || message.length > MAX_MESSAGE) return json(400, { error: 'Escribe el mensaje' });

    // The caller's own mailbox.
    const { data: mailboxRow } = await supabase.from('staff_mailboxes')
      .select('user_id, workshop_id, email, access_token, refresh_token, token_expires_at, inbox_synced_until, sent_synced_until, status')
      .eq('user_id', auth.user.id).maybeSingle();
    if (!mailboxRow || mailboxRow.workshop_id !== workshopId) return json(409, { error: 'Conecta tu correo de Outlook para enviar desde el panel.' });
    const mailbox = mailboxRow as MailboxRow;
    let token: string;
    try {
      token = await accessTokenFor(supabase, mailbox);
    } catch (err) {
      if (err instanceof MailboxDisconnectedError) return json(409, { error: 'La conexión con Outlook expiró. Vuelve a conectar tu correo.' });
      throw err;
    }

    // Signature from the seller and the company data.
    const [{ data: seller }, { data: settings }, { data: workshop }] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', auth.user.id).maybeSingle(),
      supabase.from('commercial_settings').select('legal_name, phones, email, primary_color').eq('workshop_id', workshopId).maybeSingle(),
      supabase.from('workshops').select('name').eq('id', workshopId).maybeSingle(),
    ]);
    const signature = {
      sellerName: seller?.full_name ?? null,
      sellerEmail: mailbox.email,
      companyName: (settings?.legal_name || workshop?.name || '').trim() || null,
      phones: (settings?.phones ?? []) as string[],
      companyEmail: settings?.email ?? null,
    };
    const color = settings?.primary_color ?? undefined;

    // Build the draft in the seller's mailbox, then send it.
    let draft: GraphMessage;
    let attachmentMeta: Array<{ filename: string; content_type: string; size: number; path: string }> = [];
    const answeringOwnMessage = kind === 'answer' && original!.mailbox_email === mailbox.email.toLowerCase();

    if (answeringOwnMessage) {
      // A real reply keeps the thread (and the quoted history) in the client's inbox.
      draft = await graph<GraphMessage>(token, `/me/messages/${encodeURIComponent(original!.provider_message_id)}/createReply`, {
        body: { message: { toRecipients: toGraphRecipients(to), ccRecipients: toGraphRecipients(cc) } },
      });
      const quoted = draft.body?.content ?? '';
      await graph(token, `/me/messages/${encodeURIComponent(draft.id)}`, {
        method: 'PATCH',
        body: { subject, body: { contentType: 'HTML', content: `${buildEmailFragment(message, signature, color)}<br>${quoted}` } },
      });
    } else {
      // New message (the quote, or an answer to an email that is in a colleague's mailbox).
      const attachments: unknown[] = [];
      if (kind === 'quote') {
        const { data: pdf, error: pdfError } = await supabase.storage.from('quotations').download(quote!.pdf_path);
        if (pdfError || !pdf) return json(500, { error: 'No se pudo leer el PDF de la cotización' });
        const bytes = new Uint8Array(await pdf.arrayBuffer());
        if (bytes.length > MAX_PDF_BYTES) return json(413, { error: 'El PDF pesa más de 3 MB; descárgalo y envíalo desde Outlook' });
        const filename = `${quote!.quote_number}.pdf`;
        attachments.push({ '@odata.type': '#microsoft.graph.fileAttachment', name: filename, contentType: 'application/pdf', contentBytes: bytesToBase64(bytes) });
        attachmentMeta = [{ filename, content_type: 'application/pdf', size: bytes.length, path: quote!.pdf_path }];
      }
      draft = await graph<GraphMessage>(token, '/me/messages', {
        body: {
          subject,
          body: { contentType: 'HTML', content: buildEmailHtml(message, signature, color) },
          toRecipients: toGraphRecipients(to),
          ccRecipients: toGraphRecipients(cc),
          attachments: attachments.length ? attachments : undefined,
        },
      });
    }

    await graph(token, `/me/messages/${encodeURIComponent(draft.id)}/send`, { method: 'POST' });

    const requestId = quote?.service_request_id ?? original?.service_request_id ?? null;
    const { error: insertError } = await supabase.from('contact_emails').insert({
      workshop_id: workshopId,
      contact_id: contactId,
      mailbox_user_id: auth.user.id,
      mailbox_email: mailbox.email.toLowerCase(),
      service_request_id: requestId,
      quote_id: quote?.id ?? null,
      provider_message_id: draft.id,
      internet_message_id: draft.internetMessageId ?? null,
      conversation_id: draft.conversationId ?? original?.conversation_id ?? null,
      direction: 'out',
      from_address: mailbox.email.toLowerCase(),
      from_name: seller?.full_name ?? null,
      to_addresses: to,
      cc_addresses: cc,
      subject,
      body_text: message,
      attachments: attachmentMeta,
      sent_at: new Date().toISOString(),
      sent_from_panel: true,
      kind,
    });
    if (insertError && insertError.code !== '23505') console.error('contact_emails insert failed:', insertError);

    // Answering a client means their earlier emails are handled.
    if (kind === 'answer') await userClient.rpc('mark_contact_emails_read', { _contact_id: contactId });

    let markedSent = false;
    let warning: string | null = null;
    if (kind === 'quote' && quote!.status === 'issued') {
      const { error: markError } = await userClient.rpc('mark_quote_sent', { _quote_id: quote!.id, _sent_via: 'email' });
      if (markError) warning = `El correo salió, pero no se pudo marcar como enviada: ${markError.message}`;
      else markedSent = true;
    }

    return json(200, { ok: true, marked_sent: markedSent, warning, from: mailbox.email });
  } catch (error) {
    if (error instanceof EmailValidationError) return json(400, { error: error.message });
    if (error instanceof GraphError) {
      console.error('Graph error:', error.status, error.code, error.message);
      return json(502, { error: `Outlook no aceptó el envío: ${error.message}` });
    }
    console.error('send-client-email error:', error);
    return json(500, { error: error instanceof Error ? error.message : 'Error inesperado' });
  }
});
