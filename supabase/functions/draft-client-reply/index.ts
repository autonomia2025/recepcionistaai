import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWorkshopFeatures } from "../_shared/features.ts";
import { askJson } from "../_shared/aiGateway.ts";
import type { QuoteFacts, ThreadEmail } from "../_shared/emailReview.ts";
import { buildReplyPrompt, sanitizeDraft } from "../_shared/replyDraft.ts";

// "Sugerir respuesta" (F5): drafts the seller's next email to a client with
// the thread, the quote, the catalog and the sales playbook. Nothing is sent
// or saved: the seller edits the draft in the send dialog.
//
// POST { contact_id, request_id?, intent: 'answer' | 'follow_up' }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const MODEL = 'google/gemini-3-flash-preview';
const clp = (value: number | null) => (value == null ? null : `$${Math.round(value).toLocaleString('es-CL')}`);

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
    if (!body.contact_id) return json(400, { error: 'Falta el cliente' });
    const intent = body.intent === 'follow_up' ? 'follow_up' : 'answer';

    // Read the client as the caller: row-level security decides.
    const { data: contact } = await userClient.from('contacts').select('id, workshop_id, name, company_name').eq('id', body.contact_id).maybeSingle();
    if (!contact) return json(404, { error: 'Cliente no encontrado' });
    const { data: allowed } = await userClient.rpc('can_work_quote', { _workshop_id: contact.workshop_id, _contact_id: contact.id });
    if (allowed !== true) return json(403, { error: 'Acceso denegado' });
    if (!(await fetchWorkshopFeatures(supabase, contact.workshop_id)).commercial) return json(403, { error: 'Módulo comercial no activo' });

    const { data: emails } = await supabase.from('contact_emails').select('direction, sent_at, subject, body_text, internet_message_id, provider_message_id')
      .eq('contact_id', contact.id).order('sent_at', { ascending: false }).limit(10);
    const seen = new Set<string>();
    const thread: ThreadEmail[] = (emails ?? []).filter(e => {
      const key = e.internet_message_id || e.provider_message_id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).reverse();
    if (intent === 'answer' && !thread.some(e => e.direction === 'in')) return json(409, { error: 'El cliente todavía no ha escrito por correo' });

    // Lead context: request, its latest quote, equipment of interest, WhatsApp summary.
    let requestId: string | null = body.request_id ?? null;
    if (!requestId) {
      const { data: r } = await supabase.from('service_requests').select('id').eq('contact_id', contact.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      requestId = r?.id ?? null;
    }
    const [{ data: request }, { data: settings }, { data: seller }, { data: workshop }, { data: events }, { data: playbook }] = await Promise.all([
      requestId ? supabase.from('service_requests').select('id, conversation_id').eq('id', requestId).eq('contact_id', contact.id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from('commercial_settings').select('legal_name, default_payment_terms, default_delivery_terms, quote_validity_days').eq('workshop_id', contact.workshop_id).maybeSingle(),
      supabase.from('profiles').select('full_name').eq('id', auth.user.id).maybeSingle(),
      supabase.from('workshops').select('name').eq('id', contact.workshop_id).maybeSingle(),
      supabase.from('conversation_product_events').select('sku_normalized').eq('contact_id', contact.id).not('sku_normalized', 'is', null),
      supabase.from('sales_playbook_docs').select('title, content').eq('workshop_id', contact.workshop_id).eq('is_active', true).order('updated_at', { ascending: false }).limit(8),
    ]);

    let quote: QuoteFacts | null = null;
    if (request) {
      const { data: q } = await supabase.from('quotes').select('id, quote_number, net_total, total, validity_days, payment_terms, delivery_terms')
        .eq('service_request_id', request.id).not('status', 'in', '(void,rejected,draft)').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (q) {
        const { data: lines } = await supabase.from('quote_lines').select('description, quantity, unit_price, discount_pct').eq('quote_id', q.id).order('position');
        quote = { number: q.quote_number, lines: lines ?? [], net_total: q.net_total, total: q.total, validity_days: q.validity_days, payment_terms: q.payment_terms, delivery_terms: q.delivery_terms };
      }
    }

    const skus = [...new Set((events ?? []).map(e => e.sku_normalized))];
    const { data: catalog } = skus.length
      ? await supabase.from('product_catalog').select('sku, water_type, motor_type, pressure_bar, flow_lmin, temp_max, price_min, price_max').eq('workshop_id', contact.workshop_id).in('sku_normalized', skus)
      : { data: [] };
    const equipment = (catalog ?? []).map(p =>
      `- ${p.sku}: ${[p.water_type, p.motor_type, p.pressure_bar && `${p.pressure_bar} bar`, p.flow_lmin && `${p.flow_lmin} L/min`, p.temp_max && p.temp_max !== '—' && `máx ${p.temp_max}°C`].filter(Boolean).join(', ')}; precio referencial ${clp(p.price_min) ?? '?'} a ${clp(p.price_max) ?? '?'} neto`).join('\n');

    let summary: string | null = null;
    if (request?.conversation_id) {
      const { data: conversation } = await supabase.from('conversations').select('ai_summary').eq('id', request.conversation_id).maybeSingle();
      summary = conversation?.ai_summary ?? null;
    }

    let budget = 4000;
    const playbookText = (playbook ?? []).map(d => {
      const piece = `### ${d.title}\n${(d.content || '').slice(0, Math.max(0, budget))}`;
      budget -= piece.length;
      return budget > -300 ? piece : '';
    }).filter(Boolean).join('\n\n');

    const ai = await askJson({
      model: MODEL,
      system: 'Eres un vendedor experto en hidrolavadoras industriales. Escribes correos claros que avanzan la venta y nunca inventas datos. Respondes solo JSON válido.',
      prompt: buildReplyPrompt({
        companyName: settings?.legal_name || workshop?.name || null,
        sellerName: seller?.full_name ?? null,
        clientName: contact.name,
        thread,
        quote,
        equipment,
        terms: { payment: settings?.default_payment_terms ?? null, delivery: settings?.default_delivery_terms ?? null, validity: settings?.quote_validity_days ?? null },
        playbook: playbookText,
        whatsappSummary: summary,
        intent,
      }),
    });
    if (!ai.ok) return json(ai.status, { error: ai.error });
    const draft = sanitizeDraft(ai.data);
    if (!draft) return json(502, { error: 'La IA no entregó un borrador útil; intenta de nuevo' });
    return json(200, draft);
  } catch (error) {
    console.error('draft-client-reply error:', error);
    return json(500, { error: error instanceof Error ? error.message : 'Error inesperado' });
  }
});
