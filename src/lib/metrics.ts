// Commercial metrics for the admin Dashboard (public.commercial_metrics):
// the value of each metric and a full explanation of where it comes from,
// with the real numbers of the period. Pure (unit-tested).
import { formatCLP } from '@/lib/quoteTotals';

export interface MetricRecord {
  id: string;
  client: string;
  seller: string | null;
  zone: string | null;
  amount?: number | null;
  date: string;
  stage?: string;
  hours?: number | null;
  cold?: boolean;
}

interface GroupRow { name: string; leads: number; quoted: number; fast: number; quote_median: number | null; won: number; won_amount: number }

export interface CommercialMetrics {
  period: { from: string; to: string; days: number; prev_from: string; prev_to: string };
  settings: { timezone: string; day_hours: number; sla_hours: number; followup_days: number; margin_pct: number | null; monthly_fee: number | null; discount_limit: number | null };
  north_star: { amount: number; count: number; prev_amount: number; prev_count: number; weekly: Array<{ week: string; amount: number; leads: number; fast: number }> };
  leading: { leads: number; fast: number; prev_leads: number; prev_fast: number };
  roi: { sales: number; cost: number | null; margin: number | null; conversations: number };
  funnel: { leads: number; contacted: number; quoted: number; won: number; lost: number; won_amount: number };
  speed: { contact_median: number | null; contact_sample: number; quote_median: number | null; quote_sample: number; urgent: number; urgent_on_time: number };
  value: { avg_ticket: number | null; avg_discount_pct: number | null; discount_sample: number; cycle_median_days: number | null; lost: number; lost_reasons: Array<{ reason: string; count: number }> | null };
  pipeline: { amount: number; count: number; cold_amount: number; cold_count: number };
  health: { clients_waiting: number; discount_over_limit: number; tone_avg: number | null; reviewed: number; actions_due: number; actions_followed: number };
  by_seller: GroupRow[] | null;
  by_zone: GroupRow[] | null;
  records: { won: MetricRecord[] | null; leads: MetricRecord[] | null; pipeline: MetricRecord[] | null };
}

// Numbers from the database may arrive as strings.
export function normalizeMetrics(raw: CommercialMetrics): CommercialMetrics {
  const n = (v: unknown) => (v == null ? null : Number(v));
  const nn = (v: unknown) => Number(v ?? 0);
  const group = (rows: GroupRow[] | null) => (rows ?? []).map(r => ({ ...r, leads: nn(r.leads), quoted: nn(r.quoted), fast: nn(r.fast), quote_median: n(r.quote_median), won: nn(r.won), won_amount: nn(r.won_amount) }));
  return {
    ...raw,
    settings: { ...raw.settings, day_hours: nn(raw.settings.day_hours), sla_hours: nn(raw.settings.sla_hours), margin_pct: n(raw.settings.margin_pct), monthly_fee: n(raw.settings.monthly_fee), discount_limit: n(raw.settings.discount_limit) },
    north_star: { amount: nn(raw.north_star.amount), count: nn(raw.north_star.count), prev_amount: nn(raw.north_star.prev_amount), prev_count: nn(raw.north_star.prev_count),
      weekly: (raw.north_star.weekly ?? []).map(w => ({ week: w.week, amount: nn(w.amount), leads: nn(w.leads), fast: nn(w.fast) })) },
    leading: { leads: nn(raw.leading.leads), fast: nn(raw.leading.fast), prev_leads: nn(raw.leading.prev_leads), prev_fast: nn(raw.leading.prev_fast) },
    roi: { sales: nn(raw.roi.sales), cost: n(raw.roi.cost), margin: n(raw.roi.margin), conversations: nn(raw.roi.conversations) },
    funnel: { leads: nn(raw.funnel.leads), contacted: nn(raw.funnel.contacted), quoted: nn(raw.funnel.quoted), won: nn(raw.funnel.won), lost: nn(raw.funnel.lost), won_amount: nn(raw.funnel.won_amount) },
    speed: { contact_median: n(raw.speed.contact_median), contact_sample: nn(raw.speed.contact_sample), quote_median: n(raw.speed.quote_median), quote_sample: nn(raw.speed.quote_sample), urgent: nn(raw.speed.urgent), urgent_on_time: nn(raw.speed.urgent_on_time) },
    value: { avg_ticket: n(raw.value.avg_ticket), avg_discount_pct: n(raw.value.avg_discount_pct), discount_sample: nn(raw.value.discount_sample), cycle_median_days: n(raw.value.cycle_median_days), lost: nn(raw.value.lost), lost_reasons: (raw.value.lost_reasons ?? []).map(r => ({ reason: r.reason, count: nn(r.count) })) },
    pipeline: { amount: nn(raw.pipeline.amount), count: nn(raw.pipeline.count), cold_amount: nn(raw.pipeline.cold_amount), cold_count: nn(raw.pipeline.cold_count) },
    health: { clients_waiting: nn(raw.health.clients_waiting), discount_over_limit: nn(raw.health.discount_over_limit), tone_avg: n(raw.health.tone_avg), reviewed: nn(raw.health.reviewed), actions_due: nn(raw.health.actions_due), actions_followed: nn(raw.health.actions_followed) },
    by_seller: group(raw.by_seller),
    by_zone: group(raw.by_zone),
    records: { won: raw.records.won ?? [], leads: raw.records.leads ?? [], pipeline: raw.records.pipeline ?? [] },
  };
}

