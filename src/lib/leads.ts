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
}

export interface LeadInbox {
  generated_at: string;
  scope: 'me' | 'team';
  unquoted_hours: number;
  followup_days: number;
  leads: LeadRow[];
}

export type StageKey = 'replied' | 'new' | 'to_quote' | 'ready' | 'waiting_client' | 'won' | 'lost';

export interface LeadStage {
  key: StageKey;
  label: string;
  late: boolean;
  note: string;
}

export const STAGE_FILTERS: Array<{ key: 'all' | StageKey | 'closed'; label: string }> = [
  { key: 'all', label: 'Abiertos' },
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

export function matchesFilter(stage: LeadStage, lead: LeadRow, filter: 'all' | StageKey | 'closed'): boolean {
  if (filter === 'closed') return isClosed(lead);
  if (isClosed(lead)) return false;
  if (filter === 'all') return true;
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

// Newest day first; inside a day, newest lead first.
export function groupByDay<T extends { lead: LeadRow }>(items: T[], now = new Date()): DayGroup<T>[] {
  const sorted = [...items].sort((a, b) => b.lead.created_at.localeCompare(a.lead.created_at));
  const groups: DayGroup<T>[] = [];
  for (const item of sorted) {
    const label = dayLabel(item.lead.created_at, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export function leadAmount(lead: LeadRow): { value: number; estimate: boolean } | null {
  if (lead.quote_net != null && Number(lead.quote_net) > 0) return { value: Number(lead.quote_net), estimate: false };
  if (lead.catalog_amount != null && Number(lead.catalog_amount) > 0) return { value: Number(lead.catalog_amount), estimate: true };
  return null;
}
