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
  quoted_at?: string | null; // set when quoted with the older "Marcar cotización enviada" button too
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
const waitingQuote = (r: OpenRequestFact) => (r.quote_status === null && !r.quoted_at) || r.quote_status === 'draft' || r.quote_status === 'issued';
// Quote out with the client: sent from the system, or marked as sent with the older button.
const sentAt = (r: OpenRequestFact) => (r.quote_status === 'sent' ? r.sent_at : r.quote_status === null ? r.quoted_at ?? null : null);

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
  const cold = facts.open_requests.filter(r => { const at = sentAt(r); return !!at && hoursSince(at, now) > t.followup_days * 24; });
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
  const newOnes = facts.open_requests.filter(r => hoursSince(r.assigned_at ?? r.created_at, now) <= 24 && !r.quote_status && !r.quoted_at);
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
        .filter(r => !!sentAt(r))
        .map(r => ({ ...r, late: hoursSince(sentAt(r)!, now) > t.followup_days * 24, note: `${r.quote_number ?? 'Cotización'} enviada ${age(sentAt(r)!)}` })),
    },
  ];
}

// ---------------------------------------------------------------------------
// "Cómo trabaja el equipo": per-seller facts (public.commercial_team_activity)
// turned into short sentences, compared with the rest of the team.

export interface SellerActivity {
  staff_id: string;
  staff_name: string | null;
  assigned: number;
  quoted: number;
  median_hours_to_quote: number | null;
  speed_sample: number;
  quoted_last_7_days: number;
  open_now: number;
  waiting_late_now: number;
  followup_late_now: number;
  won: number;
  lost: number;
  won_amount: number;
  guide_feedback: number;
  // Email (from the connected Outlook mailboxes)
  emails_sent?: number;
  emails_received?: number;
  email_reply_median_hours?: number | null;
  email_reply_sample?: number;
  emails_waiting_now?: number;
  // Urgent leads (asked for a quote or gave a deadline)
  urgent_leads?: number;
  urgent_on_time?: number;
  urgent_attend_median_hours?: number | null;
  urgent_unattended?: number;
}

export interface TeamActivity {
  days: number;
  unquoted_hours: number;
  followup_days: number;
  sellers: SellerActivity[];
}

export interface SellerCard {
  staffId: string;
  name: string;
  severity: Severity;
  headline: string;
  lines: string[];
  stats: { assigned: number; quoted: number; speed: string | null; openNow: number; late: number };
}

const MIN_SPEED_SAMPLE = 3;

