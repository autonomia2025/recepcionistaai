import { useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { AlertTriangle, FilePlus2, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useWorkshopFeatures } from '@/hooks/useWorkshopFeatures';
import { QUOTE_STATUS_LABELS, useCreateQuoteDraft, useRequestQuotes } from '@/hooks/useQuotes';
import { formatCLP } from '@/lib/quoteTotals';
import { QuoteEditorDialog } from './QuoteEditorDialog';

// Quotes built in the system for a request (commercial module). Sits next to
// the existing "Marcar cotización enviada" flow, which keeps working as before.
export function RequestQuotesSection({ requestId }: { requestId: string }) {
  const { features } = useWorkshopFeatures();
  const { data: quotes, isLoading } = useRequestQuotes(features.commercial ? requestId : null);
  const createDraft = useCreateQuoteDraft();
  const [openQuoteId, setOpenQuoteId] = useState<string | null>(null);

  if (!features.commercial) return null;

  const draft = (quotes || []).find(quote => quote.status === 'draft');

  const handleCreate = async () => {
    try {
      const result = await createDraft.mutateAsync(requestId);
      if (result.created) {
        toast.success(result.lines ? `Cotización creada con ${result.lines === 1 ? 'el equipo' : `los ${result.lines} equipos`} de la conversación` : 'Cotización creada: agrega los equipos');
      }
      setOpenQuoteId(result.quote_id);
    } catch (err) {
      toast.error('No se pudo crear la cotización', { description: err instanceof Error ? err.message : undefined });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Cotizar con el sistema
        </h4>
        <Button size="sm" onClick={() => (draft ? setOpenQuoteId(draft.id) : handleCreate())} disabled={createDraft.isPending || isLoading}>
          {createDraft.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FilePlus2 className="w-4 h-4 mr-1" />}
          {draft ? 'Continuar cotización' : 'Crear cotización'}
        </Button>
      </div>

      {(quotes || []).length > 0 && (
        <div className="rounded-lg border divide-y">
          {(quotes || []).map(quote => (
            <button key={quote.id} type="button" onClick={() => setOpenQuoteId(quote.id)}
              className="w-full flex items-center justify-between gap-3 p-3 text-left text-sm hover:bg-muted/50">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{quote.quote_number ?? 'En preparación'}</span>
                  {quote.status !== 'draft' && (
                    <Badge className="text-[10px]">{QUOTE_STATUS_LABELS[quote.status] ?? quote.status}</Badge>
                  )}
                  {quote.discount_over_threshold && (
                    <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700">
                      <AlertTriangle className="w-3 h-3 mr-1" /> Descuento sobre el umbral
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(quote.issued_at ?? quote.created_at), "d 'de' MMMM yyyy", { locale: es })}
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium">{formatCLP(Number(quote.total))}</p>
                <p className="text-xs text-muted-foreground">neto {formatCLP(Number(quote.net_total))}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      <QuoteEditorDialog quoteId={openQuoteId} open={!!openQuoteId} onOpenChange={open => !open && setOpenQuoteId(null)} />
    </div>
  );
}
