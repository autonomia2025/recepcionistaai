// Hot lead qualification (commercial module). A customer becomes a request in
// Solicitudes when any of these holds, and the request stores why:
//   · lead_score >= 80 (the same "caliente" threshold Clientes already uses)
//   · picked a model from the bot's menu
//   · left company or RUT (billing data for the quote)

export const HOT_LEAD_SCORE = 80

export interface HotLeadInput {
  leadScore: number
  leadScoreReasoning: string | null
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

export function buildHotLeadQualification(input: HotLeadInput): HotLeadQualification | null {
  const label = (sku: string) => input.skuLabels.get(sku) ?? sku
  const skusOf = (type: string) => [...new Set(
    input.events.filter((e) => e.event_type === type && e.sku_normalized).map((e) => e.sku_normalized as string),
  )]

  const chosen = skusOf('chosen')
  const reasons: Array<Record<string, unknown>> = []
  const why: string[] = []

  if (chosen.length > 0) {
    reasons.push({ rule: 'chose_model', skus: chosen })
    why.push(`eligió ${chosen.map(label).join(', ')}`)
  }
  if (input.leadScore >= HOT_LEAD_SCORE) {
    reasons.push({ rule: 'lead_score', score: input.leadScore, reasoning: input.leadScoreReasoning })
    why.push(`puntaje ${input.leadScore}`)
  }
  if (input.companyName || input.taxId) {
    reasons.push({ rule: 'billing_data', company_name: input.companyName, tax_id: input.taxId })
    const data = [input.companyName, input.taxId ? `RUT ${input.taxId}` : null].filter(Boolean).join(', ')
    why.push(`dejó datos para cotizar (${data})`)
  }
  if (reasons.length === 0) return null

  const interest = [...new Set([...chosen, ...skusOf('customer_asked'), ...skusOf('recommended')])].slice(0, 5)
  const lines = [
    'Lead caliente detectado por el bot.',
    `Motivo: ${why.join(' · ')}.`,
    interest.length > 0 ? `Equipos de interés: ${interest.map(label).join(', ')}.` : null,
    input.summary ? `Resumen: ${input.summary}` : null,
  ].filter(Boolean)

  return { reasons, description: lines.join('\n') }
}