// ---------------------------------------------------------------------------
// Periods (browser local time, SOC is in Chile).
export type PeriodKey = 'this_month' | 'last_month' | 'last_30' | 'last_90';
export const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: 'this_month', label: 'Este mes' },
  { key: 'last_month', label: 'Mes anterior' },
  { key: 'last_30', label: 'Últimos 30 días' },
  { key: 'last_90', label: 'Últimos 90 días' },
];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function periodRange(key: PeriodKey, now = new Date()): { from: string; to: string } {
  const y = now.getFullYear(); const m = now.getMonth(); const d = now.getDate();
  switch (key) {
    case 'this_month': return { from: ymd(new Date(y, m, 1)), to: ymd(now) };
    case 'last_month': return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
    case 'last_30': return { from: ymd(new Date(y, m, d - 29)), to: ymd(now) };
    case 'last_90': return { from: ymd(new Date(y, m, d - 89)), to: ymd(now) };
  }
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export function shortDate(date: string): string {
  const [yy, mm, dd] = date.slice(0, 10).split('-').map(Number);
  return `${dd} ${MONTHS[mm - 1]}${yy !== new Date().getFullYear() ? ` ${yy}` : ''}`;
}
export const rangeText = (from: string, to: string) => `${shortDate(from)} – ${shortDate(to)}`;

// ---------------------------------------------------------------------------
// Formatting
export const pct = (part: number, total: number): number | null => (total > 0 ? Math.round((part / total) * 100) : null);
export const pctText = (part: number, total: number) => { const p = pct(part, total); return p == null ? '—' : `${p}%`; };
const num = (v: number) => v.toLocaleString('es-CL');
export function hoursText(h: number | null): string {
  if (h == null) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 10) return `${h.toFixed(1).replace('.', ',').replace(',0', '')} h`;
  return `${Math.round(h)} h`;
}

export interface Change { text: string; direction: 'up' | 'down' | 'flat' | 'new' }
export function changeVs(current: number, previous: number): Change | null {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return { text: 'nuevo vs período anterior', direction: 'new' };
  const p = Math.round(((current - previous) / previous) * 100);
  if (p === 0) return { text: 'igual que el período anterior', direction: 'flat' };
  return { text: `${p > 0 ? '+' : ''}${p}% vs período anterior`, direction: p > 0 ? 'up' : 'down' };
}

// ---------------------------------------------------------------------------
// Explanations
export type Tone = 'good' | 'warn' | 'bad' | 'neutral';
export const TONE_TEXT: Record<Tone, string> = {
  good: 'text-emerald-700 dark:text-emerald-400',
  warn: 'text-amber-700 dark:text-amber-400',
  bad: 'text-red-700 dark:text-red-400',
  neutral: 'text-foreground',
};
export type MetricId =
  | 'north_star' | 'leading_fast' | 'roi'
  | 'funnel_leads' | 'funnel_contacted' | 'funnel_quoted' | 'funnel_won'
  | 'speed_contact' | 'speed_quote' | 'urgent_on_time'
  | 'avg_ticket' | 'avg_discount' | 'cycle' | 'pipeline' | 'lost'
  | 'clients_waiting' | 'discount_over_limit' | 'email_tone' | 'adherence';

export interface Explanation {
  id: MetricId | string;
  title: string;
  value: string;
  caption: string | null;
  tone: Tone;
  change: Change | null;
  what: string;
  // The calculation with this period's real numbers, step by step.
  steps: Array<{ label: string; value: string }>;
  result: string;
  sources: Array<{ data: string; where: string }>;
  counts: string[];
  excludes: string[];
  drivers: string[];
  records: 'won' | 'leads' | 'pipeline' | 'pipeline_cold' | 'leads_fast' | 'leads_unattended' | null;
  small?: string | null; // warning when the sample is too small
}

