// AI review of an email a seller sent to a client (F5): tone, whether it
// answered what the client asked, whether it proposed a next step, risky
// promises and one concrete improvement. Pure: prompt + sanitizer (tested).

export interface ThreadEmail {
  direction: 'in' | 'out';
  sent_at: string;
  subject: string | null;
  body_text: string;
}

export interface QuoteFacts {
  number: string | null;
  lines: Array<{ description: string; quantity: number; unit_price: number; discount_pct: number }>;
  net_total: number | null;
  total: number | null;
  validity_days: number | null;
  payment_terms: string | null;
  delivery_terms: string | null;
}

export interface EmailReview {
  tone: number;
  tone_label: string | null;
  answered: 'all' | 'partial' | 'none' | 'nothing_asked';
  unanswered: string[];
  next_step: boolean;
  next_step_text: string | null;
  risks: string[];
  strengths: string[];
  improve: string | null;
  summary: string | null;
}

const clp = (value: number | null | undefined) =>
  value == null ? '?' : `$${Math.round(Number(value)).toLocaleString('es-CL')}`;

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

export function buildReviewPrompt(input: {
  companyName: string | null;
  sellerName: string | null;
  clientName: string | null;
  thread: ThreadEmail[];
  email: ThreadEmail;
  quote: QuoteFacts | null;
}): string {
  const history = input.thread.length
    ? input.thread.map(e => `[${e.direction === 'in' ? 'CLIENTE' : 'VENDEDOR'} · ${e.sent_at.slice(0, 16).replace('T', ' ')}] ${e.subject ?? ''}\n${cut(e.body_text.trim(), 1200)}`).join('\n\n')
    : '(no hay correos anteriores: es el primer correo del vendedor a este cliente)';
  const quote = input.quote
    ? `COTIZACIÓN ${input.quote.number ?? ''} (datos oficiales):
${input.quote.lines.map(l => `- ${l.quantity} × ${l.description}: ${clp(l.unit_price)} neto c/u${Number(l.discount_pct) > 0 ? `, ${l.discount_pct}% dcto.` : ''}`).join('\n')}
Neto ${clp(input.quote.net_total)} · Total con IVA ${clp(input.quote.total)} · Validez ${input.quote.validity_days ?? '?'} días · Pago: ${input.quote.payment_terms ?? '—'} · Entrega: ${input.quote.delivery_terms ?? '—'}`
    : 'COTIZACIÓN: no hay una cotización oficial asociada a este correo.';

  return `Eres jefe de ventas de ${input.companyName ?? 'la empresa'} (hidrolavadoras industriales, Chile). Evalúa el correo que el vendedor ${input.sellerName ?? ''} le envió al cliente ${input.clientName ?? ''}.

${quote}

CORREOS ANTERIORES CON EL CLIENTE (del más antiguo al más nuevo):
${history}

CORREO A EVALUAR (del VENDEDOR):
Asunto: ${input.email.subject ?? '—'}
${cut(input.email.body_text.trim(), 3000)}

Responde SOLO con este JSON:
{
  "tone": 1 a 5 (5 = cordial, profesional y claro; 1 = descortés o confuso),
  "tone_label": "2 a 4 palabras que describan el tono",
  "answered": "all" si respondió todo lo que el cliente preguntó en su último correo, "partial" si respondió una parte, "none" si no respondió nada, "nothing_asked" si el cliente no había preguntado nada,
  "unanswered": ["pregunta del cliente que quedó sin responder, COPIADA TEXTUAL de su correo"],
  "next_step": true si el correo propone un siguiente paso concreto (llamada, visita, fecha, confirmar compra, enviar orden de compra),
  "next_step_text": "el siguiente paso propuesto, en pocas palabras, o null",
  "risks": ["promesa o dato riesgoso: precio, descuento, plazo o característica que NO coincide con la cotización oficial o que se promete sin respaldo"],
  "strengths": ["lo que hizo bien, máximo 2, en pocas palabras"],
  "improve": "UNA sugerencia concreta para mejorar este correo, o null si está muy bien",
  "summary": "una frase que resuma la calidad del correo"
}

REGLAS:
- Evalúa solo lo que está escrito. No inventes preguntas del cliente.
- "unanswered": máximo 3; cada una copiada textual del correo del CLIENTE.
- "risks": máximo 3; si todo coincide con la cotización oficial, lista vacía.
- Sé justo y breve. Español de Chile.`;
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

const list = (value: unknown, maxItems: number, maxLength: number) =>
  (Array.isArray(value) ? value : []).map(v => clean(v, maxLength)).filter((v): v is string => !!v).slice(0, maxItems);

// Keeps only what the model can back up. Questions "left unanswered" must be
// in the client's own emails; otherwise they are dropped.
export function sanitizeReview(raw: unknown, clientTexts: string[]): EmailReview | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const tone = Math.round(Number(data.tone));
  if (!Number.isFinite(tone)) return null;

  const haystack = clientTexts.map(norm).join(' \n ');
  const unanswered = list(data.unanswered, 3, 200)
    .map(q => q.replace(/^["“”']+|["“”']+$/g, ''))
    .filter(q => norm(q).length >= 6 && haystack.includes(norm(q)));

  const askedNothing = clientTexts.length === 0;
  let answered = (['all', 'partial', 'none', 'nothing_asked'] as const).find(a => a === data.answered) ?? 'nothing_asked';
  if (askedNothing) answered = 'nothing_asked';
  if (answered === 'all' && unanswered.length > 0) answered = 'partial';

  const nextStepText = clean(data.next_step_text, 140);
  return {
    tone: Math.min(5, Math.max(1, tone)),
    tone_label: clean(data.tone_label, 40),
    answered,
    unanswered: askedNothing ? [] : unanswered,
    next_step: data.next_step === true,
    next_step_text: data.next_step === true ? nextStepText : null,
    risks: list(data.risks, 3, 200),
    strengths: list(data.strengths, 2, 120),
    improve: clean(data.improve, 240),
    summary: clean(data.summary, 200),
  };
}
