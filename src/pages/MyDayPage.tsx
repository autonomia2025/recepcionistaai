import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, Loader2, Mail, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { RequestDetailDialog } from '@/components/requests/RequestDetailDialog';
import { RequestFactList } from '@/components/commercial/RequestFactList';
import { useAuth } from '@/contexts/AuthContext';
import { useCommercialFacts, useMyActionsToday } from '@/hooks/useCommercialFacts';
import { useUnreadQuoteReplies } from '@/hooks/useClientEmail';
import { ACTION_LABELS, dueLabel } from '@/lib/leads';
import { MailboxConnection } from '@/components/email/MailboxConnection';
import { useServiceRequests } from '@/hooks/useServiceRequests';
import { useWorkshopFeatures } from '@/hooks/useWorkshopFeatures';
import { buildMyDay } from '@/lib/insights';
import { cn } from '@/lib/utils';

export default function MyDayPage() {
  const { profile } = useAuth();
  const { features, isLoading: featuresLoading } = useWorkshopFeatures();
  const { data: facts, isLoading, isFetching, error, refetch } = useCommercialFacts('me');
  const { data: requests = [] } = useServiceRequests();
  const [openId, setOpenId] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();

  // Notices in the bell link here with ?request=<id>.
  useEffect(() => {
    const id = params.get('request');
    if (!id) return;
    setOpenId(id);
    const next = new URLSearchParams(params);
    next.delete('request');
    setParams(next, { replace: true });
  }, [params, setParams]);
  const { data: replies = [] } = useUnreadQuoteReplies();
  const { data: todayActions = [] } = useMyActionsToday();
  const navigate = useNavigate();
  const sections = useMemo(() => (facts ? buildMyDay(facts) : []), [facts]);
  const selected = requests.find(r => r.id === openId) ?? null;
  const pending = sections.reduce((sum, s) => sum + s.items.length, 0) + replies.length + todayActions.length;
  const late = sections.reduce((sum, s) => sum + s.items.filter(i => i.late).length, 0);
  const firstName = profile?.full_name?.split(' ')[0];

  if (!featuresLoading && !features.commercial) {
    return (
      <div className="p-6">
        <PageHeader title="Mi día" />
        <p className="text-muted-foreground">El módulo comercial no está activo para este negocio.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <PageHeader
        title={firstName ? `Hola, ${firstName}` : 'Mi día'}
        description={facts
          ? pending === 0
            ? 'No tienes pendientes. Buen trabajo.'
            : `Tienes ${pending} ${pending === 1 ? 'pendiente' : 'pendientes'}${late ? `, ${late} ${late === 1 ? 'atrasado' : 'atrasados'}. Empieza por los marcados en rojo.` : '.'}`
          : 'Tus pendientes de hoy.'}
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn('w-4 h-4 mr-1', isFetching && 'animate-spin')} /> Actualizar
          </Button>
        }
      />

      <MailboxConnection />

      {todayActions.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">
            Qué hacer hoy
            <span className="ml-2 text-sm font-normal text-muted-foreground">{todayActions.length}</span>
          </h2>
          <ul className="divide-y rounded-lg border bg-card">
            {todayActions.map(a => {
              const due = dueLabel(a.due_date);
              return (
                <li key={a.id}>
                  <button type="button" onClick={() => navigate(`/leads?lead=${a.service_request_id}`)}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{a.contacts?.company_name || a.contacts?.name || 'Cliente'}</p>
                      <p className="text-xs text-muted-foreground truncate">{ACTION_LABELS[a.action_type] ?? ''}: {a.action}</p>
                    </div>
                    <span className={cn('text-xs whitespace-nowrap', due.overdue ? 'text-destructive font-medium' : 'text-orange-700')}>{due.text}</span>
                    <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {replies.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Mail className="w-4 h-4 text-sky-600" /> Te respondieron por correo
            <span className="text-sm font-normal text-muted-foreground">{replies.length}</span>
          </h2>
          <ul className="divide-y rounded-lg border bg-card">
            {replies.map(reply => (
              <li key={reply.id}>
                <button type="button" disabled={!reply.service_request_id} onClick={() => reply.service_request_id && setOpenId(reply.service_request_id)}
                  className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{reply.from_name || reply.from_address}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {(reply.body_text || '').split('\n').find(line => line.trim()) || 'Respondió la cotización'}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(new Date(reply.sent_at), { addSuffix: true, locale: es })}
                  </span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isLoading ? (
        <p className="text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</p>
      ) : error ? (
        <p className="text-destructive">No se pudieron cargar tus pendientes: {error instanceof Error ? error.message : ''}</p>
      ) : (
        sections.map(section => (
          <section key={section.key} className="space-y-2">
            <h2 className="text-base font-semibold">
              {section.title}
              <span className="ml-2 text-sm font-normal text-muted-foreground">{section.items.length}</span>
            </h2>
            {section.items.length === 0
              ? <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-4">{section.empty}</p>
              : <RequestFactList items={section.items} onOpen={setOpenId} showStaff={false} />}
          </section>
        ))
      )}

      {selected && (
        <RequestDetailDialog request={selected} open={!!selected} onOpenChange={open => !open && setOpenId(null)} />
      )}
    </div>
  );
}
