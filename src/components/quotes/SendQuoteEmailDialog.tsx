import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Paperclip, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Quote } from '@/hooks/useQuotes';
import { looksLikeEmail, splitAddresses, useEmailReady, useSendQuoteEmail } from '@/hooks/useQuoteEmail';
import { defaultAnswerSubject, defaultQuoteMessage, defaultQuoteSubject } from '@/lib/quoteEmailText';

export interface AnswerContext {
  to: string;
  lastSubject: string | null;
}

// Sends the official quote (with its PDF) or an answer in the same thread.
export function SendQuoteEmailDialog({ quote, open, onOpenChange, answer }: {
  quote: Quote;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  answer?: AnswerContext | null;
}) {
  const { profile } = useAuth();
  const ready = useEmailReady();
  const send = useSendQuoteEmail();
  const kind = answer ? 'answer' : 'quote';

  const { data: companyName } = useQuery({
    queryKey: ['company-name', quote.workshop_id],
    queryFn: async () => {
      const { data } = await supabase.from('commercial_settings').select('legal_name').eq('workshop_id', quote.workshop_id).maybeSingle();
      return data?.legal_name ?? null;
    },
    enabled: open,
  });

  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [copyToMe, setCopyToMe] = useState(true);
  const [touched, setTouched] = useState(false);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  // Fresh defaults every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    const number = quote.quote_number ?? '';
    setTo(answer ? answer.to : quote.client_email ?? '');
    setCc('');
    setSubject(answer ? defaultAnswerSubject(answer.lastSubject, number) : defaultQuoteSubject(number, companyName ?? null));
    setMessage(answer ? '' : defaultQuoteMessage({ clientName: quote.client_name, quoteNumber: number, validityDays: Number(quote.validity_days) || null }));
    setCopyToMe(true);
    setTouched(false);
  }, [open, answer, quote, companyName]);

  const toList = useMemo(() => splitAddresses(to), [to]);
  const ccList = useMemo(() => splitAddresses(cc), [cc]);
  const invalid = [...toList, ...ccList].filter(address => !looksLikeEmail(address));
  const problems = [
    toList.length === 0 && 'Escribe el correo del cliente',
    invalid.length > 0 && `Revisa: ${invalid.join(', ')}`,
    !subject.trim() && 'Falta el asunto',
    !message.trim() && 'Escribe el mensaje',
  ].filter(Boolean) as string[];

  const handleSend = async () => {
    setTouched(true);
    if (problems.length) return;
    try {
      const result = await send.mutateAsync({
        quoteId: quote.id, requestId: quote.service_request_id, kind,
        to: toList, cc: ccList, subject: subject.trim(), message: message.trim(), copyToMe,
      });
      toast.success(kind === 'quote' ? `Cotización enviada a ${toList.join(', ')}` : 'Respuesta enviada', {
        description: result.marked_sent ? 'La solicitud pasó a "Cotizada". Cuando el cliente responda, lo verás aquí.' : undefined,
      });
      if (result.warning) toast.warning(result.warning);
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo enviar', { description: err instanceof Error ? err.message : undefined });
    }
  };

  return (
    <Dialog open={open} onOpenChange={next => !send.isPending && onOpenChange(next)}>
      <DialogContent className="max-w-xl w-[calc(100vw-1rem)] max-h-[92vh] p-0 gap-0 flex flex-col overflow-hidden"
        onOpenAutoFocus={event => { if (answer) { event.preventDefault(); messageRef.current?.focus(); } }}>
        <DialogHeader className="px-6 pt-6 pb-4 pr-12 text-left">
          <DialogTitle>{kind === 'quote' ? `Enviar ${quote.quote_number} por correo` : 'Responder al cliente'}</DialogTitle>
          <DialogDescription>
            {ready
              ? <>Sale desde <span className="font-medium">{ready.sender_local}@{ready.domain}</span> con tu nombre. Si el cliente responde, su respuesta queda en esta cotización.</>
              : 'El correo de cotizaciones todavía no está configurado.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 space-y-4">
          <div className="space-y-1">
            <Label htmlFor="mail-to">Para</Label>
            <Input id="mail-to" type="email" inputMode="email" autoComplete="off" value={to} placeholder="cliente@empresa.cl"
              onChange={event => setTo(event.target.value)} />
            {!quote.client_email && kind === 'quote' && (
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
            <Textarea id="mail-message" ref={messageRef} rows={kind === 'quote' ? 7 : 6} value={message}
              placeholder={kind === 'answer' ? 'Escribe tu respuesta…' : undefined}
              onChange={event => setMessage(event.target.value)} />
            <p className="text-xs text-muted-foreground">Al final se agrega tu firma con los datos de la empresa.</p>
          </div>

          {kind === 'quote' && (
            <p className="flex items-center gap-2 text-sm rounded-md border bg-muted/40 px-3 py-2">
              <Paperclip className="w-4 h-4 text-muted-foreground" /> {quote.quote_number}.pdf
            </p>
          )}

          {profile?.email && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={copyToMe} onCheckedChange={value => setCopyToMe(value === true)} />
              Enviarme una copia a {profile.email}
            </label>
          )}

        </div>

        <DialogFooter className="border-t bg-muted/40 px-6 py-4 gap-2 sm:space-x-0 sm:items-center">
          {touched && problems.length > 0 && <p className="text-sm text-destructive sm:mr-auto">{problems.join(' · ')}</p>}
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={send.isPending}>Cancelar</Button>
          <Button onClick={handleSend} disabled={!ready || send.isPending}>
            {send.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
            {send.isPending ? 'Enviando…' : 'Enviar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
