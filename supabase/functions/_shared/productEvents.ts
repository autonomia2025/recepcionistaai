// Product events of a bot turn (commercial module): which catalog models the
// customer asked about, the bot showed, the customer picked, and whose datasheet
// was sent. Only real catalog SKUs are recorded. Pure: the caller inserts them.

import { extractQuotedCodes } from './catalog.ts'
import { normalizeProductCode } from './datasheets.ts'

export type ProductEventType = 'customer_asked' | 'recommended' | 'chosen' | 'datasheet_sent'

export interface ProductEvent {
  event_type: ProductEventType
  sku_normalized: string | null
  detail: Record<string, unknown>
}

export interface ProductEventInput {
  customerCodes: string[]
  chosenCode: string | null
  replies: string[]
  datasheets: Array<{ file_name: string; sku_normalized: string | null }>
  catalogSkus: Set<string>
}

export function buildProductEvents(input: ProductEventInput): ProductEvent[] {
  const { catalogSkus } = input
  const events: ProductEvent[] = []
  const seen = new Set<string>()
  const add = (event_type: ProductEventType, sku: string | null, detail: Record<string, unknown> = {}) => {
    const key = `${event_type}:${sku ?? detail.file_name ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    events.push({ event_type, sku_normalized: sku, detail })
  }
  const inCatalog = (code: string | null | undefined) => {
    const normalized = normalizeProductCode(code || '')
    return normalized && catalogSkus.has(normalized) ? normalized : null
  }

  for (const code of input.customerCodes) {
    const sku = inCatalog(code)
    if (sku) add('customer_asked', sku, { as_written: code })
  }

  const chosen = inCatalog(input.chosenCode)
  if (chosen) add('chosen', chosen)

  for (const code of input.replies.flatMap((reply) => extractQuotedCodes(reply))) {
    const sku = inCatalog(code)
    if (sku) add('recommended', sku)
  }

  for (const sheet of input.datasheets) {
    const sku = sheet.sku_normalized && catalogSkus.has(sheet.sku_normalized) ? sheet.sku_normalized : null
    add('datasheet_sent', sku, { file_name: sheet.file_name })
  }

  return events
}
