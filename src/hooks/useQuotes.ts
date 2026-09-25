import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type Quote = Database['public']['Tables']['quotes']['Row'];
export type QuoteLine = Database['public']['Tables']['quote_lines']['Row'];
export type CatalogRow = Pick<
  Database['public']['Tables']['product_catalog']['Row'],
  'sku' | 'sku_normalized' | 'water_type' | 'motor_type' | 'pressure_bar' | 'flow_lmin' | 'temp_max' | 'price_min' | 'price_max'
>;

export const QUOTE_STATUS_LABELS: Record<string, string> = {
  draft: 'En preparación',
  issued: 'Por enviar',
  sent: 'Enviada',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  void: 'Anulada',
};

// Columns a person may edit on a draft (the rest is computed by the database).
export const EDITABLE_QUOTE_FIELDS = [
  'client_name', 'client_company', 'client_tax_id', 'client_email', 'client_phone', 'client_address',
  'vat_rate', 'validity_days', 'payment_terms', 'delivery_terms', 'notes', 'global_discount_pct',
] as const;
export type EditableQuoteFields = Pick<Quote, (typeof EDITABLE_QUOTE_FIELDS)[number]>;

// A line being edited: id is null until it is saved.
export interface DraftLine {
  key: string;
  id: string | null;
  sku: string | null;
  sku_normalized: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  price_min: number | null;
  price_max: number | null;
  source: string;
}

const CATALOG_COLUMNS = 'sku, sku_normalized, water_type, motor_type, pressure_bar, flow_lmin, temp_max, price_min, price_max';

export function useRequestQuotes(requestId: string | null | undefined) {
  return useQuery({
    queryKey: ['request-quotes', requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quotes')
        .select('id, status, quote_number, net_total, total, discount_over_threshold, created_at, issued_at, sent_at, closed_at, pdf_path')
        .eq('service_request_id', requestId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!requestId,
  });
}

export function useQuote(quoteId: string | null) {
  return useQuery({
    queryKey: ['quote', quoteId],
    queryFn: async () => {
      const [{ data: quote, error: quoteError }, { data: lines, error: linesError }] = await Promise.all([
        supabase.from('quotes').select('*').eq('id', quoteId!).single(),
        supabase.from('quote_lines').select('*').eq('quote_id', quoteId!).order('position').order('created_at'),
      ]);
      if (quoteError) throw quoteError;
      if (linesError) throw linesError;
      return { quote: quote as Quote, lines: (lines || []) as QuoteLine[] };
    },
    enabled: !!quoteId,
  });
}

export function useDiscountThreshold(workshopId: string | null | undefined) {
  return useQuery({
    queryKey: ['discount-threshold', workshopId],
    queryFn: async () => {
      const { data } = await supabase
        .from('commercial_settings')
        .select('discount_approval_threshold')
        .eq('workshop_id', workshopId!)
        .maybeSingle();
      return data ? Number(data.discount_approval_threshold) : null;
    },
    enabled: !!workshopId,
  });
}

// Models the bot only recommended: offered as one-click suggestions.
export function useQuoteSuggestions(contactId: string | null | undefined, workshopId: string | null | undefined) {
  return useQuery({
    queryKey: ['quote-suggestions', contactId],
    queryFn: async () => {
      const { data: events } = await supabase
        .from('conversation_product_events')
        .select('sku_normalized')
        .eq('contact_id', contactId!)
        .eq('event_type', 'recommended')
        .not('sku_normalized', 'is', null);
      const skus = [...new Set((events || []).map(e => e.sku_normalized as string))];
      if (skus.length === 0) return [] as CatalogRow[];
      const { data } = await supabase
        .from('product_catalog')
        .select(CATALOG_COLUMNS)
        .eq('workshop_id', workshopId!)
        .in('sku_normalized', skus);
      return (data || []) as CatalogRow[];
    },
    enabled: !!contactId && !!workshopId,
  });
}

export function useCatalogSearch(workshopId: string | null | undefined, term: string) {
  const clean = term.trim();
  return useQuery({
    queryKey: ['catalog-search', workshopId, clean],
    queryFn: async () => {
      const pattern = `%${clean.replace(/[%_]/g, '')}%`;
      const { data, error } = await supabase
        .from('product_catalog')
        .select(CATALOG_COLUMNS)
        .eq('workshop_id', workshopId!)
        .ilike('sku', pattern)
        .order('sku')
        .limit(8);
      if (error) throw error;
      return (data || []) as CatalogRow[];
    },
    enabled: !!workshopId && clean.length >= 2,
  });
}

export function useCreateQuoteDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { data, error } = await supabase.rpc('create_quote_draft', { _service_request_id: requestId });
      if (error) throw error;
      return data as { quote_id: string; created: boolean; lines?: number };
    },
    onSuccess: (_data, requestId) => queryClient.invalidateQueries({ queryKey: ['request-quotes', requestId] }),
  });
}

function sameLine(line: DraftLine, saved: QuoteLine, position: number) {
  return saved.position === position
    && saved.description === line.description
    && Number(saved.quantity) === line.quantity
    && Number(saved.unit_price) === line.unit_price
    && Number(saved.discount_pct) === line.discount_pct;
}

