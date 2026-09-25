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
  leadScore: number   // kept for the caller's log; not a trigger
  events: Array<{ event_type: string; sku_normalized: string | null }>
  companyName: string | null
  taxId: string | null
  summary: string | null   // not used in the text: it goes stale
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
  const quote = verifiedQuoteRequest(input.quoteRequest, input.customerMessages)
  if (quote) reasons.push({ rule: 'quote_requested', evidence: quote })
  const billingData = [input.companyName, input.taxId ? `RUT ${input.taxId}` : null].filter(Boolean).join(' · ')
  if (billingData) reasons.push({ rule: 'billing_data', company_name: input.companyName, tax_id: input.taxId })
  if (reasons.length === 0) return null

  // Short, plain text for the request card. The detail view renders the reasons
  // and the live equipment itself, so nothing here goes stale.
  const chosen = skusOf('chosen')
  const interest = [...new Set([...chosen, ...skusOf('customer_asked'), ...skusOf('datasheet_sent'), ...skusOf('recommended')])]
  const lines = [
    quote ? `Pidió cotizar por WhatsApp: “${quote}”` : `Dejó sus datos para facturar (${billingData}).`,
    interest.length > 0 ? `Equipo: ${interest.slice(0, 2).map(label).join(', ')}${interest.length > 2 ? ` y ${interest.length - 2} más` : ''}.` : null,
  ].filter(Boolean)

  return { reasons, description: lines.join('\n') }
}
