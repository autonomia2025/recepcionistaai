import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { AlertTriangle, ChevronDown, CornerDownLeft, Mail, MailOpen, Paperclip, Reply } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { openQuotePdf } from '@/hooks/useQuotePdf';
import type { Quote } from '@/hooks/useQuotes';
import {
  EMAIL_STATUS_LABELS, type QuoteEmail, type QuoteEmailReply, useEmailReady, useMarkRepliesRead, useQuoteEmails,
} from '@/hooks/useQuoteEmail';
import { cn } from '@/lib/utils';
import { type AnswerContext, SendQuoteEmailDialog } from './SendQuoteEmailDialog';

const when = (value: string) => format(new Date(value), "d MMM, HH:mm", { locale: es });

const STATUS_STYLE: Record<string, string> = {
  delivered: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  bounced: 'border-red-300 bg-red-50 text-red-700',
  complained: 'border-red-300 bg-red-50 text-red-700',
  failed: 'border-red-300 bg-red-50 text-red-700',
  delayed: 'border-amber-300 bg-amber-50 text-amber-800',
};

type Item = { at: string; sent: QuoteEmail; reply?: never } | { at: string; reply: QuoteEmailReply; sent?: never };

function SentItem({ email }: { email: QuoteEmail }) {
  const [expanded, setExpanded] = useState(false);
  const problem = ['bounced', 'complained', 'failed'].includes(email.status);
  return (
    <li className="p-3 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <CornerDownLeft className="w-4 h-4 text-muted-foreground rotate-180" />
        <span className="font-medium">{email.kind === 'quote' ? 'Cotización enviada' : 'Tu respuesta'}</span>
        <span className="text-muted-foreground">a {email.to_addresses.join(', ')}</span>
        <Badge variant="outline" className={cn('text-[10px]', STATUS_STYLE[email.status])}>{EMAIL_STATUS_LABELS[email.status] ?? email.status}</Badge>
        <span className="ml-auto text-xs text-muted-foreground">{when(email.created_at)}</span>
      </div>
      {problem && email.status_detail && (
        <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> {email.status_detail}</p>
      )}
      <button type="button" onClick={() => setExpanded(v => !v)}
        className="text-left text-sm text-muted-foreground hover:text-foreground whitespace-pre-line w-full">
        {expanded ? email.body_text : email.body_text.split('\n').find(line => line.trim())}
        {!expanded && email.body_text.includes('\n') && <span className="ml-1 text-xs underline underline-offset-2">ver todo</span>}
      </button>
      {email.attachment_name && (
        <p className="text-xs text-muted-foreground flex items-center gap-1"><Paperclip className="w-3.5 h-3.5" /> {email.attachment_name}</p>
      )}
    </li>
  );
}

function ReplyItem({ reply, onAnswer }: { reply: QuoteEmailReply; onAnswer: (() => void) | null }) {
  const [showQuoted, setShowQuoted] = useState(false);
  return (
    <li className={cn('p-3 space-y-2', !reply.read_at && 'bg-sky-50/60 dark:bg-sky-950/20')}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {reply.read_at ? <MailOpen className="w-4 h-4 text-muted-foreground" /> : <Mail className="w-4 h-4 text-sky-600" />}
        <span className="font-medium">{reply.from_name || reply.from_address}</span>
        {reply.from_name && <span className="text-muted-foreground text-xs">{reply.from_address}</span>}
        {!reply.read_at && <Badge className="text-[10px] bg-sky-600 hover:bg-sky-600">Nueva</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">{when(reply.received_at)}</span>
      </div>
      {reply.sender_verified === false && (
        <p className="text-xs text-amber-700 flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5" /> No pudimos confirmar que este correo venga realmente de esa dirección. Confírmalo con el cliente antes de actuar.
        </p>
      )}
      <p className="text-sm whitespace-pre-line break-words">{reply.body_text || <span className="text-muted-foreground">(sin texto nuevo)</span>}</p>
      {reply.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {reply.attachments.map(file => (
            <Button key={file.path} variant="outline" size="sm" className="h-8"
              onClick={() => openQuotePdf(file.path).catch(err => toast.error('No se pudo abrir el archivo', { description: err instanceof Error ? err.message : undefined }))}>
              <Paperclip className="w-3.5 h-3.5 mr-1" /> {file.filename}
            </Button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {onAnswer && (
          <Button size="sm" variant="secondary" className="h-8" onClick={onAnswer}>
            <Reply className="w-4 h-4 mr-1" /> Responder
          </Button>
        )}
        {reply.quoted_text && (
          <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" onClick={() => setShowQuoted(v => !v)}>
            <ChevronDown className={cn('w-4 h-4 mr-1 transition-transform', showQuoted && 'rotate-180')} />
            {showQuoted ? 'Ocultar mensajes anteriores' : 'Ver mensajes anteriores'}
          </Button>
        )}
      </div>
      {showQuoted && reply.quoted_text && (
        <p className="text-xs text-muted-foreground whitespace-pre-line break-words border-l-2 pl-3">{reply.quoted_text}</p>
      )}
    </li>
  );
}

// Emails of a quote and the customer's replies, oldest first. Opening it marks
// the replies as read.
export function QuoteEmailThread({ quote }: { quote: Quote }) {
  const { data } = useQuoteEmails(quote.id);
  const ready = useEmailReady();
  const markRead = useMarkRepliesRead();
  const [answer, setAnswer] = useState<AnswerContext | null>(null);

  const unread = (data?.replies || []).filter(reply => !reply.read_at).length;
  useEffect(() => {
    if (unread > 0 && !markRead.isPending) {
      // Give the person a moment to see the "Nueva" mark before it goes.
      const timer = window.setTimeout(() => markRead.mutate(quote.id), 4000);
      return () => window.clearTimeout(timer);
    }
  }, [unread, quote.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || (data.sent.length === 0 && data.replies.length === 0)) return null;

  const items: Item[] = [
    ...data.sent.map(sent => ({ at: sent.created_at, sent })),
    ...data.replies.map(reply => ({ at: reply.received_at, reply })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const canAnswer = !!ready && quote.status !== 'void';

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Correos con el cliente</h3>
        <p className="text-xs text-muted-foreground">Lo que enviaste desde el panel y lo que el cliente respondió.</p>
      </div>
      <ul className="rounded-lg border divide-y">
        {items.map(item => item.sent
          ? <SentItem key={`s-${item.sent.id}`} email={item.sent} />
          : <ReplyItem key={`r-${item.reply!.id}`} reply={item.reply!}
              onAnswer={canAnswer ? () => setAnswer({ to: item.reply!.from_address, lastSubject: item.reply!.subject }) : null} />)}
      </ul>
      <SendQuoteEmailDialog quote={quote} open={!!answer} onOpenChange={open => !open && setAnswer(null)} answer={answer} />
    </section>
  );
}
