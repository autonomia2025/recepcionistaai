// "Mis leads": what stage each lead is in, in one word, and the list grouped by
// the day it arrived. Pure rules over public.commercial_lead_inbox.

export interface LeadRow {
  id: string;
  contact_id: string;
  status: string;
  auto_created: boolean | null;
  created_at: string;
  assigned_at: string | null;
  quoted_at: string | null;
  closed_at: string | null;
  client: string;
  company: string | null;
  client_email: string | null;
  client_phone: string | null;
  zone_label: string | null;
  staff_id: string | null;
  staff_name: string | null;
  quote_id: string | null;
  quote_status: string | null;
  quote_number: string | null;
  sent_at: string | null;
  quote_net: number | null;
  catalog_amount: number | null;
  email_count: number | null;
  unread_in: number | null;
  last_email_at: string | null;
  last_direction: 'in' | 'out' | null;
  last_preview: string | null;
  last_from_name: string | null;
  priority?: LeadPriority | null;
  first_contact_at?: string | null;
  unattended_business_hours?: number | null;
}

export interface LeadPriority {
  urgent: boolean;
  kind: 'quote_requested' | 'billing_data' | 'taken' | 'auto' | 'manual';
  reasons: Array<{ code: 'quote_requested' | 'deadline' | 'billing_data'; text: string }>;
}

export interface LeadInbox {
  generated_at: string;
  scope: 'me' | 'team';
  unquoted_hours: number;
  followup_days: number;
  sla_hours?: number;
  leads: LeadRow[];
}

export type StageKey = 'replied' | 'new' | 'to_quote' | 'ready' | 'waiting_client' | 'won' | 'lost';

export interface LeadStage {
  key: StageKey;
  label: string;
  late: boolean;
  note: string;
}

export type LeadFilter = 'all' | 'urgent' | StageKey | 'closed';

export const STAGE_FILTERS: Array<{ key: LeadFilter; label: string }> = [
  { key: 'all', label: 'Abiertos' },
  { key: 'urgent', label: 'Urgentes' },
  { key: 'replied', label: 'Te escribieron' },
  { key: 'to_quote', label: 'Por cotizar' },
  { key: 'waiting_client', label: 'Esperando al cliente' },
  { key: 'closed', label: 'Cerrados' },
];

const HOUR = 3_600_000;
const hoursSince = (iso: string, now: Date) => (now.getTime() - new Date(iso).getTime()) / HOUR;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function agoPhrase(iso: string, now = new Date()): string {
  const h = hoursSince(iso, now);
  if (h < 1) { const m = Math.max(1, Math.floor(h * 60)); return `hace ${m} ${plural(m, 'minuto', 'minutos')}`; }
  if (h < 24) { const n = Math.floor(h); return `hace ${n} ${plural(n, 'hora', 'horas')}`; }
  const d = Math.floor(h / 24);
  return `hace ${d} ${plural(d, 'día', 'días')}`;
}

export const isClosed = (lead: LeadRow) => lead.status === 'done' || lead.status === 'lost';
const quoteOut = (lead: LeadRow) => lead.quote_status === 'sent' || (lead.quote_status === null && !!lead.quoted_at);

export function leadStage(lead: LeadRow, inbox: Pick<LeadInbox, 'unquoted_hours' | 'followup_days'>, now = new Date()): LeadStage {
  if (lead.status === 'done') return { key: 'won', label: 'Ganado', late: false, note: lead.closed_at ? `Cerrado ${agoPhrase(lead.closed_at, now)}` : 'Cerrado' };
  if (lead.status === 'lost') return { key: 'lost', label: 'Perdido', late: false, note: lead.closed_at ? `Cerrado ${agoPhrase(lead.closed_at, now)}` : 'Cerrado' };

  // The client wrote last: answering comes before anything else.
  if (lead.last_direction === 'in' && lead.last_email_at) {
    return { key: 'replied', label: 'Te escribió', late: hoursSince(lead.last_email_at, now) > 24, note: `Te escribió ${agoPhrase(lead.last_email_at, now)}` };
  }

  if (quoteOut(lead)) {
    const since = lead.last_email_at && lead.last_direction === 'out' && (!lead.sent_at || lead.last_email_at > lead.sent_at)
      ? lead.last_email_at
      : lead.sent_at ?? lead.quoted_at!;
    return {
      key: 'waiting_client', label: 'Esperando al cliente',
      late: hoursSince(since, now) > inbox.followup_days * 24,
      note: `${lead.quote_number ?? 'Cotización'} enviada · último contacto ${agoPhrase(since, now)}`,
    };
  }

  if (lead.quote_status === 'issued') {
    return { key: 'ready', label: 'Falta enviar', late: hoursSince(lead.created_at, now) > inbox.unquoted_hours, note: `${lead.quote_number} lista, falta enviarla al cliente` };
  }

  const arrived = lead.assigned_at ?? lead.created_at;
  if (!lead.quote_status && !lead.email_count && hoursSince(arrived, now) <= 24) {
    return { key: 'new', label: 'Nuevo', late: false, note: `Llegó ${agoPhrase(arrived, now)}` };
  }
  return {
    key: 'to_quote', label: 'Por cotizar',
    late: hoursSince(lead.created_at, now) > inbox.unquoted_hours,
    note: lead.quote_status === 'draft' ? `Cotización en preparación · espera ${agoPhrase(lead.created_at, now).replace('hace', 'desde hace')}` : `Sin cotización · espera ${agoPhrase(lead.created_at, now).replace('hace', 'desde hace')}`,
  };
}

