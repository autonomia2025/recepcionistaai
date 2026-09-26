import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWorkshopFeatures } from "../_shared/features.ts";
import { PROFILE_LABELS, sanitizeCallGuide } from "../_shared/callGuide.ts";

// "Antes de llamar": a short brief for the seller's first call, drafted by the
// model from the bot conversation and kept only where the customer's own words
// back it up (see _shared/callGuide.ts). Commercial module only.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const MODEL = 'openai/gpt-5-mini';
const clp = (value: number | null) => (value == null ? null : `$${Math.round(value).toLocaleString('es-CL')}`);

function extractJson(raw: string): unknown {
  const text = raw.replace(/```json?|```/g, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json(401, { error: 'Unauthorized' });
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const { data: auth, error: authError } = await userClient.auth.getUser();
    if (authError || !auth?.user) return json(401, { error: 'Unauthorized' });

    const { service_request_id: requestId, force } = await req.json();
    if (!requestId) return json(400, { error: 'Missing service_request_id' });

    // Read the request as the caller: row-level security decides if they may see it.
    const { data: request } = await userClient
      .from('service_requests')
      .select('id, workshop_id, contact_id, conversation_id')
      .eq('id', requestId)
      .maybeSingle();
    if (!request) return json(404, { error: 'Solicitud no encontrada' });

    const { data: allowed } = await userClient.rpc('can_work_quote', { _workshop_id: request.workshop_id, _contact_id: request.contact_id });
    if (allowed !== true) return json(403, { error: 'Acceso denegado' });
    if (!(await fetchWorkshopFeatures(supabase, request.workshop_id)).commercial) return json(403, { error: 'Módulo comercial no activo' });

    let conversationId = request.conversation_id as string | null;
    if (!conversationId) {
      const { data: latest } = await supabase.from('conversations').select('id').eq('contact_id', request.contact_id)
        .order('last_message_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      conversationId = latest?.id ?? null;
    }
    if (!conversationId) return json(200, { guide: null, reason: 'no_conversation' });

    const { data: rows } = await supabase.from('messages').select('direction, text, created_at')
      .eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(80);
    const messages = (rows || []).reverse() as Array<{ direction: string; text: string | null; created_at: string }>;
    const customerMessages = messages.filter(m => m.direction === 'inbound').map(m => m.text || '').filter(Boolean);
    if (customerMessages.length === 0) return json(200, { guide: null, reason: 'no_customer_messages' });
    const lastMessageAt = messages[messages.length - 1]?.created_at ?? null;

    const { data: existing } = await supabase.from('lead_call_guides').select('*').eq('service_request_id', requestId).maybeSingle();
    if (existing && !force) return json(200, { guide: existing });

    const [{ data: contact }, { data: events }, { data: settings }, { data: playbook }] = await Promise.all([
      supabase.from('contacts').select('name, company_name, tax_id, zone').eq('id', request.contact_id).maybeSingle(),
      supabase.from('conversation_product_events').select('event_type, sku_normalized').eq('contact_id', request.contact_id).not('sku_normalized', 'is', null),
      supabase.from('commercial_settings').select('default_payment_terms, default_delivery_terms, quote_validity_days').eq('workshop_id', request.workshop_id).maybeSingle(),
      supabase.from('sales_playbook_docs').select('title, category, content').eq('workshop_id', request.workshop_id).eq('is_active', true).order('updated_at', { ascending: false }).limit(12),
    ]);

    const interest = new Map<string, Set<string>>();
    for (const e of events || []) {
      if (!interest.has(e.sku_normalized)) interest.set(e.sku_normalized, new Set());
      interest.get(e.sku_normalized)!.add(e.event_type);
    }
    const { data: catalog } = interest.size
      ? await supabase.from('product_catalog').select('sku, sku_normalized, water_type, motor_type, pressure_bar, flow_lmin, temp_max, price_min, price_max')
        .eq('workshop_id', request.workshop_id).in('sku_normalized', [...interest.keys()])
      : { data: [] };

    const equipment = (catalog || []).map(p => {
      const how = [...(interest.get(p.sku_normalized) ?? [])].map(t => ({ chosen: 'lo eligió', customer_asked: 'lo preguntó', datasheet_sent: 'recibió la ficha', recommended: 'se lo recomendó el bot' } as Record<string, string>)[t] ?? t).join(', ');
      return `- ${p.sku}: ${[p.water_type, p.motor_type, p.pressure_bar && `${p.pressure_bar} bar`, p.flow_lmin && `${p.flow_lmin} L/min`, p.temp_max && p.temp_max !== '—' && `máx ${p.temp_max}°C`].filter(Boolean).join(', ')}; precio referencial ${clp(p.price_min) ?? '?'} a ${clp(p.price_max) ?? '?'} neto (${how})`;
    }).join('\n') || '(sin equipos registrados)';

    let budget = 7000;
    const playbookText = (playbook || []).map(d => {
      const piece = `### ${d.title} [${d.category}]\n${(d.content || '').slice(0, Math.max(0, budget))}`;
      budget -= piece.length;
      return budget > -400 ? piece : '';
    }).filter(Boolean).join('\n\n');

    const transcript = messages.map(m => `${m.direction === 'inbound' ? 'CLIENTE' : 'BOT'}: ${(m.text || '').slice(0, 600)}`).join('\n');

    const prompt = `Prepara al vendedor de SOC Ingeniería (hidrolavadoras industriales, Chile) para su PRIMERA llamada con este cliente.

CLIENTE: ${contact?.name ?? '—'}${contact?.company_name ? ` · ${contact.company_name}` : ''}${contact?.zone ? ` · zona ${contact.zone}` : ''}

EQUIPOS DE INTERÉS (datos del catálogo, son la única fuente de especificaciones y precios):
${equipment}

CONDICIONES COMERCIALES DE SOC: pago "${settings?.default_payment_terms ?? 'a convenir'}", entrega "${settings?.default_delivery_terms ?? 'según disponibilidad'}", validez ${settings?.quote_validity_days ?? 15} días.

${playbookText ? `ARGUMENTARIO DE VENTAS DE SOC (úsalo para responder objeciones; cita el título exacto en "source"):\n${playbookText}` : 'ARGUMENTARIO DE VENTAS: no hay documentos cargados; responde con los datos del equipo y "source": null.'}

CONVERSACIÓN CON EL BOT DE WHATSAPP:
${transcript}

Responde SOLO con este JSON:
{
  "opening": "primera frase para abrir la llamada: natural, cercana, en español de Chile, mencionando lo que el cliente necesita",
  "known": [{ "fact": "dato útil para vender, en pocas palabras", "evidence": "frase COPIADA TEXTUAL de un mensaje del CLIENTE que lo respalda" }],
  "missing": ["pregunta concreta que el vendedor debe hacer"],
  "profile": { "label": "uno de: ${PROFILE_LABELS.join(', ')}", "evidence": "frase COPIADA TEXTUAL del CLIENTE que lo muestra" },
  "objections": [{ "objection": "objeción probable", "answer": "cómo responderla en 1-2 frases, con datos concretos del equipo", "source": "título exacto del documento del argumentario usado, o null" }]
}

REGLAS:
- "known": hasta 6. Solo lo que dijo el CLIENTE (no el bot). La evidencia debe ser copia exacta de sus palabras; si no hay frase textual, no lo incluyas.
- "missing": hasta 5, lo más importante primero. Solo lo que el cliente NO ha dicho. Revisa: dirección o comuna de despacho, para qué y con qué frecuencia lo usará, qué suciedad saca, energía disponible (220V, 380V o combustible), agua caliente o fría, plazo de compra, presupuesto, quién decide la compra, facturación, cantidad de equipos.
- "profile": null si la conversación no lo muestra con claridad.
- "objections": hasta 3, las más probables para ESTE cliente. No inventes precios, descuentos, plazos ni características que no estén arriba.`;

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${lovableApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: 'Eres un jefe de ventas experto en hidrolavadoras industriales. Eres concreto y nunca inventas datos. Respondes solo JSON válido.' },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (aiResponse.status === 429) return json(429, { error: 'Demasiadas solicitudes a la IA, intenta en un momento' });
    if (aiResponse.status === 402) return json(402, { error: 'Se acabaron los créditos de IA' });
    if (!aiResponse.ok) {
      console.error('Call guide AI error:', aiResponse.status, await aiResponse.text());
      return json(502, { error: 'La IA no respondió' });
    }
    const aiResult = await aiResponse.json();
    const content = sanitizeCallGuide(
      extractJson(aiResult.choices?.[0]?.message?.content ?? ''),
      customerMessages,
      (playbook || []).map(d => d.title),
    );

    const { data: guide, error: saveError } = await supabase.from('lead_call_guides').upsert({
      workshop_id: request.workshop_id,
      service_request_id: requestId,
      contact_id: request.contact_id,
      content,
      last_message_at: lastMessageAt,
      model: MODEL,
      generated_at: new Date().toISOString(),
      generated_by: auth.user.id,
    }, { onConflict: 'service_request_id' }).select('*').single();
    if (saveError) throw saveError;

    // A regenerated guide is a new guide: previous opinions no longer apply.
    if (existing) await supabase.from('lead_call_guide_feedback').delete().eq('guide_id', guide.id);

    return json(200, { guide });
  } catch (error) {
    console.error('generate-call-guide error:', error);
    return json(500, { error: error instanceof Error ? error.message : 'Error inesperado' });
  }
});
