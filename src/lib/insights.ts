// "Panel que habla": rules that turn commercial facts (public.commercial_facts)
// into sentences that say what to do. Deterministic on purpose: every number in
// a sentence comes from the facts, and small samples say so instead of showing
// a misleading percentage.
import { formatCLP } from '@/lib/quoteTotals';

export interface OpenRequestFact {
  id: string;
  client: string;
  company: string | null;
  zone: string | null;
  zone_label: string | null;
  staff_id: string | null;
  staff_name: string | null;
  status: string;
  created_at: string;
  assigned_at: string | null;
  quote_status: string | null;
  quote_number: string | null;
  sent_at: string | null;
  amount: number | null;
  amount_is_estimate: boolean;
}

export interface CommercialFacts {
  generated_at: string;
  scope: 'team' | 'me';
  thresholds: { unquoted_hours: number; unassigned_hours: number; followup_days: number; discount_pct: number | null; min_sample: number };
  open_requests: OpenRequestFact[];
  closed_quotes: Array<{ outcome: 'accepted' | 'rejected'; closed_at: string; lost_reason: string | null; net_total: number; staff_name: string | null; zone_label: string | null }>;
  discounted: Array<{ quote_number: string; max_discount_pct: number; request_id: string; staff_name: string | null }>;
}

export type Severity = 'high' | 'medium' | 'info' | 'good';

export interface Insight {
  key: string;
  severity: Severity;
  text: string;
  requestIds: string[];
}

const HOUR = 3_600_000;
const hoursSince = (iso: string, now: Date) => (now.getTime() - new Date(iso).getTime()) / HOUR;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const waitingQuote = (r: OpenRequestFact) => r.quote_status === null || r.quote_status === 'draft' || r.quote_status === 'issued';

export function moneyPhrase(requests: OpenRequestFact[]): string | null {
  const withAmount = requests.filter(r => r.amount != null && Number(r.amount) > 0);
  if (withAmount.length === 0) return null;
  const total = withAmount.reduce((sum, r) => sum + Number(r.amount), 0);
  const estimate = withAmount.some(r => r.amount_is_estimate) || withAmount.length < requests.length;
  return estimate ? `cerca de ${formatCLP(total)} (estimado)` : formatCLP(total);
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(item);
  }
  return groups;
}

export function buildTeamInsights(facts: CommercialFacts, now = new Date()): Insight[] {
  const { thresholds: t } = facts;
  const insights: Insight[] = [];

  // 1. Customers waiting for a quote, per seller.
  const late = facts.open_requests.filter(r => r.staff_id && waitingQuote(r) && hoursSince(r.created_at, now) > t.unquoted_hours);
  for (const [, group] of groupBy(late, r => r.staff_id!)) {
    const n = group.length;
    const money = moneyPhrase(group);
    insights.push({
      key: `waiting-${group[0].staff_id}`,
      severity: 'high',
      text: `${group[0].staff_name ?? 'Un vendedor'} tiene ${n} ${plural(n, 'cliente esperando', 'clientes esperando')} cotización hace más de ${t.unquoted_hours} horas.${money ? ` ${plural(n, 'Es', 'Son')} ${money} que se ${plural(n, 'puede', 'pueden')} enfriar.` : ''}`,
      requestIds: group.map(r => r.id),
    });
  }

  // 2. Requests nobody has taken, per zone.
  const orphan = facts.open_requests.filter(r => !r.staff_id && hoursSince(r.created_at, now) > t.unassigned_hours);
  for (const [zone, group] of groupBy(orphan, r => r.zone_label ?? 'sin zona')) {
    const n = group.length;
    const oldest = Math.floor(Math.max(...group.map(r => hoursSince(r.created_at, now))));
    const where = zone === 'sin zona' ? 'sin zona asignada' : `de ${zone}`;
    insights.push({
      key: `unassigned-${zone}`,
      severity: 'high',
      text: `${n} ${plural(n, 'solicitud', 'solicitudes')} ${where} ${plural(n, 'sigue', 'siguen')} sin vendedor asignado (${plural(n, 'lleva', 'la más antigua lleva')} ${oldest} horas).`,
      requestIds: group.map(r => r.id),
    });
  }

  // 3. Quotes sent with no answer, per zone.
  const cold = facts.open_requests.filter(r => r.quote_status === 'sent' && r.sent_at && hoursSince(r.sent_at, now) > t.followup_days * 24);
  for (const [zone, group] of groupBy(cold, r => r.zone_label ?? 'Sin zona')) {
    const n = group.length;
    const money = moneyPhrase(group);
    insights.push({
      key: `followup-${zone}`,
      severity: 'medium',
      text: `${zone}: ${n} ${plural(n, 'cotización enviada', 'cotizaciones enviadas')} hace más de ${t.followup_days} días ${plural(n, 'sigue', 'siguen')} sin respuesta.${money ? ` Hay ${money} en juego; toca hacer seguimiento.` : ' Toca hacer seguimiento.'}`,
      requestIds: group.map(r => r.id),
    });
  }

  // 4. Discounts above the approval threshold this month.
  if (facts.discounted.length > 0) {
    const n = facts.discounted.length;
    const who = [...new Set(facts.discounted.map(d => d.staff_name).filter(Boolean))].join(', ');
    insights.push({
      key: 'discounts',
      severity: 'medium',
      text: `Este mes ${plural(n, 'salió', 'salieron')} ${n} ${plural(n, 'cotización', 'cotizaciones')} con descuento sobre el ${t.discount_pct ?? '—'}% permitido${who ? ` (${who})` : ''}: ${facts.discounted.map(d => `${d.quote_number} con ${Number(d.max_discount_pct)}%`).join(', ')}.`,
      requestIds: [...new Set(facts.discounted.map(d => d.request_id))],
    });
  }

  // 5. Why sales are lost this month.
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lost = facts.closed_quotes.filter(q => q.outcome === 'rejected' && new Date(q.closed_at) >= monthStart);
  if (lost.length > 0) {
    const counts = [...groupBy(lost, q => q.lost_reason ?? 'Sin motivo')].map(([reason, g]) => ({ reason, n: g.length })).sort((a, b) => b.n - a.n);
    const top = counts[0];
    const few = lost.length < t.min_sample ? ' Aún son pocos casos para sacar conclusiones.' : '';
    insights.push({
      key: 'lost-reasons',
      severity: 'info',
      text: `Este mes se ${plural(lost.length, 'perdió', 'perdieron')} ${lost.length} ${plural(lost.length, 'venta', 'ventas')}. El motivo más común: "${top.reason}" (${top.n} de ${lost.length}).${few}`,
      requestIds: [],
    });
  }

  if (!insights.some(i => i.severity === 'high' || i.severity === 'medium')) {
    insights.unshift({
      key: 'all-good',
      severity: 'good',
      text: facts.open_requests.length === 0
        ? 'No hay solicitudes abiertas en este momento.'
        : `Todo al día: nadie espera cotización más de ${t.unquoted_hours} horas y no hay cotizaciones sin seguimiento.`,
      requestIds: [],
    });
  }
  return insights;
}