export function matchesFilter(stage: LeadStage, lead: LeadRow, filter: LeadFilter): boolean {
  if (filter === 'closed') return isClosed(lead);
  if (isClosed(lead)) return false;
  if (filter === 'all') return true;
  if (filter === 'urgent') return !!lead.priority?.urgent;
  if (filter === 'to_quote') return stage.key === 'to_quote' || stage.key === 'new' || stage.key === 'ready';
  return stage.key === filter;
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// "Hoy", "Ayer", "Lunes 28", "15 de septiembre" (local time of the browser).
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diff <= 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  if (diff < 7) { const w = WEEKDAYS[d.getDay()]; return `${w[0].toUpperCase()}${w.slice(1)} ${d.getDate()}`; }
  return `${d.getDate()} de ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

export interface DayGroup<T> {
  label: string;
  items: T[];
}

// Newest day first; inside a day, urgent leads first, then newest.
export function groupByDay<T extends { lead: LeadRow }>(items: T[], now = new Date()): DayGroup<T>[] {
  const sorted = [...items].sort((a, b) => b.lead.created_at.localeCompare(a.lead.created_at));
  const withinDay = (a: T, b: T) => Number(!!b.lead.priority?.urgent) - Number(!!a.lead.priority?.urgent) || b.lead.created_at.localeCompare(a.lead.created_at);
  const groups: DayGroup<T>[] = [];
  for (const item of sorted) {
    const label = dayLabel(item.lead.created_at, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  for (const g of groups) g.items.sort(withinDay);
  return groups;
}

export const KIND_LABELS: Record<LeadPriority['kind'], string> = {
  quote_requested: 'Pidió cotización',
  billing_data: 'Dejó datos para facturar',
  taken: 'Tomado de Interesados',
  auto: 'Lead del bot',
  manual: 'Ingresado a mano',
};

export interface PriorityView {
  urgent: boolean;
  kind: string | null;
  // The client's own words that make it urgent, if any.
  why: string | null;
  // Promise of attention for urgent leads not yet attended.
  attention: { overdue: boolean; text: string } | null;
}

// "1 hora hábil", "3 horas hábiles", "menos de 1 hora hábil"
const businessHours = (h: number) => {
  if (h < 1) return 'menos de 1 hora hábil';
  const n = Math.round(h);
  return n === 1 ? '1 hora hábil' : `${n} horas hábiles`;
};

export function priorityView(lead: LeadRow, inbox: Pick<LeadInbox, 'sla_hours'>): PriorityView {
  const p = lead.priority;
  if (!p) return { urgent: false, kind: null, why: null, attention: null };
  const quote = p.reasons.find(r => r.code === 'quote_requested');
  const deadline = p.reasons.find(r => r.code === 'deadline');
  const why = quote ? `"${quote.text}"` : deadline ? `"${deadline.text}"` : null;
  let attention: PriorityView['attention'] = null;
  const sla = Number(inbox.sla_hours ?? 2);
  if (p.urgent && lead.unattended_business_hours != null && !isClosed(lead)) {
    const h = Number(lead.unattended_business_hours);
    const left = Math.max(0, sla - h);
    attention = h > sla
      ? { overdue: true, text: `Sin atender hace ${businessHours(h)} (plazo ${sla} h)` }
      : { overdue: false, text: `${left < 1.5 ? 'Queda' : 'Quedan'} ${businessHours(left)} para atenderlo` };
  }
  return { urgent: p.urgent, kind: KIND_LABELS[p.kind] ?? null, why, attention };
}

// ---------------------------------------------------------------------------
// "Interesados": clients with questions or asking prices, no request yet.
export interface InterestedRow {
  contact_id: string;
  client: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  zone_label: string | null;
  intent: string | null;
  lead_score: number | null;
  lead_score_reasoning: string | null;
  last_inbound_at: string;
  last_inbound_text: string | null;
  conversation_id: string | null;
  products: string[] | null;
}

export const INTENT_LABELS: Record<string, string> = {
  cotizacion: 'Consultó precios',
  consulta: 'Tiene dudas',
  agendar_cita: 'Quiere una visita',
};

export function interestLabel(row: InterestedRow): string {
  return (row.intent && INTENT_LABELS[row.intent]) || 'Mostró interés';
}

export function leadAmount(lead: LeadRow): { value: number; estimate: boolean } | null {
  if (lead.quote_net != null && Number(lead.quote_net) > 0) return { value: Number(lead.quote_net), estimate: false };
  if (lead.catalog_amount != null && Number(lead.catalog_amount) > 0) return { value: Number(lead.catalog_amount), estimate: true };
  return null;
}

// ---------------------------------------------------------------------------
// "Qué hacer ahora": due date in words.
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function dueLabel(due: string, now = new Date()): { text: string; overdue: boolean; today: boolean } {
  const today = ymd(now);
  const tomorrow = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const yesterday = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const date = new Date(`${due}T12:00:00`);
  const named = `${WEEKDAYS[date.getDay()]} ${date.getDate()}`;
  if (due === today) return { text: 'Hoy', overdue: false, today: true };
  if (due === tomorrow) return { text: 'Mañana', overdue: false, today: false };
  if (due < today) return { text: due === yesterday ? 'Vencida ayer' : `Vencida (era el ${named})`, overdue: true, today: false };
  return { text: `${named[0].toUpperCase()}${named.slice(1)}`, overdue: false, today: false };
}

export const ACTION_LABELS: Record<string, string> = {
  call: 'Llamar',
  email: 'Escribir',
  send_quote: 'Enviar cotización',
  follow_up: 'Seguimiento',
  visit: 'Visita',
  wait: 'Esperar',
};