export function useSaveQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ quote, header, lines, savedLines }: {
      quote: Quote;
      header: EditableQuoteFields;
      lines: DraftLine[];
      savedLines: QuoteLine[];
    }) => {
      const headerChanges = Object.fromEntries(
        EDITABLE_QUOTE_FIELDS.filter(field => header[field] !== quote[field]).map(field => [field, header[field]]),
      );
      if (Object.keys(headerChanges).length > 0) {
        const { error } = await supabase.from('quotes').update(headerChanges).eq('id', quote.id);
        if (error) throw error;
      }

      const keptIds = new Set(lines.map(line => line.id).filter(Boolean));
      const removed = savedLines.filter(line => !keptIds.has(line.id)).map(line => line.id);
      if (removed.length > 0) {
        const { error } = await supabase.from('quote_lines').delete().in('id', removed);
        if (error) throw error;
      }

      const savedById = new Map(savedLines.map(line => [line.id, line]));
      for (const [index, line] of lines.entries()) {
        const position = index + 1;
        if (!line.id) {
          const { error } = await supabase.from('quote_lines').insert({
            quote_id: quote.id, workshop_id: quote.workshop_id, position,
            sku: line.sku, sku_normalized: line.sku_normalized,
            description: line.description, quantity: line.quantity, unit_price: line.unit_price,
            discount_pct: line.discount_pct, price_min: line.price_min, price_max: line.price_max, source: line.source,
          });
          if (error) throw error;
        } else {
          const saved = savedById.get(line.id);
          if (saved && sameLine(line, saved, position)) continue;
          const { error } = await supabase.from('quote_lines').update({
            position, description: line.description, quantity: line.quantity,
            unit_price: line.unit_price, discount_pct: line.discount_pct,
          }).eq('id', line.id);
          if (error) throw error;
        }
      }
    },
    onSuccess: (_data, { quote }) => {
      queryClient.invalidateQueries({ queryKey: ['quote', quote.id] });
      queryClient.invalidateQueries({ queryKey: ['request-quotes', quote.service_request_id] });
    },
  });
}

export function useIssueQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (quote: Quote) => {
      const { data, error } = await supabase.rpc('issue_quote', { _quote_id: quote.id });
      if (error) throw error;
      return data as { quote_id: string; quote_number: string };
    },
    onSuccess: (_data, quote) => {
      queryClient.invalidateQueries({ queryKey: ['quote', quote.id] });
      queryClient.invalidateQueries({ queryKey: ['request-quotes', quote.service_request_id] });
    },
  });
}

export function useDeleteQuoteDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (quote: Quote) => {
      const { error } = await supabase.from('quotes').delete().eq('id', quote.id);
      if (error) throw error;
    },
    onSuccess: (_data, quote) => queryClient.invalidateQueries({ queryKey: ['request-quotes', quote.service_request_id] }),
  });
}

export const SENT_VIA_LABELS: Record<string, string> = {
  email: 'por correo',
  whatsapp: 'por WhatsApp',
  in_person: 'en persona',
  other: 'por otro medio',
};

export function useLostReasons(workshopId: string | null | undefined) {
  return useQuery({
    queryKey: ['lost-reasons', workshopId],
    queryFn: async () => {
      const { data } = await supabase.from('commercial_settings').select('lost_reasons').eq('workshop_id', workshopId!).maybeSingle();
      return (data?.lost_reasons as string[] | undefined) ?? ['Precio', 'Competencia', 'Sin presupuesto', 'Fuera de plazo', 'No responde', 'Otro'];
    },
    enabled: !!workshopId,
  });
}

// Lifecycle of an official quote. Every action also refreshes the request,
// because sending and closing update it the same way the manual flow does.
function useQuoteAction<TArgs, TResult>(run: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quote'] });
      queryClient.invalidateQueries({ queryKey: ['request-quotes'] });
      queryClient.invalidateQueries({ queryKey: ['service-requests'] });
      queryClient.invalidateQueries({ queryKey: ['client-service-requests'] });
    },
  });
}

type ActionResult = { quote_id: string; status?: string; created?: boolean };
const done = <T,>(result: { data: T; error: unknown }) => {
  if (result.error) throw result.error;
  return result.data as unknown as ActionResult;
};

export const useMarkQuoteSent = () =>
  useQuoteAction(async ({ quoteId, via }: { quoteId: string; via: string }) =>
    done(await supabase.rpc('mark_quote_sent', { _quote_id: quoteId, _sent_via: via })));

export const useCloseQuote = () =>
  useQuoteAction(async ({ quoteId, outcome, reason, closeRequest }: { quoteId: string; outcome: 'accepted' | 'rejected'; reason?: string; closeRequest?: boolean }) =>
    done(await supabase.rpc('close_quote', { _quote_id: quoteId, _outcome: outcome, _lost_reason: reason, _close_request: closeRequest ?? true })));

export const useVoidQuote = () =>
  useQuoteAction(async ({ quoteId, reason }: { quoteId: string; reason: string }) =>
    done(await supabase.rpc('void_quote', { _quote_id: quoteId, _reason: reason })));

export const useReviseQuote = () =>
  useQuoteAction(async (quoteId: string) => done(await supabase.rpc('revise_quote', { _quote_id: quoteId })));
