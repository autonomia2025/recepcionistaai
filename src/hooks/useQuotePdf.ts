import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { buildQuotePdf, type QuotePdfData } from '@/lib/quotePdf';
import type { Quote, QuoteLine } from '@/hooks/useQuotes';

const BUCKET = 'quotations';

export const officialPdfPath = (quote: Pick<Quote, 'workshop_id' | 'quote_number'>) =>
  `${quote.workshop_id}/quotes/${quote.quote_number}.pdf`;

async function loadLogo(path: string | null): Promise<QuotePdfData['company']['logo']> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('commercial-assets').download(path);
  if (error || !data) return null; // a missing logo never blocks the PDF
  const type = /\.png$/i.test(path) || data.type === 'image/png' ? 'png' : 'jpg';
  return { bytes: new Uint8Array(await data.arrayBuffer()), type };
}

// Everything the PDF prints comes from the issued quote (immutable) plus the
// company data in Configuración comercial.
async function collectPdfData(quoteId: string): Promise<{ quote: Quote; data: QuotePdfData }> {
  const [{ data: quote, error: quoteError }, { data: lines, error: linesError }] = await Promise.all([
    supabase.from('quotes').select('*').eq('id', quoteId).single(),
    supabase.from('quote_lines').select('*').eq('quote_id', quoteId).order('position').order('created_at'),
  ]);
  if (quoteError) throw quoteError;
  if (linesError) throw linesError;
  const q = quote as Quote;
  if (q.status === 'draft' || !q.quote_number || !q.issued_at) throw new Error('La cotización todavía no es oficial');

  const { data: settings } = await supabase
    .from('commercial_settings')
    .select('legal_name, tax_id, address, phones, email, logo_path, primary_color, secondary_color')
    .eq('workshop_id', q.workshop_id)
    .maybeSingle();

  let seller: QuotePdfData['seller'] = null;
  if (q.issued_by) {
    const { data: profile } = await supabase.from('profiles').select('full_name, email').eq('id', q.issued_by).maybeSingle();
    if (profile) seller = { name: profile.full_name ?? null, email: profile.email ?? null };
  }

  return {
    quote: q,
    data: {
      number: q.quote_number,
      issuedAt: new Date(q.issued_at),
      validityDays: Number(q.validity_days),
      company: {
        legalName: settings?.legal_name ?? null,
        taxId: settings?.tax_id ?? null,
        address: settings?.address ?? null,
        phones: settings?.phones ?? [],
        email: settings?.email ?? null,
        primaryColor: settings?.primary_color ?? '#1A9387',
        secondaryColor: settings?.secondary_color ?? '#127BA1',
        logo: await loadLogo(settings?.logo_path ?? null),
      },
      seller,
      client: {
        name: q.client_name,
        company: q.client_company,
        taxId: q.client_tax_id,
        email: q.client_email,
        phone: q.client_phone,
        address: q.client_address,
      },
      lines: ((lines || []) as QuoteLine[]).map(line => ({
        sku: line.sku,
        description: line.description,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unit_price),
        discountPct: Number(line.discount_pct),
        total: Number(line.line_total),
      })),
      totals: {
        gross: Number(q.gross_subtotal),
        discount: Number(q.discount_total),
        net: Number(q.net_total),
        vatRate: Number(q.vat_rate),
        vat: Number(q.vat_total),
        total: Number(q.total),
      },
      paymentTerms: q.payment_terms,
      deliveryTerms: q.delivery_terms,
      notes: q.notes,
      legalFooter: q.legal_footer,
    },
  };
}

// Builds the official PDF, uploads it once and registers it on the quote.
export function useGenerateQuotePdf() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (quoteId: string) => {
      const { quote, data } = await collectPdfData(quoteId);
      if (quote.pdf_path) return quote.pdf_path;
      const path = officialPdfPath(quote);
      const bytes = await buildQuotePdf(data);
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false });
      // A previous attempt may have uploaded it already: registering still works.
      if (uploadError && !/exists|duplicate/i.test(uploadError.message)) throw uploadError;
      const { data: registered, error } = await supabase.rpc('set_quote_pdf', { _quote_id: quoteId, _path: path });
      if (error) throw error;
      return registered as string;
    },
    onSuccess: (_path, quoteId) => {
      queryClient.invalidateQueries({ queryKey: ['quote', quoteId] });
      queryClient.invalidateQueries({ queryKey: ['request-quotes'] });
    },
  });
}

export async function openQuotePdf(path: string) {
  // Open the tab synchronously so the browser does not block it as a popup.
  const tab = window.open('', '_blank');
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) {
    tab?.close();
    throw error ?? new Error('No se pudo abrir el PDF');
  }
  if (tab) tab.location.href = data.signedUrl;
  else window.location.href = data.signedUrl;
}