export function durationPhrase(hours: number): string {
  if (hours < 1) return 'menos de 1 hora';
  if (hours < 24) { const h = Math.round(hours); return `${h} ${plural(h, 'hora', 'horas')}`; }
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours - days * 24);
  if (rest === 0 || days >= 5) { const d = Math.round(hours / 24); return `${d} ${plural(d, 'día', 'días')}`; }
  return `${days} ${plural(days, 'día', 'días')} y ${rest} ${plural(rest, 'hora', 'horas')}`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function buildTeamActivity(activity: TeamActivity): SellerCard[] {
  const sellers = activity.sellers.map(s => ({
    ...s,
    assigned: Number(s.assigned), quoted: Number(s.quoted), speed_sample: Number(s.speed_sample),
    median_hours_to_quote: s.median_hours_to_quote == null ? null : Number(s.median_hours_to_quote),
    quoted_last_7_days: Number(s.quoted_last_7_days), open_now: Number(s.open_now),
    waiting_late_now: Number(s.waiting_late_now), followup_late_now: Number(s.followup_late_now),
    won: Number(s.won), lost: Number(s.lost), won_amount: Number(s.won_amount), guide_feedback: Number(s.guide_feedback),
    emails_sent: Number(s.emails_sent ?? 0), emails_received: Number(s.emails_received ?? 0),
    email_reply_median_hours: s.email_reply_median_hours == null ? null : Number(s.email_reply_median_hours),
    email_reply_sample: Number(s.email_reply_sample ?? 0), emails_waiting_now: Number(s.emails_waiting_now ?? 0),
    urgent_leads: Number(s.urgent_leads ?? 0), urgent_on_time: Number(s.urgent_on_time ?? 0),
    urgent_attend_median_hours: s.urgent_attend_median_hours == null ? null : Number(s.urgent_attend_median_hours),
    urgent_unattended: Number(s.urgent_unattended ?? 0),
  }));
  const measured = sellers.filter(s => s.median_hours_to_quote != null && s.speed_sample >= MIN_SPEED_SAMPLE);
  const teamSpeed = measured.length >= 2 ? median(measured.map(s => s.median_hours_to_quote!)) : null;
  const repliers = sellers.filter(s => s.email_reply_median_hours != null && s.email_reply_sample >= MIN_SPEED_SAMPLE);
  const teamReply = repliers.length >= 2 ? median(repliers.map(s => s.email_reply_median_hours!)) : null;

  const cards = sellers.map((s): SellerCard => {
    const name = s.staff_name ?? 'Sin nombre';
    const lines: string[] = [];
    const late = s.waiting_late_now + s.followup_late_now;

    // Right now
    let headline: string;
    let severity: Severity;
    if (s.waiting_late_now > 0) {
      severity = 'high';
      headline = `Hoy tiene ${s.waiting_late_now} ${plural(s.waiting_late_now, 'cliente esperando', 'clientes esperando')} cotización hace más de ${activity.unquoted_hours} horas.`;
    } else if (s.followup_late_now > 0) {
      severity = 'medium';
      headline = `Hoy tiene ${s.followup_late_now} ${plural(s.followup_late_now, 'cotización', 'cotizaciones')} sin seguimiento hace más de ${activity.followup_days} días.`;
    } else if (s.open_now > 0) {
      severity = 'good';
      headline = `Al día: ${s.open_now} ${plural(s.open_now, 'solicitud abierta', 'solicitudes abiertas')}, ninguna atrasada.`;
    } else {
      severity = 'info';
      headline = 'No tiene solicitudes abiertas.';
    }
    if (s.waiting_late_now > 0 && s.followup_late_now > 0) {
      lines.push(`Además, ${s.followup_late_now} ${plural(s.followup_late_now, 'cotización', 'cotizaciones')} sin seguimiento hace más de ${activity.followup_days} días.`);
    }

    // Volume
    lines.push(s.assigned === 0
      ? `No recibió solicitudes en los últimos ${activity.days} días.`
      : `En ${activity.days} días recibió ${s.assigned} ${plural(s.assigned, 'solicitud', 'solicitudes')} y cotizó ${s.quoted}.${s.quoted_last_7_days > 0 ? ` Esta semana envió ${s.quoted_last_7_days}.` : ''}`);

    // Speed, compared with the team only when both samples are big enough
    if (s.median_hours_to_quote != null && s.speed_sample >= MIN_SPEED_SAMPLE) {
      let compare = '';
      if (teamSpeed != null && measured.length >= 2) {
        if (s.median_hours_to_quote > teamSpeed * 1.5) compare = ` Más lento que el equipo (${durationPhrase(teamSpeed)}).`;
        else if (s.median_hours_to_quote < teamSpeed / 1.5) compare = ` Más rápido que el equipo (${durationPhrase(teamSpeed)}).`;
        else compare = ' Similar al equipo.';
      }
      lines.push(`Tarda ${durationPhrase(s.median_hours_to_quote)} en cotizar (mitad de los casos).${compare}`);
    } else if (s.speed_sample > 0) {
      lines.push(`Aún pocos casos para medir su velocidad (${s.speed_sample} de ${MIN_SPEED_SAMPLE}).`);
    }

    // Email with clients
    if (s.emails_waiting_now > 0) {
      lines.unshift(`${s.emails_waiting_now} ${plural(s.emails_waiting_now, 'cliente espera', 'clientes esperan')} su respuesta por correo hace más de 24 horas.`);
      if (severity === 'good' || severity === 'info') {
        severity = 'medium';
        headline = `${s.emails_waiting_now} ${plural(s.emails_waiting_now, 'cliente le escribió', 'clientes le escribieron')} y ${plural(s.emails_waiting_now, 'sigue', 'siguen')} sin respuesta.`;
        lines.shift();
      }
    }
    if (s.emails_sent + s.emails_received > 0) {
      let reply = '';
      if (s.email_reply_median_hours != null && s.email_reply_sample >= MIN_SPEED_SAMPLE) {
        reply = ` Responde en ${durationPhrase(s.email_reply_median_hours)} (mitad de los casos)`;
        if (teamReply != null) {
          reply += s.email_reply_median_hours > teamReply * 1.5 ? `, más lento que el equipo (${durationPhrase(teamReply)}).`
            : s.email_reply_median_hours < teamReply / 1.5 ? `, más rápido que el equipo (${durationPhrase(teamReply)}).` : ', similar al equipo.';
        } else reply += '.';
      }
      lines.push(`Correos: envió ${s.emails_sent} y recibió ${s.emails_received}.${reply}`);
    }

    // Urgent leads: promise of attention
    if (s.urgent_leads > 0) {
      const attended = s.urgent_leads - s.urgent_unattended;
      let line = `Urgentes: atendió ${s.urgent_on_time} de ${s.urgent_leads} dentro del plazo`;
      if (s.urgent_attend_median_hours != null && attended >= MIN_SPEED_SAMPLE) line += ` (mitad en ${durationPhrase(s.urgent_attend_median_hours)} hábiles)`;
      line += s.urgent_unattended > 0 ? `; ${s.urgent_unattended} ${plural(s.urgent_unattended, 'sigue', 'siguen')} sin atender.` : '.';
      lines.push(line);
    }

    // Closes
    if (s.won + s.lost > 0) {
      lines.push(`Cerró ${s.won + s.lost}: ganó ${s.won}${s.won_amount > 0 ? ` por ${formatCLP(s.won_amount)} neto` : ''} y perdió ${s.lost}.`);
    }

    return {
      staffId: s.staff_id, name, severity, headline, lines,
      stats: {
        assigned: s.assigned, quoted: s.quoted,
        speed: s.median_hours_to_quote != null && s.speed_sample >= MIN_SPEED_SAMPLE ? durationPhrase(s.median_hours_to_quote) : null,
        openNow: s.open_now, late,
      },
    };
  });

  const rank: Record<Severity, number> = { high: 0, medium: 1, good: 2, info: 3 };
  return cards.sort((a, b) => rank[a.severity] - rank[b.severity] || b.stats.late - a.stats.late || a.name.localeCompare(b.name));
}