export interface CloseRate {
  name: string;
  closed: number;
  won: number;
  rate: number | null; // null when the sample is too small to show a percentage
}

// 6. Close rate over the last 90 days, by seller and by zone, sample size visible.
export function closeRates(facts: CommercialFacts, by: 'staff_name' | 'zone_label'): CloseRate[] {
  return [...groupBy(facts.closed_quotes, q => q[by] ?? (by === 'staff_name' ? 'Sin vendedor' : 'Sin zona'))]
    .map(([name, group]) => {
      const won = group.filter(q => q.outcome === 'accepted').length;
      return { name, closed: group.length, won, rate: group.length >= facts.thresholds.min_sample ? Math.round((won / group.length) * 100) : null };
    })
    .sort((a, b) => b.closed - a.closed);
}

export interface MyDaySection {
  key: 'to-quote' | 'follow-up' | 'new';
  title: string;
  empty: string;
  items: Array<OpenRequestFact & { note: string; late: boolean }>;
}

// "Mi día": the seller's own pending work, oldest first.
export function buildMyDay(facts: CommercialFacts, now = new Date()): MyDaySection[] {
  const t = facts.thresholds;
  const age = (iso: string) => {
    const h = hoursSince(iso, now);
    return h < 24 ? `hace ${Math.max(1, Math.floor(h))} ${plural(Math.max(1, Math.floor(h)), 'hora', 'horas')}` : `hace ${Math.floor(h / 24)} ${plural(Math.floor(h / 24), 'día', 'días')}`;
  };
  const newOnes = facts.open_requests.filter(r => hoursSince(r.assigned_at ?? r.created_at, now) <= 24 && !r.quote_status);
  const newIds = new Set(newOnes.map(r => r.id));
  return [
    {
      key: 'new',
      title: 'Nuevas de hoy',
      empty: 'No te llegaron solicitudes nuevas en las últimas 24 horas.',
      items: newOnes.map(r => ({ ...r, late: false, note: `Llegó ${age(r.assigned_at ?? r.created_at)}` })),
    },
    {
      key: 'to-quote',
      title: 'Por cotizar',
      empty: 'No tienes clientes esperando cotización.',
      items: facts.open_requests
        .filter(r => waitingQuote(r) && !newIds.has(r.id))
        .map(r => {
          const late = hoursSince(r.created_at, now) > t.unquoted_hours;
          const step = r.quote_status === 'draft' ? 'cotización en preparación' : r.quote_status === 'issued' ? `${r.quote_number} lista, falta enviarla` : 'sin cotización';
          return { ...r, late, note: `Espera ${age(r.created_at).replace('hace ', 'desde hace ')} · ${step}` };
        }),
    },
    {
      key: 'follow-up',
      title: 'Hacer seguimiento',
      empty: 'No tienes cotizaciones esperando respuesta.',
      items: facts.open_requests
        .filter(r => r.quote_status === 'sent' && r.sent_at)
        .map(r => ({ ...r, late: hoursSince(r.sent_at!, now) > t.followup_days * 24, note: `${r.quote_number} enviada ${age(r.sent_at!)}` })),
    },
  ];
}
