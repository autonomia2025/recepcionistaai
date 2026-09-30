// Builds and saves the next action of a lead (F5). Used by the scheduled task
// "next-actions" and by the "Actualizar" button (generate-next-action).

import { askJson } from './aiGateway.ts';
import { buildNextActionPrompt, fallbackNextAction, localDate, type NextAction, sanitizeNextAction } from './nextAction.ts';

// deno-lint-ignore no-explicit-any
type Supabase = any;

export const NEXT_ACTION_MODEL = 'google/gemini-3-flash-preview';
const MAX_PER_RUN = 8;

const STAGES: Record<string, string> = {
  new: 'nueva, sin atender', contacting: 'contactando', waiting_customer: 'esperando al cliente', scheduled_visit: 'visita agendada',
  quoted: 'cotizada', approved: 'aprobada', in_progress: 'en progreso',
};
const clp = (v: number | null) => (v == null ? '?' : `$${Math.round(Number(v)).toLocaleString('es-CL')}`);

export type NextActionOutcome = { ok: true; id: string } | { ok: false; status: number; error: string };

export async function generateNextAction(supabase: Supabase, requestId: string, basisAt?: string): Promise<NextActionOutcome> {
  const { data: request } = await supabase.from('service_requests')
    .select('id, workshop_id, contact_id, conversation_id, status, created_at, first_contact_at, assigned_staff_id')
    .eq('id', requestId).maybeSingle();
  if (!request || ['done', 'lost'].includes(request.status)) return { ok: false, status: 404, error: 'Lead no encontrado o cerrado' };

  const since = new Date(Date.now() - 45 * 86_400_000).toISOString();
  const [{ data: settings }, { data: workshop }, { data: contact }, { data: priority }, { data: quote }, { data: emails }, { data: guide }, { data: playbook }, { data: conversations }] = await Promise.all([
    supabase.from('commercial_settings').select('legal_name, timezone, business_days').eq('workshop_id', request.workshop_id).maybeSingle(),
    supabase.from('workshops').select('name').eq('id', request.workshop_id).maybeSingle(),
    supabase.from('contacts').select('name, company_name').eq('id', request.contact_id).maybeSingle(),
    supabase.rpc('lead_priority', { _request_id: request.id }),
    supabase.from('quotes').select('quote_number, status, net_total, issued_at, sent_at').eq('service_request_id', request.id)
      .not('status', 'in', '(void,rejected)').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('contact_emails').select('direction, sent_at, body_text, internet_message_id, provider_message_id')
      .eq('contact_id', request.contact_id).gte('sent_at', since).order('sent_at', { ascending: false }).limit(10),
    supabase.from('lead_call_guides').select('content').eq('service_request_id', request.id).maybeSingle(),
    supabase.from('sales_playbook_docs').select('title').eq('workshop_id', request.workshop_id).eq('is_active', true).limit(15),
    supabase.from('conversations').select('id, ai_summary, last_message_at').eq('contact_id', request.contact_id).order('last_message_at', { ascending: false }).limit(3),
  ]);
  const { data: lastDone } = await supabase.from('lead_next_actions').select('action, done_at, done_note')
    .eq('service_request_id', request.id).not('done_at', 'is', null).order('done_at', { ascending: false }).limit(1).maybeSingle();

  const conversationIds = (conversations ?? []).map((c: { id: string }) => c.id);
  const { data: messages } = conversationIds.length
    ? await supabase.from('messages').select('text, created_at').in('conversation_id', conversationIds).eq('direction', 'inbound')
      .gte('created_at', since).order('created_at', { ascending: false }).limit(10)
    : { data: [] };

  const seen = new Set<string>();
  const thread = (emails ?? []).filter((e: Record<string, string>) => {
    const key = e.internet_message_id || e.provider_message_id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).reverse();
  const clientMessages = (messages ?? []).reverse().filter((m: { text: string | null }) => m.text?.trim()).map((m: { created_at: string; text: string }) => ({ at: m.created_at, text: m.text }));

  const lastOut = [...thread].reverse().find((e: { direction: string }) => e.direction === 'out');
  const lastSellerContact = [lastOut?.sent_at, request.first_contact_at, quote?.sent_at].filter(Boolean).sort().pop() ?? null;

  const reasons = (priority?.reasons ?? []) as Array<{ code: string; text: string }>;
  const priorityText = priority?.urgent
    ? `urgente (${reasons.filter(r => r.code !== 'billing_data').map(r => `"${r.text}"`).join('; ')})`
    : reasons.length ? reasons.map(r => r.text).join('; ') : null;

  const tz = settings?.timezone || 'America/Santiago';
  const businessDays: number[] = (settings?.business_days as number[] | null) ?? [1, 2, 3, 4, 5];
  const today = localDate(new Date(), tz);

  const prompt = buildNextActionPrompt({
    companyName: settings?.legal_name || workshop?.name || null,
    client: [contact?.company_name, contact?.name].filter(Boolean).join(' · ') || 'Cliente',
    stage: STAGES[request.status] ?? request.status,
    priority: priorityText,
    quote: quote ? `${quote.quote_number ?? 'borrador'} (${quote.status === 'sent' ? `enviada el ${String(quote.sent_at).slice(0, 10)}` : quote.status === 'issued' ? 'emitida, falta enviarla' : quote.status === 'accepted' ? 'aceptada' : 'en preparación'}), neto ${clp(quote.net_total)}` : null,
    whatsappSummary: conversations?.[0]?.ai_summary ?? null,
    clientMessages,
    emails: thread.map((e: { direction: 'in' | 'out'; sent_at: string; body_text: string }) => ({ direction: e.direction, at: e.sent_at, text: e.body_text })),
    missing: ((guide?.content as { missing?: string[] } | null)?.missing ?? []).slice(0, 5),
    lastSellerContact: lastSellerContact ? String(lastSellerContact).slice(0, 16).replace('T', ' ') : null,
    playbookTitles: (playbook ?? []).map((d: { title: string }) => d.title),
    lastDone: lastDone ? { action: lastDone.action, at: lastDone.done_at, note: lastDone.done_note } : null,
  }, today, businessDays);

  const ai = await askJson({
    model: NEXT_ACTION_MODEL,
    system: 'Eres un jefe de ventas práctico. Propones una sola acción concreta con fecha. Nunca inventas datos. Respondes solo JSON válido.',
    prompt,
  });
  // No credits or throttled: stop (the lead is retried later). Anything else
  // unusable: fall back to simple rules so it is not retried every run.
  if (!ai.ok && (ai.status === 402 || ai.status === 429)) return ai;
  const clientTexts = [...clientMessages.map((m: { text: string }) => m.text), ...thread.filter((e: { direction: string }) => e.direction === 'in').map((e: { body_text: string }) => e.body_text)];
  let action: NextAction | null = ai.ok ? sanitizeNextAction(ai.data, clientTexts, today, businessDays) : null;
  let model = NEXT_ACTION_MODEL;
  if (!action) {
    action = fallbackNextAction({
      clientWroteLast: thread.length > 0 && thread[thread.length - 1].direction === 'in',
      quoteStatus: quote?.status ?? null,
      quoteSentAt: quote?.sent_at ?? null,
      contacted: !!lastSellerContact,
    }, today, businessDays);
    model = 'reglas';
  }

  let basis = basisAt;
  if (!basis) {
    const { data } = await supabase.rpc('lead_last_activity', { _request_id: request.id });
    basis = (data as string | null) ?? new Date().toISOString();
  }
  const { data: id, error } = await supabase.rpc('save_next_action', {
    _request_id: request.id, _basis_at: basis, _action_type: action.action_type, _action: action.action, _due: action.due,
    _argument: action.argument, _evidence: action.evidence, _reason: action.reason, _model: model,
  });
  if (error) throw new Error(`save_next_action: ${error.message}`);
  return { ok: true, id: id as string };
}

export async function refreshNextActions(supabase: Supabase, budgetMs = 100_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + budgetMs;
  const { data: pending, error } = await supabase.rpc('leads_needing_next_action', { _limit: MAX_PER_RUN });
  if (error) throw new Error(`leads_needing_next_action: ${error.message}`);
  const result = { pending: (pending ?? []).length, done: 0, failed: 0, stopped: false };
  for (const row of (pending ?? []) as Array<{ request_id: string; basis_at: string }>) {
    if (Date.now() > deadline) break;
    const outcome = await generateNextAction(supabase, row.request_id, row.basis_at);
    if (outcome.ok) result.done++;
    else if (outcome.status === 402 || outcome.status === 429) { result.stopped = true; break; }
    else result.failed++;
  }
  return result;
}
