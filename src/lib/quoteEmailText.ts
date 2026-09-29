// Default texts of the "Enviar por correo" dialog. The seller can change all of them.

export function defaultQuoteMessage(input: {
  clientName: string | null;
  quoteNumber: string;
  validityDays: number | null;
}): string {
  const first = (input.clientName ?? '').trim().split(/\s+/)[0];
  const greeting = first ? `Hola ${first},` : 'Hola,';
  const validity = input.validityDays ? ` Los precios están vigentes por ${input.validityDays} días.` : '';
  return `${greeting}\n\nTe adjunto la cotización ${input.quoteNumber} que conversamos.${validity}\n\nCualquier duda, respóndeme este correo y te ayudo.\n\nSaludos,`;
}

export function defaultQuoteSubject(quoteNumber: string, companyName: string | null): string {
  return companyName ? `Cotización ${quoteNumber} · ${companyName}` : `Cotización ${quoteNumber}`;
}

export function defaultAnswerSubject(lastSubject: string | null, quoteNumber: string): string {
  const base = (lastSubject ?? '').replace(/^\s*((re|rv|fw|fwd)\s*:\s*)+/i, '').trim() || `Cotización ${quoteNumber}`;
  return `Re: ${base}`;
}
