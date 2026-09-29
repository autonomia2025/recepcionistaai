import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWorkshopFeatures } from "../_shared/features.ts";
import { assertSafeHeaderValue, bytesToBase64, EmailValidationError, parseAddressList } from "../_shared/mime.ts";
import {
  buildEmailHtml, buildEmailText, formatFrom, newReplyToken, replyAddress, senderDisplayName,
} from "../_shared/quoteEmail.ts";
import { resendRequest } from "../_shared/resend.ts";

// Sends an official quote to the customer by email from the panel (F4), or an
// answer in the same thread. Mail goes out through Resend from the business's
// verified subdomain; replies come back to r-<token>@<domain> and the
// resend-webhook function attaches them to the quote.
//
// POST { quote_id, to, cc?, subject, message, kind?: 'quote' | 'answer', copy_to_me?: boolean }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const MAX_RECIPIENTS = 10;
const MAX_MESSAGE = 10_000;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json(401, { error: 'Unauthorized' });
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const { data: auth, error: authError } = await userClient.auth.getUser();
    if (authError || !auth?.user) return json(401, { error: 'Unauthorized' });

    const body = await req.json().catch(() => ({}));
    const kind = body.kind === 'answer' ? 'answer' : 'quote';
    if (!body.quote_id) return json(400, { error: 'Falta la cotización' });

    // Read the quote as the caller: row-level security decides if they may see it.
    const { data: quote } = await userClient.from('quotes').select('*').eq('id', body.quote_id).maybeSingle();
    if (!quote) return json(404, { error: 'Cotización no encontrada' });
    const { data: allowed } = await userClient.rpc('can_work_quote', { _workshop_id: quote.workshop_id, _contact_id: quote.contact_id });
    if (allowed !== true) return json(403, { error: 'Acceso denegado' });
    if (!(await fetchWorkshopFeatures(supabase, quote.workshop_id)).commercial) return json(403, { error: 'Módulo comercial no activo' });

    // Inputs.
    const to = parseAddressList(body.to ?? '', 'Para');
    const cc = body.cc && (Array.isArray(body.cc) ? body.cc.length : String(body.cc).trim()) ? parseAddressList(body.cc, 'Copia') : [];
    if (to.length + cc.length > MAX_RECIPIENTS) return json(400, { error: `Máximo ${MAX_RECIPIENTS} destinatarios` });
    const subject = String(body.subject ?? '').trim();
    assertSafeHeaderValue(subject, 'Asunto');
    if (!subject || subject.length > 200) return json(400, { error: 'Escribe un asunto (máximo 200 caracteres)' });
    const message = String(body.message ?? '').trim();
    if (!message || message.length > MAX_MESSAGE) return json(400, { error: 'Escribe el mensaje' });

    if (kind === 'quote') {
      if (quote.status !== 'issued' && quote.status !== 'sent') {
        return json(409, { error: 'Solo se envía una cotización oficial vigente (ni borrador, ni cerrada, ni anulada)' });
      }
      if (!quote.pdf_path) return json(409, { error: 'Primero crea el PDF de la cotización' });
    }

    // Sending domain must be verified in Resend.
    const { data: mailDomain } = await supabase.from('workshop_email_domains').select('*').eq('workshop_id', quote.workshop_id).maybeSingle();
    if (!mailDomain || mailDomain.status !== 'verified') {
      return json(409, { error: 'El correo de cotizaciones todavía no está listo. Un administrador debe terminar la configuración en Configuración comercial.' });
    }

    // Thread: every email of a quote shares one reply token; answers point to the last customer reply.
    const { data: previous } = await supabase.from('quote_emails').select('reply_token').eq('quote_id', quote.id)
      .order('created_at', { ascending: true }).limit(1).maybeSingle();
    if (kind === 'answer' && !previous) return json(409, { error: 'Esta cotización todavía no se ha enviado por correo' });
    const token = previous?.reply_token ?? newReplyToken();

    let threadHeaders: Record<string, string> | undefined;
    if (kind === 'answer') {
      const { data: lastReply } = await supabase.from('quote_email_replies').select('message_id').eq('quote_id', quote.id)
        .not('message_id', 'is', null).order('received_at', { ascending: false }).limit(1).maybeSingle();
      if (lastReply?.message_id && /^<[^<>\s]+>$/.test(lastReply.message_id)) {
        threadHeaders = { 'In-Reply-To': lastReply.message_id, References: lastReply.message_id };
      }
    }

    // Who signs.
    const [{ data: seller }, { data: settings }, { data: workshop }] = await Promise.all([
      supabase.from('profiles').select('full_name, email').eq('id', auth.user.id).maybeSingle(),
      supabase.from('commercial_settings').select('legal_name, phones, email, primary_color').eq('workshop_id', quote.workshop_id).maybeSingle(),
      supabase.from('workshops').select('name').eq('id', quote.workshop_id).maybeSingle(),
    ]);
    const companyName = (settings?.legal_name || workshop?.name || '').trim() || null;
    const signature = {
      sellerName: seller?.full_name ?? null,
      sellerEmail: seller?.email ?? null,
      companyName,
      phones: (settings?.phones ?? []) as string[],
      companyEmail: settings?.email ?? null,
    };

    const fromAddress = `${mailDomain.sender_local}@${mailDomain.domain}`;
    const replyTo = replyAddress(token, mailDomain.domain);
    const from = formatFrom(senderDisplayName(seller?.full_name, companyName), fromAddress);

    // The official PDF, exactly as stored.
    let attachments: Array<{ filename: string; content: string; content_type: string }> | undefined;
    let attachmentName: string | null = null;
    if (kind === 'quote') {
      const { data: pdf, error: pdfError } = await supabase.storage.from('quotations').download(quote.pdf_path);
      if (pdfError || !pdf) return json(500, { error: 'No se pudo leer el PDF de la cotización' });
      attachmentName = `${quote.quote_number}.pdf`;
      attachments = [{ filename: attachmentName, content: bytesToBase64(new Uint8Array(await pdf.arrayBuffer())), content_type: 'application/pdf' }];
    }

    const copyToMe = body.copy_to_me !== false && seller?.email && !to.includes(seller.email) && !cc.includes(seller.email);

    // Record first, so a crash never loses track of an email that went out.
    const { data: row, error: insertError } = await supabase.from('quote_emails').insert({
      workshop_id: quote.workshop_id,
      quote_id: quote.id,
      service_request_id: quote.service_request_id,
      kind,
      sent_by: auth.user.id,
      from_address: from,
      reply_to_address: replyTo,
      to_addresses: to,
      cc_addresses: cc,
      subject,
      body_text: message,
      attachment_name: attachmentName,
      reply_token: token,
    }).select('id').single();
    if (insertError || !row) throw insertError ?? new Error('No se pudo registrar el correo');

    const sent = await resendRequest<{ id: string }>('/emails', {
      idempotencyKey: `quote-email-${row.id}`,
      body: {
        from,
        to,
        cc: cc.length ? cc : undefined,
        bcc: copyToMe ? [seller!.email] : undefined,
        reply_to: replyTo,
        subject,
        html: buildEmailHtml(message, signature, settings?.primary_color ?? undefined),
        text: buildEmailText(message, signature),
        attachments,
        headers: threadHeaders,
        tags: [{ name: 'quote_email_id', value: row.id }],
      },
    });

    if (!sent.ok || !sent.data?.id) {
      await supabase.from('quote_emails').update({ status: 'failed', status_detail: sent.error }).eq('id', row.id);
      await supabase.from('health_logs').insert({
        workshop_id: quote.workshop_id, event_type: 'email_failed', category: 'quote_email',
        message: `No se pudo enviar ${quote.quote_number ?? 'la cotización'}: ${sent.error}`,
        metadata: { quote_email_id: row.id, to },
      });
      return json(502, { error: `El correo no salió: ${sent.error}` });
    }

    await supabase.from('quote_emails').update({ status: 'sent', provider_email_id: sent.data.id }).eq('id', row.id);

    // First send of an official quote moves it (and the request) to "sent",
    // exactly like the "Marcar como enviada" button, as the caller.
    let markedSent = false;
    let warning: string | null = null;
    if (kind === 'quote' && quote.status === 'issued') {
      const { error: markError } = await userClient.rpc('mark_quote_sent', { _quote_id: quote.id, _sent_via: 'email' });
      if (markError) warning = `El correo salió, pero no se pudo marcar como enviada: ${markError.message}`;
      else markedSent = true;
    }

    return json(200, { ok: true, quote_email_id: row.id, marked_sent: markedSent, warning });
  } catch (error) {
    if (error instanceof EmailValidationError) return json(400, { error: error.message });
    console.error('send-quote-email error:', error);
    return json(500, { error: error instanceof Error ? error.message : 'Error inesperado' });
  }
});