const LEAD_DEF = 'Lead del bot: solicitud que el bot creó sola (el cliente pidió cotizar o dejó datos para facturar) o que un vendedor tomó desde "Interesados".';
const SOURCE_LEADS = { data: 'Leads del bot', where: 'Mis leads / Solicitudes (las crea el bot al leer WhatsApp)' };
const SOURCE_WON = { data: 'Ventas ganadas', where: 'Botón "Aceptada" en la cotización, o solicitud marcada "Completada" (flujo antiguo)' };
const SOURCE_QUOTED = { data: 'Cotizaciones enviadas', where: '"Enviar por correo" o "Marcar como enviada" en la cotización (o "Marcar cotización enviada" antiguo)' };

export function explain(id: MetricId, m: CommercialMetrics): Explanation {
  const p = m.period;
  const range = rangeText(p.from, p.to);
  const prevRange = rangeText(p.prev_from, p.prev_to);
  const small = (n: number, min = 5) => (n > 0 && n < min ? `Aún son pocos casos (${n}): tómalo como referencia, no como tendencia.` : null);
  const base = { change: null, caption: null, tone: 'neutral' as Tone, counts: [] as string[], excludes: [] as string[], small: null as string | null };

  switch (id) {
    case 'north_star': {
      const ns = m.north_star;
      return {
        ...base, id, title: 'Ventas ganadas con leads del bot', value: formatCLP(ns.amount),
        caption: `${ns.count} ${ns.count === 1 ? 'venta' : 'ventas'} · ${range}`,
        change: changeVs(ns.amount, ns.prev_amount), tone: ns.amount > 0 ? 'good' : 'neutral',
        what: 'Es la North Star: cuánta plata entró por ventas que nacieron de conversaciones con el bot. Resume todo el proceso: que el bot traiga buenos leads, que el equipo los atienda rápido y que las cotizaciones cierren.',
        steps: [
          { label: `Ventas cerradas entre el ${range}`, value: `${ns.count}` },
          { label: 'Suma de sus montos netos (sin IVA)', value: formatCLP(ns.amount) },
          { label: `Período anterior (${prevRange})`, value: formatCLP(ns.prev_amount) },
        ],
        result: `${formatCLP(ns.amount)} neto en ${ns.count} ${ns.count === 1 ? 'venta' : 'ventas'}`,
        sources: [SOURCE_WON, SOURCE_LEADS],
        counts: ['Ventas cerradas en el período, aunque el lead haya llegado antes.', 'Monto neto de la cotización aceptada; si se cerró con el flujo antiguo, el monto que se anotó.', LEAD_DEF],
        excludes: ['Ventas de clientes que no pasaron por el bot (solicitudes creadas a mano).', 'El IVA.', 'Cotizaciones enviadas que aún no se aceptan (están en el pipeline).'],
        drivers: ['Más leads calientes del bot', 'Cotizar en menos de 1 día hábil', 'Seguimiento a las cotizaciones enviadas', 'Menos descuento para cerrar'],
        records: 'won', small: small(ns.count),
      };
    }
    case 'leading_fast': {
      const l = m.leading;
      const value = pctText(l.fast, l.leads);
      const prevPct = pct(l.prev_fast, l.prev_leads);
      const curPct = pct(l.fast, l.leads);
      return {
        ...base, id, title: 'Leads cotizados en 1 día hábil', value,
        caption: `${l.fast} de ${l.leads} leads que llegaron`,
        change: curPct != null && prevPct != null ? changeVs(curPct, prevPct) : null,
        tone: curPct == null ? 'neutral' : curPct >= 60 ? 'good' : curPct >= 30 ? 'warn' : 'bad',
        what: 'El indicador adelantado de la North Star: se mueve cada semana, antes que las ventas. Mide qué parte de los leads recibió la cotización dentro de un día hábil. En venta B2B, el que cotiza primero suele ganar.',
        steps: [
          { label: `Leads del bot que llegaron entre el ${range}`, value: `${l.leads}` },
          { label: `De ellos, cotizados en ${m.settings.day_hours} horas hábiles o menos`, value: `${l.fast}` },
          { label: `${l.fast} ÷ ${l.leads}`, value },
        ],
        result: `${value} de los leads se cotizó en 1 día hábil`,
        sources: [SOURCE_LEADS, SOURCE_QUOTED, { data: 'Horario hábil', where: 'Configuración comercial > Operación (días y horas de atención)' }],
        counts: [`1 día hábil = ${m.settings.day_hours} horas dentro del horario de atención, contadas desde que el lead llega o se asigna.`, 'Noches y fines de semana no cuentan.', LEAD_DEF],
        excludes: ['Leads que llegaron fuera del período.', 'Cotizaciones en preparación que no se han enviado.'],
        drivers: ['Aviso inmediato de leads urgentes', 'Usar "Crear cotización" (arma el borrador solo)', 'Revisar "Qué hacer hoy" en Mi día'],
        records: 'leads_fast', small: small(l.leads),
      };
    }
    case 'roi': {
      const r = m.roi;
      const ratio = r.cost && r.cost > 0 ? r.sales / r.cost : null;
      const marginRatio = r.cost && r.cost > 0 && r.margin != null ? r.margin / r.cost : null;
      const x = (v: number) => `${v >= 10 ? Math.round(v) : v.toFixed(1).replace('.', ',')}×`;
      const steps = [
        { label: 'Ventas ganadas con leads del bot', value: formatCLP(r.sales) },
        { label: r.cost != null ? `Costo del sistema en ${p.days} días (cuota mensual ${formatCLP(m.settings.monthly_fee ?? 0)} × ${p.days} ÷ 30,4)` : 'Costo del sistema', value: r.cost != null ? formatCLP(r.cost) : 'sin configurar' },
      ];
      if (r.margin != null) steps.push({ label: `Margen de esas ventas (${m.settings.margin_pct}%)`, value: formatCLP(r.margin) });
      return {
        ...base, id, title: 'Retorno del sistema (ROI)',
        value: marginRatio != null ? x(marginRatio) : ratio != null ? x(ratio) : '—',
        caption: marginRatio != null ? `en margen · ${ratio != null ? `${x(ratio)} en ventas` : ''}` : ratio != null ? 'ventas por cada $1 del sistema' : 'Falta el costo mensual del sistema',
        tone: (marginRatio ?? ratio) == null ? 'neutral' : (marginRatio ?? ratio)! >= 3 ? 'good' : (marginRatio ?? ratio)! >= 1 ? 'warn' : 'bad',
        what: marginRatio != null
          ? 'Cuánto margen generaron las ventas del bot por cada peso que cuesta el sistema. Sobre 1× el sistema se paga solo.'
          : 'Cuántos pesos en ventas generó el bot por cada peso que cuesta el sistema. Es retorno sobre ventas, no sobre utilidad: para verlo en margen, configura el margen bruto promedio en Configuración comercial.',
        steps,
        result: ratio == null ? 'Sin costo configurado no se puede calcular.' : marginRatio != null
          ? `${formatCLP(r.margin!)} ÷ ${formatCLP(r.cost!)} = ${x(marginRatio)} en margen (${x(ratio)} en ventas)`
          : `${formatCLP(r.sales)} ÷ ${formatCLP(r.cost!)} = ${x(ratio)}`,
        sources: [SOURCE_WON, { data: 'Cuota mensual del sistema', where: 'Facturación de AutonomIA (la configura el equipo de AutonomIA)' }, { data: 'Margen bruto promedio', where: 'Configuración comercial > Operación (opcional)' }],
        counts: ['Solo ventas que nacieron del bot.', 'El costo se prorratea por los días del período.'],
        excludes: ['El ahorro de tiempo del bot (está aparte, en "Valor generado" más abajo).', 'Costos de los vendedores.'],
        drivers: ['Más ventas del bot (North Star)', 'Menos descuento (más margen)'],
        records: 'won',
      };
    }
    case 'funnel_leads':
    case 'funnel_contacted':
    case 'funnel_quoted':
    case 'funnel_won': {
      const f = m.funnel;
      const map = {
        funnel_leads: { title: 'Leads del bot', part: f.leads, prev: null, prevLabel: '', what: 'Cuántas oportunidades trajo el bot en el período: clientes que pidieron cotizar o dejaron sus datos para facturar.' },
        funnel_contacted: { title: 'Contactados', part: f.contacted, prev: f.leads, prevLabel: 'leads', what: 'De los leads que llegaron, cuántos ya fueron atendidos por un vendedor (correo, cotización o cambio de estado).' },
        funnel_quoted: { title: 'Cotizados', part: f.quoted, prev: f.contacted, prevLabel: 'contactados', what: 'De los leads que llegaron, cuántos ya recibieron una cotización enviada.' },
        funnel_won: { title: 'Ganados', part: f.won, prev: f.quoted, prevLabel: 'cotizados', what: 'De los leads que llegaron en el período, cuántos ya se convirtieron en venta. Los recientes pueden cerrar más adelante.' },
      }[id];
      const conv = map.prev != null ? pctText(map.part, map.prev) : null;
      return {
        ...base, id, title: map.title, value: `${map.part}`,
        caption: conv ? `${conv} de los ${map.prevLabel}` : range,
        tone: 'neutral', what: map.what,
        steps: [
          { label: `Leads del bot que llegaron entre el ${range}`, value: `${f.leads}` },
          { label: 'Atendidos por un vendedor', value: `${f.contacted} (${pctText(f.contacted, f.leads)})` },
          { label: 'Con cotización enviada', value: `${f.quoted} (${pctText(f.quoted, f.leads)})` },
          { label: 'Ganados', value: `${f.won} (${pctText(f.won, f.leads)}) · ${formatCLP(f.won_amount)}` },
          { label: 'Perdidos', value: `${f.lost}` },
        ],
        result: map.prev != null ? `${map.part} de ${map.prev} ${map.prevLabel} = ${conv}` : `${map.part} leads`,
        sources: [SOURCE_LEADS, SOURCE_QUOTED, SOURCE_WON],
        counts: ['Es una cohorte: sigue a los leads que LLEGARON en el período, hasta hoy.', LEAD_DEF],
        excludes: ['Leads de otros períodos (aunque se cierren en este).'],
        drivers: id === 'funnel_leads' ? ['Tráfico de WhatsApp', 'Que el bot detecte bien la intención de compra'] : id === 'funnel_won' ? ['Seguimiento', 'Precio y descuento', 'Velocidad de cotización'] : ['Velocidad de atención', 'Avisos de leads urgentes'],
        records: id === 'funnel_leads' ? 'leads' : id === 'funnel_contacted' ? 'leads_unattended' : 'leads',
        small: small(f.leads),
      };
    }
    case 'speed_contact':
    case 'speed_quote': {
      const s = m.speed;
      const isQuote = id === 'speed_quote';
      const median = isQuote ? s.quote_median : s.contact_median;
      const sample = isQuote ? s.quote_sample : s.contact_sample;
      return {
        ...base, id, title: isQuote ? 'Tiempo hasta cotizar' : 'Tiempo hasta atender',
        value: hoursText(median), caption: `horas hábiles (mitad de los casos) · ${sample} leads`,
        tone: median == null ? 'neutral' : median <= (isQuote ? m.settings.day_hours : m.settings.sla_hours) ? 'good' : median <= (isQuote ? m.settings.day_hours * 3 : m.settings.day_hours) ? 'warn' : 'bad',
        what: isQuote
          ? 'Cuánto se demora el equipo, en horas hábiles, desde que llega un lead hasta que le envía la cotización. Se usa la mediana: la mitad de los leads se cotizó en ese tiempo o menos.'
          : 'Cuánto se demora el equipo, en horas hábiles, desde que llega un lead hasta la primera acción del vendedor (correo, cotización o cambio de estado).',
        steps: [
          { label: `Leads del bot que llegaron entre el ${range} y ya ${isQuote ? 'se cotizaron' : 'se atendieron'}`, value: `${sample}` },
          { label: 'Horas hábiles de cada uno, ordenadas; se toma la del medio', value: hoursText(median) },
        ],
        result: median == null ? 'Aún no hay casos' : `La mitad se ${isQuote ? 'cotizó' : 'atendió'} en ${hoursText(median)} hábiles o menos`,
        sources: [SOURCE_LEADS, isQuote ? SOURCE_QUOTED : { data: 'Primera atención', where: 'Primer correo al cliente, cotización enviada o cambio de estado desde "Nueva"' }, { data: 'Horario hábil', where: 'Configuración comercial > Operación' }],
        counts: ['Solo horario hábil: noches y fines de semana no cuentan.', 'Mediana, no promedio: un caso muy lento no distorsiona.'],
        excludes: ['Leads aún sin ' + (isQuote ? 'cotizar' : 'atender') + ' (ver "Ver los datos").'],
        drivers: ['Avisos inmediatos', 'Mis leads ordenado por urgencia', '"Crear cotización" arma el borrador solo'],
        records: isQuote ? 'leads_fast' : 'leads_unattended', small: small(sample),
      };
    }
    case 'urgent_on_time': {
      const s = m.speed;
      return {
        ...base, id, title: 'Urgentes atendidos a tiempo', value: pctText(s.urgent_on_time, s.urgent),
        caption: `${s.urgent_on_time} de ${s.urgent} · plazo ${m.settings.sla_hours} h hábiles`,
        tone: s.urgent === 0 ? 'neutral' : s.urgent_on_time / s.urgent >= 0.8 ? 'good' : s.urgent_on_time / s.urgent >= 0.5 ? 'warn' : 'bad',
        what: 'Los leads urgentes (pidieron cotizar o dieron un plazo) que un vendedor atendió dentro del plazo prometido.',
        steps: [
          { label: `Leads urgentes que llegaron entre el ${range}`, value: `${s.urgent}` },
          { label: `Atendidos en ${m.settings.sla_hours} horas hábiles o menos`, value: `${s.urgent_on_time}` },
        ],
        result: `${s.urgent_on_time} de ${s.urgent} = ${pctText(s.urgent_on_time, s.urgent)}`,
        sources: [SOURCE_LEADS, { data: 'Urgencia', where: 'Frase del cliente en WhatsApp (pidió cotizar o dijo un plazo)' }, { data: 'Plazo', where: 'Configuración comercial > Operación' }],
        counts: ['Atendido = correo al cliente, cotización enviada o cambio de estado.'],
        excludes: ['Leads no urgentes.'],
        drivers: ['Tener el panel abierto con avisos del navegador', 'Asignación automática por zona'],
        records: 'leads_unattended', small: small(s.urgent),
      };
    }
    case 'avg_ticket':
      return {
        ...base, id, title: 'Ticket promedio', value: m.value.avg_ticket != null ? formatCLP(m.value.avg_ticket) : '—',
        caption: `${m.north_star.count} ventas del bot · neto`,
        what: 'Monto neto promedio de cada venta ganada con leads del bot.',
        steps: [{ label: 'Total ganado', value: formatCLP(m.north_star.amount) }, { label: 'Ventas', value: `${m.north_star.count}` }],
        result: m.value.avg_ticket != null ? `${formatCLP(m.north_star.amount)} ÷ ${m.north_star.count} = ${formatCLP(m.value.avg_ticket)}` : 'Aún no hay ventas',
        sources: [SOURCE_WON], counts: ['Ventas cerradas en el período.'], excludes: ['Ventas con monto $0 o sin monto.'],
        drivers: ['Ofrecer el equipo adecuado (no el más barato)', 'Accesorios y mantención'], records: 'won', small: small(m.north_star.count),
      };
    case 'avg_discount': {
      const d = m.value.avg_discount_pct;
      const limit = m.settings.discount_limit;
      return {
        ...base, id, title: 'Descuento promedio', value: d != null ? `${String(d).replace('.', ',')}%` : '—',
        caption: `${m.value.discount_sample} ventas con cotización del sistema`,
        tone: d == null ? 'neutral' : limit != null && d > limit ? 'bad' : limit != null && d > limit * 0.7 ? 'warn' : 'good',
        what: 'Cuánto descuento, en promedio, se dio en las ventas ganadas: la diferencia entre el precio de lista y el precio final de la cotización aceptada.',
        steps: [{ label: 'Por cada cotización aceptada: descuento total ÷ subtotal antes de descuento', value: '' }, { label: 'Promedio de esos porcentajes', value: d != null ? `${d}%` : '—' }, ...(limit != null ? [{ label: 'Tope permitido (Configuración comercial)', value: `${limit}%` }] : [])],
        result: d != null ? `${String(d).replace('.', ',')}% de descuento promedio` : 'Aún no hay ventas con cotización del sistema',
        sources: [{ data: 'Cotizaciones aceptadas', where: 'Editor de cotización (descuento por línea y descuento global)' }],
        counts: ['Solo ventas cerradas con cotización hecha en el sistema.'], excludes: ['Ventas cerradas con el flujo antiguo (no tienen el detalle de descuento).'],
        drivers: ['Argumentario para la objeción de precio', 'Aprobación de descuentos sobre el tope'], records: 'won', small: small(m.value.discount_sample),
      };
    }
    case 'cycle':
      return {
        ...base, id, title: 'Ciclo de venta', value: m.value.cycle_median_days != null ? `${Math.round(m.value.cycle_median_days)} días` : '—',
        caption: 'desde que llega el lead hasta que se gana (mitad de los casos)',
        what: 'Cuántos días pasan, en la mitad de los casos, desde que el bot crea el lead hasta que la venta se cierra. Sirve para saber cuándo esperar la plata.',
        steps: [{ label: `Ventas ganadas entre el ${range}`, value: `${m.north_star.count}` }, { label: 'Días de cada una, ordenados; se toma el del medio', value: m.value.cycle_median_days != null ? `${Math.round(m.value.cycle_median_days)}` : '—' }],
        result: m.value.cycle_median_days != null ? `La mitad cerró en ${Math.round(m.value.cycle_median_days)} días o menos` : 'Aún no hay ventas',
        sources: [SOURCE_LEADS, SOURCE_WON], counts: ['Días corridos (incluye fines de semana).'], excludes: ['Ventas que no nacieron del bot.'],
        drivers: ['Cotizar rápido', 'Seguimiento con fecha ("Qué hacer ahora")'], records: 'won', small: small(m.north_star.count),
      };
    case 'pipeline':
      return {
        ...base, id, title: 'Pipeline abierto', value: formatCLP(m.pipeline.amount),
        caption: `${m.pipeline.count} cotizaciones enviadas sin cerrar · ${formatCLP(m.pipeline.cold_amount)} frío`,
        tone: m.pipeline.amount > 0 && m.pipeline.cold_amount / m.pipeline.amount > 0.5 ? 'warn' : 'neutral',
        what: 'La plata que está en juego hoy: cotizaciones ya enviadas a clientes que todavía no aceptan ni rechazan. "Frío" es la parte enviada hace más de 5 días sin respuesta.',
        steps: [
          { label: 'Cotizaciones enviadas y abiertas (hoy)', value: `${m.pipeline.count} · ${formatCLP(m.pipeline.amount)}` },
          { label: 'Enviadas hace más de 5 días', value: `${m.pipeline.cold_count} · ${formatCLP(m.pipeline.cold_amount)}` },
        ],
        result: `${formatCLP(m.pipeline.amount)} en juego; ${pctText(m.pipeline.cold_amount, m.pipeline.amount)} está frío`,
        sources: [SOURCE_QUOTED], counts: ['Es una foto de HOY: no depende del período elegido.', 'Monto neto de la última cotización enviada.'],
        excludes: ['Cotizaciones en preparación o aún no enviadas.', 'Leads que no nacieron del bot.'],
        drivers: ['Seguimiento a las frías', 'Recordatorios de "Qué hacer ahora"'], records: 'pipeline',
      };
    case 'lost': {
      const reasons = m.value.lost_reasons ?? [];
      return {
        ...base, id, title: 'Ventas perdidas', value: `${m.value.lost}`,
        caption: reasons[0] ? `Motivo más común: ${reasons[0].reason}` : range,
        what: 'Leads del bot que se marcaron como perdidos en el período, con su motivo.',
        steps: reasons.map(r => ({ label: r.reason, value: `${r.count}` })),
        result: `${m.value.lost} ${m.value.lost === 1 ? 'venta perdida' : 'ventas perdidas'}`,
        sources: [{ data: 'Motivo de pérdida', where: 'Botón "Rechazada" en la cotización (motivos en Configuración comercial)' }],
        counts: ['Pérdidas registradas en el período.'], excludes: ['Leads sin respuesta que nadie marcó como perdidos.'],
        drivers: ['Revisar el motivo más común con el equipo'], records: null, small: small(m.value.lost),
      };
    }
    case 'clients_waiting':
      return {
        ...base, id, title: 'Clientes esperando respuesta', value: `${m.health.clients_waiting}`,
        caption: 'escribieron por correo hace más de 24 h', tone: m.health.clients_waiting > 0 ? 'bad' : 'good',
        what: 'Clientes cuyo último correo quedó sin respuesta del vendedor por más de 24 horas. Es una foto de hoy.',
        steps: [{ label: 'Clientes cuyo último correo lo escribió el cliente, hace más de 24 h', value: `${m.health.clients_waiting}` }],
        result: `${m.health.clients_waiting} ${m.health.clients_waiting === 1 ? 'cliente espera' : 'clientes esperan'}`,
        sources: [{ data: 'Correos con clientes', where: 'Outlook conectado de cada vendedor (Correos del equipo)' }],
        counts: ['Solo correos con contactos del sistema.'], excludes: ['WhatsApp (lo atiende el bot).', 'Correos de vendedores sin Outlook conectado.'],
        drivers: ['"Te escribieron" arriba en Mis leads', 'Aviso en la campanita'], records: null,
      };
    case 'discount_over_limit':
      return {
        ...base, id, title: 'Descuentos sobre el tope', value: `${m.health.discount_over_limit}`,
        caption: `cotizaciones emitidas con más de ${m.settings.discount_limit ?? '—'}%`, tone: m.health.discount_over_limit > 0 ? 'warn' : 'good',
        what: 'Cotizaciones oficiales emitidas en el período con un descuento mayor al tope permitido.',
        steps: [{ label: `Cotizaciones emitidas entre el ${range} con descuento sobre el tope`, value: `${m.health.discount_over_limit}` }],
        result: `${m.health.discount_over_limit}`,
        sources: [{ data: 'Cotizaciones emitidas', where: 'Editor de cotización' }, { data: 'Tope', where: 'Configuración comercial > Alertas y aprobaciones' }],
        counts: ['Todas las cotizaciones emitidas, vengan o no del bot.'], excludes: ['Borradores y anuladas.'], drivers: ['Argumentario de precio'], records: null,
      };
    case 'email_tone':
      return {
        ...base, id, title: 'Calidad de correos (IA)', value: m.health.tone_avg != null ? `${String(m.health.tone_avg).replace('.', ',')}/5` : '—',
        caption: `tono promedio · ${m.health.reviewed} correos revisados`,
        tone: m.health.tone_avg == null ? 'neutral' : m.health.tone_avg >= 4 ? 'good' : m.health.tone_avg >= 3 ? 'warn' : 'bad',
        what: 'La IA revisa cada correo que un vendedor envía a un cliente: tono, si respondió lo que se preguntó, si propuso un siguiente paso y si prometió algo que no calza con la cotización. Aquí se muestra el tono promedio; el detalle está bajo cada correo.',
        steps: [{ label: `Correos enviados y revisados entre el ${range}`, value: `${m.health.reviewed}` }, { label: 'Promedio del tono (1 a 5)', value: m.health.tone_avg != null ? `${m.health.tone_avg}` : '—' }],
        result: m.health.tone_avg != null ? `${m.health.tone_avg}/5` : 'Aún no hay correos revisados',
        sources: [{ data: 'Revisión de correos', where: 'Automática cada 10 minutos (IA), se ve bajo cada correo' }],
        counts: ['Solo correos de vendedores a clientes.'], excludes: ['Correos sin texto o muy cortos.'], drivers: ['"Sugerir con IA" al responder'], records: null, small: small(m.health.reviewed),
      };
    case 'adherence':
      return {
        ...base, id, title: 'Recomendaciones seguidas', value: pctText(m.health.actions_followed, m.health.actions_due),
        caption: `${m.health.actions_followed} de ${m.health.actions_due} a tiempo`,
        tone: m.health.actions_due === 0 ? 'neutral' : m.health.actions_followed / m.health.actions_due >= 0.7 ? 'good' : m.health.actions_followed / m.health.actions_due >= 0.4 ? 'warn' : 'bad',
        what: 'Cada lead tiene una sugerencia de "Qué hacer ahora" con fecha. Esta métrica muestra cuántas se cumplieron antes de su fecha.',
        steps: [{ label: `Sugerencias con fecha entre el ${shortDate(p.from)} y ayer`, value: `${m.health.actions_due}` }, { label: 'Cumplidas a tiempo', value: `${m.health.actions_followed}` }],
        result: `${m.health.actions_followed} de ${m.health.actions_due}`,
        sources: [{ data: '"Qué hacer ahora"', where: 'Tarjeta en cada lead (Mis leads) y "Qué hacer hoy" en Mi día' }],
        counts: ['Cumplida = el vendedor la marcó "Hecho" o actuó en el lead (correo, cotización, cambio de estado) antes de la fecha.'],
        excludes: ['Sugerencias de "esperar".', 'Las que vencen hoy o después.'], drivers: ['Revisar "Qué hacer hoy" cada mañana'], records: null, small: small(m.health.actions_due),
      };
  }
}

export function recordsFor(kind: Explanation['records'], m: CommercialMetrics): MetricRecord[] {
  switch (kind) {
    case 'won': return m.records.won ?? [];
    case 'leads': return m.records.leads ?? [];
    case 'leads_fast': return (m.records.leads ?? []).filter(r => r.stage !== 'Sin atender' && r.stage !== 'Contactado');
    case 'leads_unattended': return (m.records.leads ?? []).filter(r => r.stage === 'Sin atender');
    case 'pipeline': return m.records.pipeline ?? [];
    case 'pipeline_cold': return (m.records.pipeline ?? []).filter(r => r.cold);
    default: return [];
  }
}

export const groupNote = (fast: number, leads: number) => `${pctText(fast, leads)} en 1 día hábil`;
export { num };
