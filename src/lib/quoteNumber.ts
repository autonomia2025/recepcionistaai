export interface QuoteNumberFormat {
  prefix: string;
  padding: number;
  includesYear: boolean;
}

export function formatQuoteNumber(format: QuoteNumberFormat, sequence: number, year = new Date().getFullYear()): string {
  const number = String(Math.max(1, Math.trunc(sequence))).padStart(format.padding, '0');
  return [format.prefix, format.includesYear ? String(year) : null, number].filter(Boolean).join('-');
}
