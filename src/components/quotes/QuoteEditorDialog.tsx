import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { AlertTriangle, CheckCircle2, FileCheck2, FileDown, Loader2, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { catalogLineDescription } from '@/lib/catalogDescription';
import { computeQuoteTotals, formatCLP, lineTotal } from '@/lib/quoteTotals';
import { formatRut, isValidRut } from '@/lib/rut';
import {
  type CatalogRow, type DraftLine, EDITABLE_QUOTE_FIELDS, type EditableQuoteFields, type Quote, type QuoteLine,
  useCatalogSearch, useDeleteQuoteDraft, useDiscountThreshold, useIssueQuote, useQuote, useQuoteSuggestions, useSaveQuote,
} from '@/hooks/useQuotes';
import { openQuotePdf, useGenerateQuotePdf } from '@/hooks/useQuotePdf';

// Where each line came from, said the way a seller would say it.
const ORIGIN: Record<string, string> = {
  chosen: 'El cliente la eligió en WhatsApp',
  customer_asked: 'El cliente la preguntó',
  datasheet_sent: 'Le enviamos su ficha',
  suggested: 'Recomendada por el bot',
  manual: 'Agregada a mano',
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const digitsOnly = (value: string) => Number(value.replace(/\D/g, '')) || 0;
const decimal = (value: string) => {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};

const toDraftLine = (line: QuoteLine): DraftLine => ({
  key: line.id,
  id: line.id,
  sku: line.sku,
  sku_normalized: line.sku_normalized,
  description: line.description,
  quantity: Number(line.quantity),
  unit_price: Number(line.unit_price),
  discount_pct: Number(line.discount_pct),
  price_min: line.price_min == null ? null : Number(line.price_min),
  price_max: line.price_max == null ? null : Number(line.price_max),
  source: line.source,
});

const fromCatalog = (row: CatalogRow, source: string): DraftLine => ({
  key: crypto.randomUUID(),
  id: null,
  sku: row.sku,
  sku_normalized: row.sku_normalized,
  description: catalogLineDescription(row),
  quantity: 1,
  unit_price: Number(row.price_max ?? row.price_min ?? 0),
  discount_pct: 0,
  price_min: row.price_min == null ? null : Number(row.price_min),
  price_max: row.price_max == null ? null : Number(row.price_max),
  source,
});

function MoneyInput({ value, onChange, id, className }: { value: number; onChange: (value: number) => void; id?: string; className?: string }) {
  return (
    <div className={cn('relative', className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
      <Input id={id} inputMode="numeric" className="pl-7 text-right tabular-nums"
        value={value ? value.toLocaleString('es-CL') : ''} placeholder="0"
        onChange={event => onChange(digitsOnly(event.target.value))} />
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function ReadOnly({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-sm', !value && 'text-muted-foreground')}>{value || '—'}</p>
    </div>
  );
}

interface QuoteEditorDialogProps {
  quoteId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuoteEditorDialog({ quoteId, open, onOpenChange }: QuoteEditorDialogProps) {
  const { data, isLoading, error } = useQuote(open ? quoteId : null);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const requestClose = () => (dirty ? setConfirmClose(true) : onOpenChange(false));
  const closeNow = () => { setConfirmClose(false); setDirty(false); onOpenChange(false); };

  return (
    <Dialog open={open} onOpenChange={next => (next ? onOpenChange(true) : requestClose())}>
      <DialogContent className="max-w-4xl w-[calc(100vw-1rem)] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden [&>button]:hidden">
        {isLoading || !data ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <DialogTitle className="sr-only">Cotización</DialogTitle>
            {error ? 'No se pudo cargar la cotización.' : <Loader2 className="w-5 h-5 animate-spin" />}
          </div>
        ) : (
          // Re-mounted after every save so the form starts from what the database stored.
          <QuoteEditorBody key={data.quote.updated_at} quote={data.quote} savedLines={data.lines}
            onDirtyChange={setDirty} onClose={requestClose} onDeleted={closeNow} />
        )}
      </DialogContent>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tienes cambios sin guardar</AlertDialogTitle>
            <AlertDialogDescription>Si cierras ahora, se pierden los cambios que hiciste en esta cotización.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir editando</AlertDialogCancel>
            <AlertDialogAction onClick={closeNow} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Cerrar sin guardar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

function QuoteEditorBody({ quote, savedLines, onDirtyChange, onClose, onDeleted }: {
  quote: Quote;
  savedLines: QuoteLine[];
  onDirtyChange: (dirty: boolean) => void;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const editable = quote.status === 'draft';
  const initialHeader = useMemo(
    () => Object.fromEntries(EDITABLE_QUOTE_FIELDS.map(field => [field, quote[field]])) as EditableQuoteFields,
    [quote],
  );
  const initialLines = useMemo(() => savedLines.map(toDraftLine), [savedLines]);

  const [header, setHeader] = useState<EditableQuoteFields>(initialHeader);
  const [lines, setLines] = useState<DraftLine[]>(initialLines);
  const [search, setSearch] = useState('');
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const saveQuote = useSaveQuote();
  const issueQuote = useIssueQuote();
  const deleteDraft = useDeleteQuoteDraft();
  const generatePdf = useGenerateQuotePdf();
  const { data: threshold } = useDiscountThreshold(quote.workshop_id);
  const { data: suggestions } = useQuoteSuggestions(editable ? quote.contact_id : null, quote.workshop_id);
  const { data: results, isFetching: searching } = useCatalogSearch(editable ? quote.workshop_id : null, search);

  const dirty = JSON.stringify(header) !== JSON.stringify(initialHeader) || JSON.stringify(lines) !== JSON.stringify(initialLines);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  const setField = <K extends keyof EditableQuoteFields>(field: K, value: EditableQuoteFields[K]) =>
    setHeader(current => ({ ...current, [field]: value }));
  const setLine = (key: string, changes: Partial<DraftLine>) =>
    setLines(current => current.map(line => (line.key === key ? { ...line, ...changes } : line)));
  const addLine = (line: DraftLine) => setLines(current => [...current, line]);

  const totals = computeQuoteTotals(lines, Number(header.global_discount_pct), Number(header.vat_rate));
  const overThreshold = threshold != null && totals.max_discount_pct > threshold;
  const inQuote = new Set(lines.map(line => line.sku_normalized).filter(Boolean));
  const pendingSuggestions = (suggestions || []).filter(row => !inQuote.has(row.sku_normalized));
  const clientLabel = header.client_company?.trim() || header.client_name?.trim() || 'el cliente';

  const problems: string[] = [];
  if (!header.client_name?.trim()) problems.push('Falta el nombre del cliente');
  if (header.client_tax_id?.trim() && !isValidRut(header.client_tax_id)) problems.push('El RUT no es válido');
  if (header.client_email?.trim() && !EMAIL_RE.test(header.client_email.trim())) problems.push('El correo no es válido');
  if (lines.some(line => !line.description.trim())) problems.push('Hay un equipo sin descripción');
  if (lines.some(line => !(line.quantity > 0))) problems.push('Hay una cantidad en cero');
  if (lines.some(line => line.discount_pct < 0 || line.discount_pct > 100) || Number(header.global_discount_pct) < 0 || Number(header.global_discount_pct) > 100) problems.push('Los descuentos van de 0 a 100%');
  if (!(Number(header.validity_days) >= 1 && Number(header.validity_days) <= 365)) problems.push('La validez va de 1 a 365 días');
  const canIssue = lines.length > 0 && totals.net_total > 0 && problems.length === 0;

  const normalizedHeader = (): EditableQuoteFields => ({
    ...header,
    client_name: header.client_name.trim(),
    client_company: header.client_company?.trim() || null,
    client_tax_id: header.client_tax_id?.trim() ? formatRut(header.client_tax_id) : null,
    client_email: header.client_email?.trim().toLowerCase() || null,
    client_phone: header.client_phone?.trim() || null,
    client_address: header.client_address?.trim() || null,
    notes: header.notes?.trim() || null,
  });

  const save = async () => {
    await saveQuote.mutateAsync({
      quote,
      header: normalizedHeader(),
      lines: lines.map(line => ({ ...line, description: line.description.trim() })),
      savedLines,
    });
  };

  const handleSave = async () => {
    try { await save(); toast.success('Cambios guardados'); }
    catch (err) { toast.error('No se pudieron guardar los cambios', { description: err instanceof Error ? err.message : undefined }); }
  };

  const handleIssue = async () => {
    setConfirmIssue(false);
    try {
      if (dirty) await save();
      const result = await issueQuote.mutateAsync(quote);
      try {
        await generatePdf.mutateAsync(quote.id);
        toast.success(`Cotización ${result.quote_number} generada, con su PDF`);
      } catch (pdfError) {
        toast.warning(`Cotización ${result.quote_number} generada, pero el PDF no se pudo crear`, {
          description: 'Ábrela y presiona "Crear PDF" para reintentar.',
        });
        console.error('Quote PDF error:', pdfError);
      }
    } catch (err) {
      toast.error('No se pudo generar la cotización', { description: err instanceof Error ? err.message : undefined });
    }
  };

  const handleCreatePdf = async () => {
    try { await generatePdf.mutateAsync(quote.id); toast.success('PDF creado'); }
    catch (err) { toast.error('No se pudo crear el PDF', { description: err instanceof Error ? err.message : undefined }); }
  };

  const handleOpenPdf = async () => {
    if (!quote.pdf_path) return;
    try { await openQuotePdf(quote.pdf_path); }
    catch (err) { toast.error('No se pudo abrir el PDF', { description: err instanceof Error ? err.message : undefined }); }
  };

  const handleDelete = async () => {
    setConfirmDelete(false);
    try { await deleteDraft.mutateAsync(quote); toast.success('Cotización en preparación eliminada'); onDeleted(); }
    catch (err) { toast.error('No se pudo eliminar', { description: err instanceof Error ? err.message : undefined }); }
  };

  const busy = saveQuote.isPending || issueQuote.isPending || generatePdf.isPending;

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
        <div className="min-w-0 space-y-1">
          <DialogTitle className="text-lg truncate">
            {quote.quote_number ? `Cotización ${quote.quote_number}` : `Cotización para ${clientLabel}`}
          </DialogTitle>
          <DialogDescription asChild>
            {editable ? (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-amber-700 dark:text-amber-400">En preparación.</span>{' '}
                Revisa equipos y precios; cuando esté lista, genera la cotización oficial.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Cotización oficial generada el {quote.issued_at ? format(new Date(quote.issued_at), "d 'de' MMMM yyyy", { locale: es }) : '—'}. Ya no se puede modificar.
              </p>
            )}
          </DialogDescription>
        </div>
        <Button variant="ghost" size="icon" className="flex-shrink-0 -mr-2" onClick={onClose} aria-label="Cerrar">
          <X className="w-5 h-5" />
        </Button>
      </div>

      {/* Body (native scroll) */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
        <div className="space-y-8">
          <Section title="Equipos y precios" hint={editable ? 'Los precios parten del máximo del rango del catálogo. Ajusta con descuento.' : undefined}>
            {lines.length === 0 && (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Esta cotización todavía no tiene equipos.{editable && ' Búscalos abajo en el catálogo.'}
              </div>
            )}

            <div className="space-y-3">
              {lines.map(line => {
                const lineDiscountHigh = threshold != null && line.discount_pct > threshold;
                return (
                  <div key={line.key} className="rounded-lg border bg-card p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">{line.sku ?? 'Ítem libre'}</p>
                        <p className="text-xs text-muted-foreground">{ORIGIN[line.source] ?? ''}</p>
                      </div>
                      {editable && (
                        <Button variant="ghost" size="sm" className="h-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setLines(current => current.filter(item => item.key !== line.key))}>
                          <Trash2 className="w-4 h-4 mr-1" /> Quitar
                        </Button>
                      )}
                    </div>

                    {editable ? (
                      <Textarea rows={2} value={line.description} placeholder="Descripción que verá el cliente"
                        className="text-sm resize-none min-h-0" onChange={event => setLine(line.key, { description: event.target.value })} />
                    ) : (
                      <p className="text-sm">{line.description}</p>
                    )}

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Cantidad</Label>
                        {editable
                          ? <Input inputMode="decimal" className="text-right tabular-nums" value={line.quantity}
                              onChange={event => setLine(line.key, { quantity: decimal(event.target.value) })} />
                          : <p className="text-sm tabular-nums">{line.quantity}</p>}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Precio unitario neto</Label>
                        {editable
                          ? <MoneyInput value={line.unit_price} onChange={value => setLine(line.key, { unit_price: value })} />
                          : <p className="text-sm tabular-nums">{formatCLP(line.unit_price)}</p>}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Descuento</Label>
                        {editable ? (
                          <div className="relative">
                            <Input inputMode="decimal" className={cn('pr-7 text-right tabular-nums', lineDiscountHigh && 'border-amber-500 focus-visible:ring-amber-500')}
                              value={line.discount_pct || ''} placeholder="0"
                              onChange={event => setLine(line.key, { discount_pct: decimal(event.target.value) })} />
                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                          </div>
                        ) : <p className="text-sm tabular-nums">{line.discount_pct}%</p>}
                      </div>
                      <div className="space-y-1 text-right">
                        <Label className="text-xs text-muted-foreground">Total línea</Label>
                        <p className="h-10 flex items-center justify-end text-base font-semibold tabular-nums">{formatCLP(lineTotal(line))}</p>
                      </div>
                    </div>

                    {(line.price_min != null || line.price_max != null) && (
                      <p className="text-xs text-muted-foreground">
                        Precio de catálogo: {formatCLP(line.price_min ?? line.price_max ?? 0)} a {formatCLP(line.price_max ?? line.price_min ?? 0)} neto
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {editable && (
              <div className="space-y-3">
                {pendingSuggestions.length > 0 && (
                  <div className="rounded-lg bg-primary/5 p-3 space-y-2">
                    <p className="text-sm flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-primary" /> El bot también le recomendó:</p>
                    <div className="flex flex-wrap gap-2">
                      {pendingSuggestions.map(row => (
                        <Button key={row.sku_normalized} variant="outline" size="sm" className="bg-background" onClick={() => addLine(fromCatalog(row, 'suggested'))}>
                          <Plus className="w-4 h-4 mr-1" /> Agregar {row.sku}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input value={search} placeholder="Agregar otro equipo: busca por código (ej. MH130)" className="pl-9"
                      onChange={event => setSearch(event.target.value)} />
                  </div>
                  <Button variant="outline" onClick={() => addLine({
                    key: crypto.randomUUID(), id: null, sku: null, sku_normalized: null, description: '', quantity: 1,
                    unit_price: 0, discount_pct: 0, price_min: null, price_max: null, source: 'manual',
                  })}>
                    <Plus className="w-4 h-4 mr-1" /> Ítem libre
                  </Button>
                </div>

                {search.trim().length >= 2 && (
                  <div className="rounded-lg border divide-y overflow-hidden">
                    {searching && <p className="p-3 text-sm text-muted-foreground">Buscando…</p>}
                    {!searching && (results || []).length === 0 && <p className="p-3 text-sm text-muted-foreground">No hay equipos con ese código.</p>}
                    {(results || []).map(row => {
                      const already = inQuote.has(row.sku_normalized);
                      return (
                        <button key={row.sku_normalized} type="button" disabled={already}
                          className="w-full text-left p-3 hover:bg-muted/50 disabled:opacity-50 disabled:hover:bg-transparent flex items-center justify-between gap-3"
                          onClick={() => { addLine(fromCatalog(row, 'manual')); setSearch(''); }}>
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">{row.sku}</span>
                            <span className="block text-xs text-muted-foreground truncate">{catalogLineDescription(row)}</span>
                          </span>
                          <span className="text-sm text-muted-foreground whitespace-nowrap">
                            {already ? 'Ya está' : row.price_max != null ? formatCLP(Number(row.price_max)) : 'Sin precio'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </Section>

          <Section title="Datos del cliente" hint={editable ? 'Salen en la cotización. Vienen de la conversación; corrígelos si hace falta.' : undefined}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {([
                ['client_company', 'Empresa', 'Razón social'],
                ['client_tax_id', 'RUT', '76.644.520-9'],
                ['client_name', 'Contacto', 'Nombre de la persona'],
                ['client_email', 'Correo', 'correo@empresa.cl'],
                ['client_phone', 'Teléfono', '+56 9 1234 5678'],
                ['client_address', 'Dirección', 'Dirección o comuna'],
              ] as const).map(([field, label, placeholder]) => editable ? (
                <div key={field} className="space-y-1">
                  <Label htmlFor={`quote-${field}`} className="text-xs text-muted-foreground">{label}</Label>
                  <Input id={`quote-${field}`} value={(header[field] as string | null) ?? ''} placeholder={placeholder}
                    aria-invalid={(field === 'client_tax_id' && !!header.client_tax_id?.trim() && !isValidRut(header.client_tax_id))
                      || (field === 'client_email' && !!header.client_email?.trim() && !EMAIL_RE.test(header.client_email.trim()))}
                    className="aria-[invalid=true]:border-destructive"
                    onChange={event => setField(field, event.target.value)}
                    onBlur={() => {
                      if (field === 'client_tax_id' && header.client_tax_id && isValidRut(header.client_tax_id)) setField('client_tax_id', formatRut(header.client_tax_id));
                    }} />
                </div>
              ) : (
                <ReadOnly key={field} label={label} value={header[field] as string | null} />
              ))}
            </div>
          </Section>

          <Section title="Condiciones comerciales" hint={editable ? 'Vienen de Configuración comercial. Puedes ajustarlas solo para esta cotización.' : undefined}>
            {editable ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Válida por (días)</Label>
                    <Input inputMode="numeric" value={header.validity_days || ''} onChange={event => setField('validity_days', digitsOnly(event.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Descuento sobre el total</Label>
                    <div className="relative">
                      <Input inputMode="decimal" className="pr-7" value={header.global_discount_pct || ''} placeholder="0"
                        onChange={event => setField('global_discount_pct', decimal(event.target.value))} />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">IVA</Label>
                    <div className="relative">
                      <Input inputMode="decimal" className="pr-7" value={header.vat_rate}
                        onChange={event => setField('vat_rate', decimal(event.target.value))} />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                    </div>
                  </div>
                </div>
                {([
                  ['payment_terms', 'Forma de pago'],
                  ['delivery_terms', 'Plazo de entrega'],
                  ['notes', 'Nota para el cliente (opcional)'],
                ] as const).map(([field, label]) => (
                  <div key={field} className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{label}</Label>
                    <Textarea rows={2} className="resize-none" value={(header[field] as string | null) ?? ''} onChange={event => setField(field, event.target.value)} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <ReadOnly label="Válida por" value={`${header.validity_days} días`} />
                <ReadOnly label="Forma de pago" value={header.payment_terms} />
                <ReadOnly label="Plazo de entrega" value={header.delivery_terms} />
                {header.notes && <ReadOnly label="Nota para el cliente" value={header.notes} />}
              </div>
            )}
          </Section>

          {editable && (
            <div className="pt-2">
              <button type="button" className="text-sm text-muted-foreground hover:text-destructive underline-offset-4 hover:underline"
                onClick={() => setConfirmDelete(true)} disabled={deleteDraft.isPending}>
                Eliminar esta cotización en preparación
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer: totals and actions, always visible */}
      <div className="border-t bg-muted/40 px-6 py-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-sm text-muted-foreground tabular-nums">
              Neto {formatCLP(totals.net_total)} + IVA {Number(header.vat_rate)}% {formatCLP(totals.vat_total)}
              {totals.discount_total > 0 && <> · incluye descuento de {formatCLP(totals.discount_total)}</>}
            </p>
            <p className="text-xl font-semibold tabular-nums">Total {formatCLP(totals.total)}</p>
            {overThreshold && (
              <p className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> Descuento de {totals.max_discount_pct}%: supera el {threshold}% permitido; el administrador lo verá.
              </p>
            )}
            {editable && problems.length > 0 && (
              <p className="text-sm text-destructive">{problems.join(' · ')}</p>
            )}
          </div>

          {!editable && (
            <div className="flex items-center gap-2 md:justify-end">
              {quote.pdf_path ? (
                <Button onClick={handleOpenPdf}>
                  <FileDown className="w-4 h-4 mr-1" /> Descargar PDF
                </Button>
              ) : (
                <Button onClick={handleCreatePdf} disabled={generatePdf.isPending}>
                  {generatePdf.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileDown className="w-4 h-4 mr-1" />}
                  Crear PDF
                </Button>
              )}
            </div>
          )}

          {editable && (
            <div className="flex items-center gap-2 md:justify-end">
              <span className="text-xs text-muted-foreground mr-1 hidden sm:inline">
                {saveQuote.isPending ? 'Guardando…' : dirty ? 'Cambios sin guardar' : 'Todo guardado'}
              </span>
              <Button variant="outline" onClick={handleSave} disabled={!dirty || problems.length > 0 || busy}>
                {saveQuote.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                Guardar
              </Button>
              <Button onClick={() => setConfirmIssue(true)} disabled={!canIssue || busy}>
                {issueQuote.isPending || generatePdf.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileCheck2 className="w-4 h-4 mr-1" />}
                Generar cotización oficial
              </Button>
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={confirmIssue} onOpenChange={setConfirmIssue}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Generar la cotización oficial?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>Para {clientLabel}, por un total de <span className="font-medium text-foreground">{formatCLP(totals.total)}</span> (neto {formatCLP(totals.net_total)}).</p>
                <p>Se le asigna el número oficial correlativo, se crea el PDF para enviar al cliente y ya no se podrá modificar.{dirty && ' Tus cambios se guardan antes.'}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Revisar de nuevo</AlertDialogCancel>
            <AlertDialogAction onClick={handleIssue}>Generar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta cotización en preparación?</AlertDialogTitle>
            <AlertDialogDescription>Se borran los equipos y precios que armaste. Siempre puedes crear otra desde la solicitud.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
