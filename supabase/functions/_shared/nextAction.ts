// "Qué hacer ahora" (F5): the next action for a lead, with a date and an
// argument. Pure: prompt, dates and sanitizer (unit-tested).

export const ACTION_TYPES = ['call', 'email', 'send_quote', 'follow_up', 'visit', 'wait'] as const;
export type ActionType = typeof ACTION_TYPES[number];

export interface NextAction {
  action_type: ActionType;
  action: string;
  due: string; // YYYY-MM-DD
  argument: string | null;
  evidence: string | null;
  reason: string | null;
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

// Today's date (YYYY-MM-DD) in a time zone.
export function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const isoDow = (date: string) => { const d = new Date(`${date}T12:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; };

export function nextBusinessDay(date: string, businessDays: number[]): string {
  let d = date;
  for (let i = 0; i < 7 && !businessDays.includes(isoDow(d)); i++) d = addDays(d, 1);
  return d;
}

// Business days only, between today and 10 days ahead.
export function clampDue(raw: unknown, today: string, businessDays: number[]): string {
  const value = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today;
  const max = addDays(today, 10);
  const bounded = value < today ? today : value > max ? max : value;
  return nextBusinessDay(bounded, businessDays);
}

export function calendarHint(today: string, businessDays: number[]): string {
  const days: string[] = [];
  for (let i = 0; i <= 7; i++) {
    const d = addDays(today, i);
    if (businessDays.includes(isoDow(d))) days.push(`${WEEKDAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${d}${i === 0 ? ' (hoy)' : i === 1 ? ' (mañana)' : ''}`);
  }
  return days.join(', ');
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

export interface LeadContext {
  companyName: string | null;
  client: string;
  stage: string;
  priority: string | null;
  quote: string | null;
  whatsappSummary: string | null;
  clientMessages: Array<{ at: string; text: string }>;
  emails: Array<{ direction: 'in' | 'out'; at: string; text: string }>;
  missing: string[];
  lastSellerContact: string | null;
  playbookTitles: string[];
  lastDone?: { action: string; at: string; note: string | null } | null;
}

export function buildNextActionPrompt(ctx: LeadContext, today: string, businessDays: number[]): string {
  const whatsapp = ctx.clientMessages.length
    ? ctx.clientMessages.map(m => `- [${m.at.slice(0, 16).replace('T', ' ')}] ${cut(m.text, 300)}`).join('\n')
    : '(sin mensajes del cliente por WhatsApp)';
  const emails = ctx.emails.length
    ? ctx.emails.map(e => `[${e.direction === 'in' ? 'CLIENTE' : 'VENDEDOR'} · ${e.at.slice(0, 16).replace('T', ' ')}] ${cut(e.text.trim(), 600)}`).join('\n\n')
    : '(sin correos)';
  return `Eres jefe de ventas de ${ctx.companyName ?? 'la empresa'} (hidrolavadoras industriales, Chile). Decide la PRÓXIMA ACCIÓN del vendedor con este lead.

HOY: ${today}. Días hábiles disponibles: ${calendarHint(today, businessDays)}.

LEAD: ${ctx.client}
ETAPA: ${ctx.stage}
${ctx.priority ? `PRIORIDAD: ${ctx.priority}\n` : ''}COTIZACIÓN: ${ctx.quote ?? 'no hay cotización oficial todavía'}
ÚLTIMO CONTACTO DEL VENDEDOR: ${ctx.lastSellerContact ?? 'nunca'}
${ctx.lastDone ? `ÚLTIMA ACCIÓN QUE HIZO EL VENDEDOR: ${ctx.lastDone.action} (${ctx.lastDone.at.slice(0, 10)})${ctx.lastDone.note ? `. Su nota: "${cut(ctx.lastDone.note, 300)}"` : ''}\n` : ''}${ctx.missing.length ? `LO QUE FALTA SABER DEL CLIENTE: ${ctx.missing.join('; ')}\n` : ''}${ctx.whatsappSummary ? `RESUMEN DE WHATSAPP: ${cut(ctx.whatsappSummary, 600)}\n` : ''}
MENSAJES DEL CLIENTE POR WHATSAPP (recientes):
${whatsapp}

CORREOS (del más antiguo al más nuevo):
${emails}
${ctx.playbookTitles.length ? `\nARGUMENTARIO DISPONIBLE (títulos): ${ctx.playbookTitles.join('; ')}\n` : ''}
Responde SOLO con este JSON:
{
  "action_type": "call" | "email" | "send_quote" | "follow_up" | "visit" | "wait",
  "action": "qué hacer, en imperativo y concreto (ej. 'Llamar para confirmar la dirección de despacho y el plazo')",
  "due": "YYYY-MM-DD, uno de los días hábiles de arriba",
  "argument": "el argumento o dato clave para esa acción, basado en lo que dijo el cliente, o null",
  "evidence": "frase COPIADA TEXTUAL del CLIENTE que justifica la acción, o null",
  "reason": "por qué esta acción y esta fecha, en una frase"
}

REGLAS:
- Si el cliente escribió y nadie le ha respondido: responder es lo primero (hoy).
- Si pidió cotización y no se ha enviado: "send_quote", hoy.
- Si se envió la cotización hace más de 3 días hábiles sin respuesta: "follow_up" o "call".
- "wait" solo si el cliente pidió explícitamente esperar o dio una fecha; en ese caso "due" es esa fecha.
- No inventes datos: precios, plazos o descuentos solo si aparecen arriba.
- Español de Chile, breve.`;
}

const norm = (text: string) =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[¿?¡!"“”'.,;:()]/g, ' ').replace(/\s+/g, ' ').trim();

const clean = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || text.toLowerCase() === 'null') return null;
  if (text.length <= max) return text;
  const slice = text.slice(0, max - 1);
  const space = slice.lastIndexOf(' ');
  return `${space > max * 0.6 ? slice.slice(0, space) : slice}…`;
};

export function sanitizeNextAction(raw: unknown, clientTexts: string[], today: string, businessDays: number[]): NextAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const action = clean(data.action, 140);
  if (!action) return null;
  const actionType = (ACTION_TYPES as readonly string[]).includes(String(data.action_type)) ? data.action_type as ActionType : 'follow_up';
  const evidenceRaw = clean(data.evidence, 200)?.replace(/^["“”']+|["“”']+$/g, '') ?? null;
  const haystack = clientTexts.map(norm).join(' \n ');
  const evidence = evidenceRaw && norm(evidenceRaw).length >= 4 && haystack.includes(norm(evidenceRaw)) ? evidenceRaw : null;
  return {
    action_type: actionType,
    action,
    due: clampDue(data.due, today, businessDays),
    argument: clean(data.argument, 300),
    evidence,
    reason: clean(data.reason, 200),
  };
}

// When the AI gives nothing usable: a sensible rule-based suggestion, so the
// lead is not retried every run.
export function fallbackNextAction(facts: {
  clientWroteLast: boolean;
  quoteStatus: string | null;
  quoteSentAt: string | null;
  contacted: boolean;
}, today: string, businessDays: number[]): NextAction {
  const base = { argument: null, evidence: null };
  if (facts.clientWroteLast) return { ...base, action_type: 'email', action: 'Responder el último correo del cliente', due: nextBusinessDay(today, businessDays), reason: 'El cliente escribió y espera respuesta.' };
  if (facts.quoteStatus === 'issued') return { ...base, action_type: 'send_quote', action: 'Enviar la cotización al cliente', due: nextBusinessDay(today, businessDays), reason: 'La cotización está lista pero no se ha enviado.' };
  if (!facts.contacted) return { ...base, action_type: 'call', action: 'Llamar al cliente para conocer su necesidad', due: nextBusinessDay(today, businessDays), reason: 'Nadie lo ha contactado todavía.' };
  if (facts.quoteStatus === 'sent') {
    const sent = (facts.quoteSentAt ?? today).slice(0, 10);
    const target = addDays(sent > today ? today : sent, 3);
    return { ...base, action_type: 'follow_up', action: 'Hacer seguimiento de la cotización enviada', due: clampDue(target < today ? today : target, today, businessDays), reason: 'Se envió la cotización y falta saber qué decidió.' };
  }
  return { ...base, action_type: 'follow_up', action: 'Retomar el contacto con el cliente', due: clampDue(addDays(today, 2), today, businessDays), reason: 'Mantener la conversación activa.' };
}
