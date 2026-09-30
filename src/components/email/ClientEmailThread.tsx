import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { ArrowDownLeft, ArrowUpRight, Mail, Paperclip, Reply } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { openQuotePdf } from '@/hooks/useQuotePdf';
import { useWorkshopFeatures } from '@/hooks/useWorkshopFeatures';
import { useAuth } from '@/contexts/AuthContext';
import { type ContactEmail, useContactEmails, useMarkContactEmailsRead } from '@/hooks/useClientEmail';
import { cn } from '@/lib/utils';
import { SendClientEmailDialog, type SendTarget } from './SendClientEmailDialog';

const when = (value: string) => format(new Date(value), "d MMM, HH:mm", { locale: es });
const firstLine = (text: string) => text.split('\n').find(line => line.trim()) ?? '';

function EmailItem({ email, onAnswer }: { email: ContactEmail; onAnswer: () => void }) {
  const incoming = email.direction === 'in';
  const unread = incoming && !email.read_at;
  const long = email.body_text.split('\n').filter(line => line.trim()).length > 3 || email.body_text.length > 280;
  const [expanded, setExpanded] = useState(unread || !long);

  return (
    <li className={cn('p-3 space-y-1.5', unread && 'bg-sky-50/60 dark:bg-sky-950/20')}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {incoming ? <ArrowDownLeft className="w-4 h-4 text-sky-600" /> : <ArrowUpRight className="w-4 h-4 text-muted-foreground" />}
        <span className="font-medium">{incoming ? email.from_name || email.from_address : email.from_name || 'Tú'}</span>
        <span className="text-xs text-muted-foreground truncate max-w-[16rem]">
          {incoming ? email.from_address : `a ${email.to_addresses.join(', ')}`}
        </span>
        {unread && <Badge className="text-[10px] bg-sky-600 hover:bg-sky-600">Nuevo</Badge>}
        {email.kind === 'quote' && <Badge variant="outline" className="text-[10px]">Cotización</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">{when(email.sent_at)}</span>
      </div>
      {email.subject && <p className="text-xs text-muted-foreground">{email.subject}</p>}
      <p className="text-sm whitespace-pre-line break-words">
        {expanded ? email.body_text || <span className="text-muted-foreground">(sin texto)</span> : firstLine(email.body_text)}
        {long && (
          <button type="button" className="ml-1 text-xs text-muted-foreground underline underline-offset-2" onClick={() => setExpanded(v => !v)}>
            {expanded ? 'ver menos' : 'ver todo'}
          </button>
        )}
      </p>
      {(email.attachments.length > 0 || incoming) && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {email.attachments.map(file => (
            <Button key={file.path} variant="outline" size="sm" className="h-8"
              onClick={() => openQuotePdf(file.path).catch(err => toast.error('No se pudo abrir el archivo', { description: err instanceof Error ? err.message : undefined }))}>
              <Paperclip className="w-3.5 h-3.5 mr-1" /> {file.filename}
            </Button>
          ))}
          {incoming && (
            <Button size="sm" variant="secondary" className="h-8" onClick={onAnswer}>
              <Reply className="w-4 h-4 mr-1" /> Responder
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

// Emails with a client, oldest first. With quoteId, only that quote's threads.
// Seeing the new ones marks them as read.
export function ClientEmailThread({ contactId, quoteId, title = 'Correos con el cliente', emptyText, actions }: {
  contactId: string;
  quoteId?: string;
  title?: string;
  emptyText?: string; // show the section (with this text) even when there are no emails
  actions?: ReactNode;
}) {
  const { features } = useWorkshopFeatures();
  const { user } = useAuth();
  const { data } = useContactEmails(features.commercial ? contactId : null);
  const markRead = useMarkContactEmailsRead();
  const [target, setTarget] = useState<SendTarget | null>(null);

  const emails = useMemo(() => {
    if (!data || !quoteId) return data ?? [];
    const threads = new Set(data.filter(e => e.quote_id === quoteId && e.conversation_id).map(e => e.conversation_id));
    return data.filter(e => e.quote_id === quoteId || (e.conversation_id && threads.has(e.conversation_id)));
  }, [data, quoteId]);

  // Only the seller whose mailbox received the email "reads" it; an admin
  // looking at the thread must not clear the seller's "te escribió".
  const unread = emails.filter(e => e.direction === 'in' && !e.read_at && e.mailbox_user_id === user?.id).length;
  useEffect(() => {
    if (unread > 0 && !markRead.isPending) {
      // Give the person a moment to see the "Nuevo" mark before it goes.
      const timer = window.setTimeout(() => markRead.mutate(contactId), 4000);
      return () => window.clearTimeout(timer);
    }
  }, [unread, contactId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!features.commercial || (emails.length === 0 && !emptyText)) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold flex items-center gap-2"><Mail className="w-4 h-4" /> {title}</h4>
          <p className="text-xs text-muted-foreground">Desde los correos de Outlook conectados. Solo se muestran los correos con este cliente.</p>
        </div>
        {actions}
      </div>
      {emails.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-4">{emptyText}</p>
      ) : (
        <ul className="rounded-lg border divide-y">
          {emails.map(email => <EmailItem key={email.id} email={email} onAnswer={() => setTarget({ kind: 'answer', email })} />)}
        </ul>
      )}
      <SendClientEmailDialog target={target} open={!!target} onOpenChange={open => !open && setTarget(null)} />
    </section>
  );
}
