import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { AlertTriangle, FileCheck2, Loader2, Plus, Save, Search, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { catalogLineDescription } from '@/lib/catalogDescription';
import { computeQuoteTotals, formatCLP, lineTotal } from '@/lib/quoteTotals';
import { formatRut, isValidRut } from '@/lib/rut';
import {
  type CatalogRow, type DraftLine, EDITABLE_QUOTE_FIELDS, type EditableQuoteFields, type Quote, type QuoteLine,
  QUOTE_STATUS_LABELS, useCatalogSearch, useDeleteQuoteDraft, useDiscountThreshold, useIssueQuote, useQuote,
  useQuoteSuggestions, useSaveQuote,
} from '@/hooks/useQuotes';

const SOURCE_LABELS: Record<string, string> = {
  chosen: 'Eligió',
  customer_asked: 'Lo pidió',
  datasheet_sent: 'Recibió ficha',
  suggested: 'Sugerido',
  manual: 'Agregado',
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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

const toNumber = (value: string) => (value.trim() === '' ? 0 : Number(value));

interface QuoteEditorDialogProps {
  quoteId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuoteEditorDialog({ quoteId, open, onOpenChange }: QuoteEditorDialogProps) {
  const { data, isLoading, error } = useQuote(open ? quoteId : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-hidden flex flex-col">
        {isLoading || !data ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <DialogTitle className="sr-only">Cotización</DialogTitle>
            {error ? 'No se pudo cargar la cotización.' : <Loader2 className="w-5 h-5 animate-spin" />}
          </div>
        ) : (
          // Re-mounted after every save so the form starts from what the database stored.
          <QuoteEditorBody key={data.quote.updated_at} quote={data.quote} savedLines={data.lines} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function QuoteEditorBody({ quote, savedLines, onClose }: { quote: Quote; savedLines: QuoteLine[]; onClose: () => void }) {
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
  const { data: threshold } = useDiscountThreshold(quote.workshop_id);
  const { data: suggestions } = useQuoteSuggestions(editable ? quote.contact_id : null, quote.workshop_id);
  const { data: results, isFetching: searching } = useCatalogSearch(editable ? quote.workshop_id : null, search);

  const dirty = JSON.stringify(header) !== JSON.stringify(initialHeader) || JSON.stringify(lines) !== JSON.stringify(initialLines);
  const totals = computeQuoteTotals(lines, Number(header.global_discount_pct), Number(header.vat_rate));
  const overThreshold = threshold != null && totals.max_discount_pct > threshold;
  const inQuote = new Set(lines.map(line => line.sku_normalized).filter(Boolean));
  const pendingSuggestions = (suggestions || []).filter(row => !inQuote.has(row.sku_normalized));

  const setField = <K extends keyof EditableQuoteFields>(field: K, value: EditableQuoteFields[K]) =>
    setHeader(current => ({ ...current, [field]: value }));
  const setLine = (key: string, changes: Partial<DraftLine>) =>
    setLines(current => current.map(line => (line.key === key ? { ...line, ...changes } : line)));
  const addLine = (line: DraftLine) => setLines(current => [...current, line]);

  const problems: string[] = [];
  if (!header.client_name?.trim()) problems.push('Falta el nombre del cliente.');
  if (header.client_tax_id?.trim() && !isValidRut(header.client_tax_id)) problems.push('El RUT del cliente no es válido.');
  if (header.client_email?.trim() && !EMAIL_RE.test(header.client_email.trim())) problems.push('El correo del cliente no es válido.');
  if (lines.some(line => !line.description.trim())) problems.push('Todas las líneas necesitan descripción.');
  if (lines.some(line => !(line.quantity > 0))) problems.push('Las cantidades deben ser mayores a cero.');
  if (lines.some(line => line.unit_price < 0 || line.discount_pct < 0 || line.discount_pct > 100)) problems.push('Revisa precios y descuentos (0 a 100%).');
  if (Number(header.global_discount_pct) < 0 || Number(header.global_discount_pct) > 100) problems.push('El descuento global va de 0 a 100%.');
  if (!(Number(header.validity_days) >= 1 && Number(header.validity_days) <= 365)) problems.push('La validez va de 1 a 365 días.');

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

  const handleSave = async () => {
    try {
      await saveQuote.mutateAsync({ quote, header: normalizedHeader(), lines: lines.map(line => ({ ...line, description: line.description.trim() })), savedLines });
      toast.success('Borrador guardado');
    } catch (err) {
      toast.error('No se pudo guardar', { description: err instanceof Error ? err.message : undefined });
    }
  };

  const handleIssue = async () => {
    setConfirmIssue(false);
    try {
      const result = await issueQuote.mutateAsync(quote);
      toast.success(`Cotización ${result.quote_number} emitida`);
    } catch (err) {
      toast.error('No se pudo emitir', { description: err instanceof Error ? err.message : undefined });
    }
  };

  const handleDelete = async () => {
    setConfirmDelete(false);
    try {
      await deleteDraft.mutateAsync(quote);
      toast.success('Borrador eliminado');
      onClose();
    } catch (err) {
      toast.error('No se pudo eliminar', { description: err instanceof Error ? err.message : undefined });
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3">
          <span>{quote.quote_number ? `Cotización ${quote.quote_number}` : 'Borrador de cotización'}</span>
          <Badge variant={editable ? 'secondary' : 'default'}>{QUOTE_STATUS_LABELS[quote.status] ?? quote.status}</Badge>
        </DialogTitle>
        <DialogDescription>
          {editable
            ? 'Revisa y ajusta el borrador. Al emitir se asigna el número oficial y ya no se puede editar.'
            : `Emitida el ${quote.issued_at ? format(new Date(quote.issued_at), "d 'de' MMMM yyyy, HH:mm", { locale: es }) : '—'}. Para cambiarla hay que crear una revisión.`}
        </DialogDescription>
      </DialogHeader>

      <ScrollArea className="flex-1 min-h-0 pr-3">
        <div className="space-y-6 pb-2">
          {/* Client */}
          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Cliente</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {([
                ['client_name', 'Nombre', 'Nombre del cliente'],
                ['client_company', 'Empresa', 'Razón social'],
                ['client_tax_id', 'RUT', '76.644.520-9'],
                ['client_email', 'Correo', 'correo@empresa.cl'],
                ['client_phone', 'Teléfono', '+56 9 1234 5678'],
                ['client_address', 'Dirección', 'Dirección o comuna'],
              ] as const).map(([field, label, placeholder]) => (
                <div key={field} className="space-y-1">
                  <Label htmlFor={`quote-${field}`} className="text-xs">{label}</Label>
                  <Input
                    id={`quote-${field}`}
                    value={(header[field] as string | null) ?? ''}
                    placeholder={placeholder}
                    disabled={!editable}
                    className="h-8 text-sm"
                    onChange={event => setField(field, event.target.value)}
                    onBlur={() => {
                      if (field === 'client_tax_id' && header.client_tax_id && isValidRut(header.client_tax_id)) {
                        setField('client_tax_id', formatRut(header.client_tax_id));
                      }
                    }}
                  />
                </div>
              ))}
            </div>
          </section>

          <Separator />

          {/* Lines */}
          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Equipos</h4>
            {lines.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No hay equipos todavía. {editable && 'Búscalos en el catálogo o agrega una línea libre.'}
              </p>
            )}
            {lines.length > 0 && (
              <div className="rounded-lg border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="text-left font-medium p-2">Equipo</th>
                      <th className="text-right font-medium p-2 w-20">Cant.</th>
                      <th className="text-right font-medium p-2 w-36">Precio unit. neto</th>
                      <th className="text-right font-medium p-2 w-20">Desc. %</th>
                      <th className="text-right font-medium p-2 w-32">Total</th>
                      {editable && <th className="w-10" />}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map(line => (
                      <tr key={line.key} className="border-t align-top">
                        <td className="p-2 space-y-1">
                          <div className="flex items-center gap-2">
                            {line.sku && <span className="font-semibold">{line.sku}</span>}
                            <Badge variant="outline" className="text-[10px] font-normal">{SOURCE_LABELS[line.source] ?? line.source}</Badge>
                          </div>
                          <Input
                            value={line.description}
                            disabled={!editable}
                            placeholder="Descripción"
                            className="h-8 text-sm"
                            onChange={event => setLine(line.key, { description: event.target.value })}
                          />
                          {(line.price_min != null || line.price_max != null) && (
                            <p className="text-xs text-muted-foreground">
                              Rango del catálogo: {formatCLP(line.price_min ?? line.price_max ?? 0)} – {formatCLP(line.price_max ?? line.price_min ?? 0)} neto
                            </p>
                          )}
                        </td>
                        <td className="p-2">
                          <Input type="number" min={0.01} step={1} value={line.quantity} disabled={!editable}
                            className="h-8 text-sm text-right" onChange={event => setLine(line.key, { quantity: toNumber(event.target.value) })} />
                        </td>
                        <td className="p-2">
                          <Input type="number" min={0} step={1000} value={line.unit_price} disabled={!editable}
                            className="h-8 text-sm text-right" onChange={event => setLine(line.key, { unit_price: Math.round(toNumber(event.target.value)) })} />
                        </td>
                        <td className="p-2">
                          <Input type="number" min={0} max={100} step={0.5} value={line.discount_pct} disabled={!editable}
                            className={cn('h-8 text-sm text-right', threshold != null && line.discount_pct > threshold && 'border-amber-500')}
                            onChange={event => setLine(line.key, { discount_pct: toNumber(event.target.value) })} />
                        </td>
                        <td className="p-2 text-right font-medium whitespace-nowrap pt-4">{formatCLP(lineTotal(line))}</td>
                        {editable && (
                          <td className="p-2 pt-3">
                            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Quitar línea"
                              onClick={() => setLines(current => current.filter(item => item.key !== line.key))}>
                              <Trash2 className="w-4 h-4 text-muted-foreground" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {editable && (
              <div className="space-y-3">
                {pendingSuggestions.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> El bot también le recomendó:</span>
                    {pendingSuggestions.map(row => (
                      <Button key={row.sku_normalized} variant="outline" size="sm" className="h-7 text-xs" onClick={() => addLine(fromCatalog(row, 'suggested'))}>
                        <Plus className="w-3 h-3 mr-1" /> {row.sku}
                      </Button>
                    ))}
                  </div>
                )}
                <div className="flex flex-col md:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 absolute left-2.5 top-2 text-muted-foreground" />
                    <Input value={search} placeholder="Buscar un equipo del catálogo por código (ej: MH130)" className="h-8 text-sm pl-8"
                      onChange={event => setSearch(event.target.value)} />
                  </div>
                  <Button variant="outline" size="sm" className="h-8" onClick={() => addLine({
                    key: crypto.randomUUID(), id: null, sku: null, sku_normalized: null, description: '', quantity: 1,
                    unit_price: 0, discount_pct: 0, price_min: null, price_max: null, source: 'manual',
                  })}>
                    <Plus className="w-4 h-4 mr-1" /> Línea libre
                  </Button>
                </div>
                {search.trim().length >= 2 && (
                  <div className="rounded-lg border divide-y">
                    {searching && <p className="p-2 text-xs text-muted-foreground">Buscando…</p>}
                    {!searching && (results || []).length === 0 && <p className="p-2 text-xs text-muted-foreground">Sin resultados.</p>}
                    {(results || []).map(row => (
                      <button key={row.sku_normalized} type="button" disabled={inQuote.has(row.sku_normalized)}
                        className="w-full text-left p-2 text-sm hover:bg-muted/50 disabled:opacity-50 flex justify-between gap-3"
                        onClick={() => { addLine(fromCatalog(row, 'manual')); setSearch(''); }}>
                        <span><span className="font-semibold">{row.sku}</span> <span className="text-muted-foreground">{catalogLineDescription(row)}</span></span>
                        <span className="whitespace-nowrap text-muted-foreground">{row.price_max != null ? formatCLP(Number(row.price_max)) : 'sin precio'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          <Separator />

          {/* Conditions + totals */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Condiciones</h4>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Validez (días)</Label>
                  <Input type="number" min={1} max={365} value={header.validity_days} disabled={!editable} className="h-8 text-sm"
                    onChange={event => setField('validity_days', toNumber(event.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Descuento global %</Label>
                  <Input type="number" min={0} max={100} step={0.5} value={header.global_discount_pct} disabled={!editable} className="h-8 text-sm"
                    onChange={event => setField('global_discount_pct', toNumber(event.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">IVA %</Label>
                  <Input type="number" min={0} max={100} step={0.5} value={header.vat_rate} disabled={!editable} className="h-8 text-sm"
                    onChange={event => setField('vat_rate', toNumber(event.target.value))} />
                </div>
              </div>
              {([
                ['payment_terms', 'Forma de pago'],
                ['delivery_terms', 'Plazo de entrega'],
                ['notes', 'Notas para el cliente'],
              ] as const).map(([field, label]) => (
                <div key={field} className="space-y-1">
                  <Label className="text-xs">{label}</Label>
                  <Textarea rows={2} value={(header[field] as string | null) ?? ''} disabled={!editable} className="text-sm"
                    onChange={event => setField(field, event.target.value)} />
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Totales</h4>
              <div className="rounded-lg border p-4 space-y-2 text-sm">
                {([
                  ['Subtotal', formatCLP(totals.gross_subtotal)],
                  ['Descuentos', totals.discount_total > 0 ? `−${formatCLP(totals.discount_total)}` : formatCLP(0)],
                  ['Neto', formatCLP(totals.net_total)],
                  [`IVA (${Number(header.vat_rate)}%)`, formatCLP(totals.vat_total)],
                ] as const).map(([label, value]) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-muted-foreground">{label}</span>
                    <span>{value}</span>
                  </div>
                ))}
                <Separator />
                <div className="flex justify-between text-base font-semibold">
                  <span>Total</span>
                  <span>{formatCLP(totals.total)}</span>
                </div>
              </div>
              {overThreshold && (
                <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>
                    El descuento ({totals.max_discount_pct}%) supera el umbral de {threshold}% de Configuración comercial.
                    La cotización quedará marcada para que el administrador la vea.
                  </span>
                </div>
              )}
              {editable && problems.length > 0 && (
                <ul className="text-xs text-destructive space-y-0.5">{problems.map(problem => <li key={problem}>• {problem}</li>)}</ul>
              )}
            </div>
          </section>
        </div>
      </ScrollArea>

      {editable && (
        <div className="flex flex-wrap justify-between gap-2 pt-3 border-t">
          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)} disabled={deleteDraft.isPending}>
            <Trash2 className="w-4 h-4 mr-1" /> Eliminar borrador
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleSave} disabled={!dirty || problems.length > 0 || saveQuote.isPending}>
              {saveQuote.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
              Guardar
            </Button>
            <Button size="sm" onClick={() => setConfirmIssue(true)}
              disabled={dirty || lines.length === 0 || totals.net_total <= 0 || problems.length > 0 || issueQuote.isPending}
              title={dirty ? 'Guarda los cambios antes de emitir' : undefined}>
              {issueQuote.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileCheck2 className="w-4 h-4 mr-1" />}
              Emitir cotización
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={confirmIssue} onOpenChange={setConfirmIssue}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Emitir la cotización?</AlertDialogTitle>
            <AlertDialogDescription>
              Se le asigna el número oficial y ya no se podrá editar. Total: {formatCLP(totals.total)} (neto {formatCLP(totals.net_total)}).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction onClick={handleIssue}>Emitir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar el borrador?</AlertDialogTitle>
            <AlertDialogDescription>Se borra el borrador y sus líneas. Esto no se puede deshacer.</AlertDialogDescription>
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
