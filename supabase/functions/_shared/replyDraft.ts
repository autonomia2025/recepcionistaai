// "Sugerir respuesta" (F5): a draft of the seller's next email to a client.
// The seller always reviews it before sending. Pure: prompt + sanitizer.

import type { QuoteFacts, ThreadEmail } from './emailReview.ts';

export interface ReplyDraft {
  draft: string;
  checks: string[];
}

const clp = (value: number | null | undefined) =>
  value == null ? '?' : `$${Math.round(Number(value)).toLocaleString('es-CL')}`;
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

export function buildReplyPrompt(input: {
  companyName: string | null;
  sellerName: string | null;
  clientName: string | null;
  thread: ThreadEmail[];
  quote: QuoteFacts | null;
  equipment: string;
  terms: { payment: string | null; delivery: string | null; validity: number | null };
  playbook: string;
  whatsappSummary: string | null;
  intent: 'answer' | 'follow_up';
}): string {
  const history = input.thread.length
    ? input.thread.map(e => `[${e.direction === 'in' ? 'CLIENTE' : 'VENDEDOR'} · ${e.sent_at.slice(0, 16).replace('T', ' ')}] ${e.subject ?? ''}\n${cut(e.body_text.trim(), 1500)}`).join('\n\n')
    : '(todavía no hay correos con este cliente)';
  const quote = input.quote
    ? `COTIZACIÓN ${input.quote.number ?? ''}:
${input.quote.lines.map(l => `- ${l.quantity} × ${l.description}: ${clp(l.unit_price)} neto c/u${Number(l.discount_pct) > 0 ? `, ${l.discount_pct}% dcto.` : ''}`).join('\n')}
Neto ${clp(input.quote.net_total)} · Total con IVA ${clp(input.quote.total)} · Validez ${input.quote.validity_days ?? '?'} días · Pago: ${input.quote.payment_terms ?? '—'} · Entrega: ${input.quote.delivery_terms ?? '—'}`
    : 'COTIZACIÓN: aún no hay cotización oficial.';

  const task = input.intent === 'answer'
    ? 'Escribe la RESPUESTA del vendedor al último correo del cliente: responde cada pregunta que hizo, con datos de arriba.'
    : 'Escribe un correo de SEGUIMIENTO del vendedor para retomar la conversación y avanzar hacia la compra.';

  return `Eres ${input.sellerName ?? 'el vendedor'} de ${input.companyName ?? 'la empresa'} (hidrolavadoras industriales, Chile). Cliente: ${input.clientName ?? '—'}.

${quote}

EQUIPOS QUE LE INTERESAN (catálogo; única fuente de especificaciones y precios):
${input.equipment || '(sin datos de catálogo)'}

CONDICIONES DE LA EMPRESA: pago "${input.terms.payment ?? 'a convenir'}", entrega "${input.terms.delivery ?? 'según disponibilidad'}", validez ${input.terms.validity ?? 15} días.

${input.whatsappSummary ? `RESUMEN DE LO CONVERSADO POR WHATSAPP:\n${cut(input.whatsappSummary, 800)}\n` : ''}${input.playbook ? `ARGUMENTARIO DE VENTAS:\n${input.playbook}\n` : ''}
CORREOS CON EL CLIENTE (del más antiguo al más nuevo):
${history}

TAREA: ${task}

Responde SOLO con este JSON:
{
  "draft": "el cuerpo del correo, listo para enviar",
  "checks": ["dato que el vendedor debe confirmar antes de enviar, porque no está arriba"]
}

REGLAS:
- Español de Chile, cordial y directo. Breve: 4 a 10 líneas. Tutea si el cliente tutea; si no, usa usted.
- Empieza con "Hola <nombre del cliente>," y termina con "Saludos," (sin firma: se agrega sola).
- NUNCA inventes precios, descuentos, plazos de entrega, stock ni características. Si hace falta un dato que no está arriba, escribe [corchetes] con lo que falta (ej. [plazo de entrega]) y agrégalo a "checks".
- Propón un siguiente paso concreto (llamada, visita, confirmar la orden de compra, una fecha).
- No repitas la cotización completa; menciona solo lo necesario.`;
}

export function sanitizeDraft(raw: unknown): ReplyDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (typeof data.draft !== 'string') return null;
  let draft = data.draft.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  // The signature is added when sending: drop anything after "Saludos,".
  const bye = draft.search(/\n(saludos|atentamente|un abrazo|quedo atento)[^\n]*\n?/i);
  if (bye !== -1) {
    const line = draft.slice(bye + 1).split('\n')[0];
    draft = `${draft.slice(0, bye + 1)}${line}`.trim();
  }
  if (draft.length < 20) return null;
  draft = draft.slice(0, 4000);
  const checks = (Array.isArray(data.checks) ? data.checks : [])
    .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    .map(c => c.trim().slice(0, 160))
    .slice(0, 4);
  // Every [placeholder] left in the text is something to confirm.
  for (const match of draft.matchAll(/\[([^\]\n]{2,60})\]/g)) {
    const item = `Completar: ${match[1]}`;
    if (!checks.some(c => c.toLowerCase().includes(match[1].toLowerCase())) && checks.length < 6) checks.push(item);
  }
  return { draft, checks };
}
