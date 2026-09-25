import { useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Ban, CheckCircle2, Clock, CopyPlus, FileDown, Loader2, MoreHorizontal, Send, ThumbsDown, ThumbsUp, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { formatCLP } from '@/lib/quoteTotals';
import {
  type Quote, SENT_VIA_LABELS, useCloseQuote, useLostReasons, useMarkQuoteSent, useReviseQuote, useVoidQuote,
} from '@/hooks/useQuotes';

const date = (value: string | null) => (value ? format(new Date(value), "d 'de' MMMM", { locale: es }) : '—');
const errorText = (err: unknown) => (err instanceof Error ? err.message : undefined);

// One sentence that says where the quote is and what comes next.
export function QuoteStatusLine({ quote }: { quote: Quote }) {
  const line = (() => {
    switch (quote.status) {
      case 'issued':
        return { icon: <Clock className="w-4 h-4 text-amber-600" />, text: `Cotización oficial del ${date(quote.issued_at)}. Falta enviarla al cliente.` };
      case 'sent':
        return { icon: <Send className="w-4 h-4 text-sky-600" />, text: `Enviada ${quote.sent_via ? `${SENT_VIA_LABELS[quote.sent_via]} ` : ''}el ${date(quote.sent_at)}. Esperando la respuesta del cliente.` };
      case 'accepted':
        return { icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" />, text: `Aceptada por el cliente el ${date(quote.closed_at)}. La solicitud quedó como vendida.` };
      case 'rejected':
        return { icon: <XCircle className="w-4 h-4 text-destructive" />, text: `Rechazada el ${date(quote.closed_at)}. Motivo: ${quote.lost_reason ?? '—'}.` };
      case 'void':
        return { icon: <Ban className="w-4 h-4 text-muted-foreground" />, text: `Anulada el ${date(quote.closed_at)}. ${quote.void_reason ?? ''}` };
      default:
        return null;
    }
  })();
  if (!line) return null;
  return <p className="text-sm text-muted-foreground flex items-center gap-1.5">{line.icon}{line.text}</p>;
}

export function QuoteLifecycleActions({ quote, onOpenPdf, onCreatePdf, pdfPending, onOpenQuote }: {
  quote: Quote;
  onOpenPdf: () => void;
  onCreatePdf: () => void;
  pdfPending: boolean;
  onOpenQuote: (quoteId: string) => void;
}) {
  const [dialog, setDialog] = useState<null | 'send' | 'accept' | 'reject' | 'void'>(null);
  const [via, setVia] = useState('email');
  const [reason, setReason] = useState('');
  const [closeRequest, setCloseRequest] = useState(true);
  const [voidReason, setVoidReason] = useState('');

  const markSent = useMarkQuoteSent();
  const closeQuote = useCloseQuote();
  const voidQuote = useVoidQuote();
  const revise = useReviseQuote();
  const { data: lostReasons } = useLostReasons(quote.workshop_id);

  const open = quote.status === 'issued' || quote.status === 'sent';
  const busy = markSent.isPending || closeQuote.isPending || voidQuote.isPending || revise.isPending;

  const run = async (action: () => Promise<unknown>, success: string, failure: string) => {
    try { await action(); toast.success(success); setDialog(null); }
    catch (err) { toast.error(failure, { description: errorText(err) }); }
  };

  const handleRevise = async () => {
    try {
      const result = await revise.mutateAsync(quote.id);
      toast.success(result.created ? 'Nueva versión creada: ajústala y genera la cotización oficial' : 'Ya había una versión en preparación: la abrimos');
      onOpenQuote(result.quote_id);
    } catch (err) {
      toast.error('No se pudo crear la nueva versión', { description: errorText(err) });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 md:justify-end">
      {quote.pdf_path ? (
        <Button variant={open ? 'outline' : 'default'} onClick={onOpenPdf}>
          <FileDown className="w-4 h-4 mr-1" /> Descargar PDF
        </Button>
      ) : (
        <Button variant="outline" onClick={onCreatePdf} disabled={pdfPending}>
          {pdfPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileDown className="w-4 h-4 mr-1" />}
          Crear PDF
        </Button>
      )}

      {quote.status === 'issued' && (
        <Button onClick={() => setDialog('send')} disabled={busy || !quote.pdf_path} title={!quote.pdf_path ? 'Primero crea el PDF' : undefined}>
          <Send className="w-4 h-4 mr-1" /> Marcar como enviada
        </Button>
      )}

      {quote.status === 'sent' && (
        <>
          <Button variant="outline" onClick={() => { setReason(''); setCloseRequest(true); setDialog('reject'); }} disabled={busy}>
            <ThumbsDown className="w-4 h-4 mr-1" /> Rechazada
          </Button>
          <Button onClick={() => setDialog('accept')} disabled={busy}>
            <ThumbsUp className="w-4 h-4 mr-1" /> Aceptada
          </Button>
        </>
      )}

      {quote.status !== 'accepted' && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Más acciones" disabled={busy}>
              {revise.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreHorizontal className="w-5 h-5" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={handleRevise}>
              <CopyPlus className="w-4 h-4 mr-2" /> Hacer nueva versión
            </DropdownMenuItem>
            {quote.status === 'issued' && (
              <DropdownMenuItem onSelect={() => setDialog('accept')}>
                <ThumbsUp className="w-4 h-4 mr-2" /> El cliente la aceptó
              </DropdownMenuItem>
            )}
            {open && (
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => { setVoidReason(''); setDialog('void'); }}>
                <Ban className="w-4 h-4 mr-2" /> Anular cotización
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Mark as sent */}
      <AlertDialog open={dialog === 'send'} onOpenChange={value => !value && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cómo se la enviaste al cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              Descarga el PDF y envíaselo por el medio que prefieras. Al marcarla como enviada, la solicitud pasa a "Cotizada" y cuenta en Control de ventas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <RadioGroup value={via} onValueChange={setVia} className="grid grid-cols-2 gap-2 py-2">
            {Object.entries({ email: 'Correo', whatsapp: 'WhatsApp', in_person: 'En persona', other: 'Otro' }).map(([value, label]) => (
              <Label key={value} htmlFor={`via-${value}`} className="flex items-center gap-2 rounded-md border p-3 cursor-pointer font-normal has-[:checked]:border-primary">
                <RadioGroupItem id={`via-${value}`} value={value} /> {label}
              </Label>
            ))}
          </RadioGroup>
          <AlertDialogFooter>
            <AlertDialogCancel>Todavía no</AlertDialogCancel>
            <AlertDialogAction disabled={markSent.isPending} onClick={event => {
              event.preventDefault();
              run(() => markSent.mutateAsync({ quoteId: quote.id, via }), 'Cotización marcada como enviada', 'No se pudo marcar como enviada');
            }}>
              Marcar como enviada
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Accepted */}
      <AlertDialog open={dialog === 'accept'} onOpenChange={value => !value && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿El cliente aceptó la {quote.quote_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              La solicitud quedará como vendida por {formatCLP(Number(quote.net_total))} neto ({formatCLP(Number(quote.total))} con IVA).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction disabled={closeQuote.isPending} onClick={event => {
              event.preventDefault();
              run(() => closeQuote.mutateAsync({ quoteId: quote.id, outcome: 'accepted' }), '¡Venta registrada!', 'No se pudo registrar la aceptación');
            }}>
              Sí, la aceptó
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rejected */}
      <AlertDialog open={dialog === 'reject'} onOpenChange={value => !value && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Por qué no la aceptó?</AlertDialogTitle>
            <AlertDialogDescription>El motivo queda registrado para entender por qué se pierden ventas.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-wrap gap-2 py-1">
            {(lostReasons || []).map(option => (
              <Button key={option} type="button" size="sm" variant={reason === option ? 'default' : 'outline'} onClick={() => setReason(option)}>
                {option}
              </Button>
            ))}
          </div>
          <label className="flex items-start gap-2 text-sm pt-2 cursor-pointer">
            <Checkbox checked={closeRequest} onCheckedChange={value => setCloseRequest(value === true)} className="mt-0.5" />
            <span>
              Marcar también la solicitud como perdida
              <span className="block text-xs text-muted-foreground">Desmárcalo si vas a mandarle una nueva versión con otro precio.</span>
            </span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction disabled={!reason || closeQuote.isPending} onClick={event => {
              event.preventDefault();
              run(() => closeQuote.mutateAsync({ quoteId: quote.id, outcome: 'rejected', reason, closeRequest }), 'Rechazo registrado', 'No se pudo registrar el rechazo');
            }}>
              Registrar rechazo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Void */}
      <AlertDialog open={dialog === 'void'} onOpenChange={value => !value && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Anular la {quote.quote_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              Úsalo si la cotización salió con un error. Queda anulada y su número no se vuelve a usar. Si solo cambia el precio, mejor haz una nueva versión.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <Label htmlFor="void-reason" className="text-xs text-muted-foreground">Motivo</Label>
            <Textarea id="void-reason" rows={2} className="resize-none" value={voidReason} placeholder="Ej: el RUT del cliente estaba mal"
              onChange={event => setVoidReason(event.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction disabled={!voidReason.trim() || voidQuote.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={event => {
                event.preventDefault();
                run(() => voidQuote.mutateAsync({ quoteId: quote.id, reason: voidReason.trim() }), 'Cotización anulada', 'No se pudo anular');
              }}>
              Anular
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
