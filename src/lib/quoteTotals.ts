// Live preview of quote totals in the editor. Same formula as the database
// trigger quotes_before_write (migration f2_t1_quotes), which stays the source
// of truth: after saving, the editor shows the totals the database computed.

export interface QuoteLineInput {
  quantity: number;
  unit_price: number;
  discount_pct: number;
}

export interface QuoteTotals {
  gross_subtotal: number;
  discount_total: number;
  net_total: number;
  vat_total: number;
  total: number;
  max_discount_pct: number;
}

// Postgres round() on numeric rounds half away from zero; amounts here are >= 0.
const roundHalfUp = (value: number) => Math.round(value + Number.EPSILON * Math.sign(value));

export function lineGross(line: QuoteLineInput): number {
  return roundHalfUp(line.quantity * line.unit_price);
}

export function lineTotal(line: QuoteLineInput): number {
  return roundHalfUp(lineGross(line) * (1 - line.discount_pct / 100));
}

export function computeQuoteTotals(lines: QuoteLineInput[], globalDiscountPct: number, vatRate: number): QuoteTotals {
  const gross = lines.reduce((sum, line) => sum + lineGross(line), 0);
  const afterLines = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const global = roundHalfUp(afterLines * globalDiscountPct / 100);
  const net = afterLines - global;
  const vat = roundHalfUp(net * vatRate / 100);
  const maxLine = lines.reduce((max, line) => Math.max(max, line.discount_pct), 0);
  const effective = gross > 0 ? Math.round(((gross - net) * 100 / gross) * 100) / 100 : 0;
  return {
    gross_subtotal: gross,
    discount_total: gross - net,
    net_total: net,
    vat_total: vat,
    total: net + vat,
    max_discount_pct: Math.max(maxLine, globalDiscountPct, effective),
  };
}

export const formatCLP = (value: number) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(value);
