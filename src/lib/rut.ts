export function cleanRut(value: string): string {
  return (value || '').replace(/[^0-9kK]/g, '').toUpperCase();
}

// Same algorithm as public.is_valid_rut in the database (módulo 11).
export function isValidRut(value: string): boolean {
  const clean = cleanRut(value);
  if (clean.length < 2) return false;

  const body = clean.slice(0, -1);
  const checkDigit = clean.slice(-1);
  if (!/^\d+$/.test(body)) return false;

  let total = 0;
  let factor = 2;
  for (let index = body.length - 1; index >= 0; index--) {
    total += Number(body[index]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }

  const remainder = 11 - (total % 11);
  const expected = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
  return checkDigit === expected;
}

export function formatRut(value: string): string {
  const clean = cleanRut(value);
  if (clean.length < 2) return clean;
  const body = clean.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${body}-${clean.slice(-1)}`;
}
