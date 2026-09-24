// Bottom-of-funnel qualification (commercial module). Solicitudes only gets a
// customer who is ready to buy, i.e. at least one of:
//   · asked explicitly for a formal quote or to buy ("cotízame la MH130",
//     "mándame la cotización", "la quiero"), with their exact words as evidence
//   · left company or RUT to be quoted
// Picking a model from the menu, asking for a datasheet or a price, or a high
// lead score are only context: they are listed in the request, never a trigger.

export interface HotLeadInput {
  quoteRequest: string | null        // phrase the analysis says the customer used
  customerMessages: string[]         // what the customer actually wrote
  leadScore: number
  events: Array<{ event_type: string; sku_normalized: string | null }>
  companyName: string | null
  taxId: string | null
  summary: string | null
  skuLabels: Map<string, string>
}

export interface HotLeadQualification {
  reasons: Array<Record<string, unknown>>
  description: string
}

function normalizeText(value: string): string {
  return (value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const ASSENT_WORDS = new Set([
  'si', 'ok', 'okay', 'dale', 'ya', 'listo', 'claro', 'bueno', 'buena', 'perfecto', 'gracias', 'porfa',
  'por', 'favor', 'obvio', 'de', 'acuerdo', 'bien', 'vale', 'genial', 'excelente', 'exacto', 'ya', 'po', 'null',
])

// The phrase must be really written by the customer and say something on its
// own: "sí", "ok dale" or "perfecto gracias" are never evidence of a quote request.
export function verifiedQuoteRequest(phrase: unknown, customerMessages: string[]): string | null {
  if (typeof phrase !== 'string') return null
  const trimmed = phrase.trim().replace(/^["“”']+|["“”']+$/g, '')
  const normalized = normalizeText(trimmed)
  if (!normalized || normalized.split(' ').every((word) => ASSENT_WORDS.has(word))) return null
  const found = customerMessages.some((message) => ` ${normalizeText(message)} `.includes(` ${normalized} `))
  return found ? trimmed.slice(0, 200) : null
}

export function buildHotLeadQualification(input: HotLeadInput): HotLeadQualification | null {
  const label = (sku: string) => input.skuLabels.get(sku) ?? sku
  const skusOf = (type: string) => [...new Set(
    input.events.filter((e) => e.event_type === type && e.sku_normalized).map((e) => e.sku_normalized as string),
  )]

  const reasons: Array<Record<string, unknown>> = []
  const why: string[] = []

  const quote = verifiedQuoteRequest(input.quoteRequest, input.customerMessages)
  if (quote) {
    reasons.push({ rule: 'quote_requested', evidence: quote })
    why.push(`pidió cotizar ("${quote}")`)
  }
  if (input.companyName || input.taxId) {
    reasons.push({ rule: 'billing_data', company_name: input.companyName, tax_id: input.taxId })
    const data = [input.companyName, input.taxId ? `RUT ${input.taxId}` : null].filter(Boolean).join(', ')
    why.push(`dejó datos para cotizar (${data})`)
  }
  if (reasons.length === 0) return null

  const chosen = skusOf('chosen')
  const context = [
    chosen.length > 0 ? `eligió ${chosen.map(label).join(', ')}` : null,
    skusOf('datasheet_sent').length > 0 ? 'recibió ficha técnica' : null,
    `puntaje ${input.leadScore}`,
  ].filter(Boolean)
  const interest = [...new Set([...chosen, ...skusOf('customer_asked'), ...skusOf('recommended')])].slice(0, 5)

  const lines = [
    'Lead listo para cotizar, detectado por el bot.',
    `Motivo: ${why.join(' · ')}.`,
    `Contexto: ${context.join(' · ')}.`,
    interest.length > 0 ? `Equipos de interés: ${interest.map(label).join(', ')}.` : null,
    input.summary ? `Resumen: ${input.summary}` : null,
  ].filter(Boolean)

  return { reasons, description: lines.join('\n') }
}
