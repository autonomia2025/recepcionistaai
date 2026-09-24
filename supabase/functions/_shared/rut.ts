// Chilean RUT helpers for edge functions. Same algorithm and format as
// src/lib/rut.ts (frontend) and public.is_valid_rut / public.format_rut (database);
// tests/unit/commercialExtraction.test.ts checks that they agree.

export function cleanRut(value: string): string {
  return (value || '').replace(/[^0-9kK]/g, '').toUpperCase()
}

export function isValidRut(value: string): boolean {
  const clean = cleanRut(value)
  if (clean.length < 2) return false
  const body = clean.slice(0, -1)
  const checkDigit = clean.slice(-1)
  if (!/^\d+$/.test(body)) return false

  let total = 0
  let factor = 2
  for (let index = body.length - 1; index >= 0; index--) {
    total += Number(body[index]) * factor
    factor = factor === 7 ? 2 : factor + 1
  }
  const remainder = 11 - (total % 11)
  const expected = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder)
  return checkDigit === expected
}

export function formatRut(value: string): string {
  const clean = cleanRut(value)
  if (clean.length < 2) return clean
  const body = clean.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${body}-${clean.slice(-1)}`
}

// RUTs written in free text. The hyphen before the check digit is required so
// that phone numbers (912345678) and amounts never count as a RUT.
const RUT_IN_TEXT_RE = /(?<![\d.])(\d{1,2}\.?\d{3}\.?\d{3})\s?-\s?([\dkK])(?![\dA-Za-z])/g

export function findRutsInText(text: string): string[] {
  const found = new Set<string>()
  for (const match of (text || '').matchAll(RUT_IN_TEXT_RE)) {
    const candidate = `${match[1]}-${match[2]}`
    if (isValidRut(candidate)) found.add(formatRut(candidate))
  }
  return [...found]
}
