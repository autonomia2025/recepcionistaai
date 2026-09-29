import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Mail, Paperclip, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import type { Quote } from '@/hooks/useQuotes';
import { type ContactEmail, looksLikeEmail, splitAddresses, useMailbox, useSendClientEmail } from '@/hooks/useClientEmail';
import { defaultAnswerSubject, defaultQuoteMessage, defaultQuoteSubject } from '@/lib/quoteEmailText';
import { ConnectOutlookButton } from './MailboxConnection';

export type SendTarget =
  | { kind: 'quote'; quote: Quote }
  | { kind: 'answer'; email: ContactEmail };

// Sends from the seller's own Outlook: the official quote (with its PDF) or
// an answer to a client's email, in the same thread.
export function SendClientEmailDialog({ target, open, onOpenChange }: {
  target: SendTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: mailbox, isLoading: mailboxLoading } = useMailbox();
  const send = useSendClientEmail();
  const quote = target?.kind === 'quote' ? target.quote : null;
  const email = target?.kind === 'answer' ? target.email : null;
  const workshopId = quote?.workshop_id ?? email?.workshop_id ?? null;

  const { data: companyName } = useQuery({
    queryKey: ['company-name', workshopId],
    queryFn: async () => {
      const { data } = await supabase.from('commercial_settings').select('legal_name').eq('workshop_id', workshopId!).maybeSingle();
      return data?.legal_name ?? null;
    },
    enabled: open && !!workshopId,
  });

  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [touched, setTouched] = useState(false);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  // Fresh defaults every time the dialog opens.
  useEffect(() => {
    if (!open || !target) return;
    if (target.kind === 'quote') {
      const number = target.quote.quote_number ?? '';
      setTo(target.quote.client_email ?? '');
      setSubject(defaultQuoteSubject(number, companyName ?? null));
      setMessage(defaultQuoteMessage({ clientName: target.quote.client_name, quoteNumber: number, validityDays: Number(target.quote.validity_days) || null }));
    } else {
      setTo(target.email.direction === 'in' ? target.email.from_address : target.email.to_addresses.join(', '));
      setSubject(defaultAnswerSubject(target.email.subject, 'Consulta'));
      setMessage('');
    }
    setCc('');
    setTouched(false);
  }, [open, target, companyName]);

  const toList = useMemo(() => splitAddresses(to), [to]);
  const ccList = useMemo(() => splitAddresses(cc), [cc]);
  const invalid = [...toList, ...ccList].filter(address => !looksLikeEmail(address));
  const problems = [
    toList.length === 0 && 'Escribe el correo del cliente',
    invalid.length > 0 && `Revisa: ${invalid.join(', ')}`,
    !subject.trim() && 'Falta el asunto',
    !message.trim() && 'Escribe el mensaje',
  ].filter(Boolean) as string[];
  const ready = mailbox?.status === 'active';

  const handleSend = async () => {
    if (!target) return;
    setTouched(true);
    if (problems.length) return;
    try {
      const result = await send.mutateAsync({
        kind: target.kind,
        quoteId: quote?.id ?? email?.quote_id ?? null,
        replyToEmailId: email?.id ?? null,
        contactId: quote?.contact_id ?? email!.contact_id,
        requestId: quote?.service_request_id ?? email?.service_request_id ?? null,
        to: toList, cc: ccList, subject: subject.trim(), message: message.trim(),
      });
      toast.success(target.kind === 'quote' ? `Cotización enviada a ${toList.join(', ')}` : 'Respuesta enviada', {
        description: result.marked_sent ? 'La solicitud pasó a "Cotizada". Cuando el cliente responda, lo verás aquí.' : `Salió desde ${result.from}; también queda en tus Enviados de Outlook.`,
      });
      if (result.warning) toast.warning(result.warning);
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo enviar', { description: err instanceof Error ? err.message : undefined });
    }
  };

  const title = target?.kind === 'quote' ? `Enviar ${target.quote.quote_number} por correo` : 'Responder al cliente';

  return (
    <Dialog open={open} onOpenChange={next => !send.isPending && onOpenChange(next)}>
      <DialogContent className="max-w-xl w-[calc(100vw-1rem)] max-h-[92vh] p-0 gap-0 flex flex-col overflow-hidden"
        onOpenAutoFocus={event => { if (target?.kind === 'answer' && ready) { event.preventDefault(); messageRef.current?.focus(); } }}>
        <DialogHeader className="px-6 pt-6 pb-4 pr-12 text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {ready
              ? <>Sale desde tu correo <span className="font-medium">{mailbox!.email}</span> y queda en tus Enviados de Outlook.</>
              : 'Para enviar desde el panel, primero conecta tu correo de Outlook.'}
          </DialogDescription>
        </DialogHeader>

        {mailboxLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : !ready ? (
          <div className="px-6 pb-6 space-y-4">
            <div className="rounded-lg border bg-muted/40 p-4 text-sm space-y-2">
              <p className="flex items-center gap-2 font-medium"><Mail className="w-4 h-4" /> {mailbox ? 'Tu conexión con Outlook expiró' : 'Conecta tu Outlook una vez'}</p>
              <p className="text-muted-foreground">
                Te llevará a Microsoft para dar permiso y volverás a "Mi día". Después envías desde aquí con un clic y las respuestas de tus clientes aparecen en la solicitud.
              </p>
            </div>
            <ConnectOutlookButton label={mailbox ? 'Volver a conectar' : 'Conectar Outlook'} />
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 space-y-4">
              <div className="space-y-1">
                <Label htmlFor="mail-to">Para</Label>
                <Input id="mail-to" type="email" inputMode="email" autoComplete="off" value={to} placeholder="cliente@empresa.cl"
                  onChange={event => setTo(event.target.value)} />
                {quote && !quote.client_email && (
                  <p className="text-xs text-muted-foreground">La cotización no tiene correo del cliente; escríbelo aquí.</p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="mail-cc" className="text-muted-foreground font-normal">Copia (opcional)</Label>
                <Input id="mail-cc" type="text" inputMode="email" autoComplete="off" value={cc} placeholder="otra@empresa.cl"
                  onChange={event => setCc(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mail-subject">Asunto</Label>
                <Input id="mail-subject" value={subject} maxLength={200} onChange={event => setSubject(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mail-message">Mensaje</Label>
                <Textarea id="mail-message" ref={messageRef} rows={quote ? 7 : 6} value={message}
                  placeholder={email ? 'Escribe tu respuesta…' : undefined}
                  onChange={event => setMessage(event.target.value)} />
                <p className="text-xs text-muted-foreground">Al final se agrega tu firma con los datos de la empresa.</p>
              </div>
              {quote && (
                <p className="flex items-center gap-2 text-sm rounded-md border bg-muted/40 px-3 py-2">
                  <Paperclip className="w-4 h-4 text-muted-foreground" /> {quote.quote_number}.pdf
                </p>
              )}
            </div>

            <DialogFooter className="border-t bg-muted/40 px-6 py-4 gap-2 sm:space-x-0 sm:items-center">
              {touched && problems.length > 0 && <p className="text-sm text-destructive sm:mr-auto">{problems.join(' · ')}</p>}
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={send.isPending}>Cancelar</Button>
              <Button onClick={handleSend} disabled={send.isPending}>
                {send.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
                {send.isPending ? 'Enviando…' : 'Enviar'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
