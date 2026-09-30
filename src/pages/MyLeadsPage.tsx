import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Flame, Inbox, Loader2, Mail, RefreshCw, Search, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { InterestedDetail } from '@/components/leads/InterestedDetail';
import { LeadDetail } from '@/components/leads/LeadDetail';
import { STAGE_STYLE } from '@/components/leads/stageStyle';
import { useAuth } from '@/contexts/AuthContext';
import { type NextAction, useActiveNextActions, useInterested, useLeadInbox } from '@/hooks/useCommercialFacts';
import { useServiceRequests } from '@/hooks/useServiceRequests';
import { useWorkshopFeatures } from '@/hooks/useWorkshopFeatures';
import { formatCLP } from '@/lib/quoteTotals';
import {
  type InterestedRow, type LeadFilter, type LeadRow, type LeadStage, type PriorityView, STAGE_FILTERS,
  ACTION_LABELS, agoPhrase, dueLabel, groupByDay, interestLabel, leadAmount, leadStage, matchesFilter, priorityView,
} from '@/lib/leads';
import { cn } from '@/lib/utils';

interface Item { lead: LeadRow; stage: LeadStage; priority: PriorityView; next?: NextAction }

function LeadListItem({ item, active, showStaff, onClick }: { item: Item; active: boolean; showStaff: boolean; onClick: () => void }) {
  const { lead, stage, priority, next } = item;
  const nextDue = next && !next.done_at ? dueLabel(next.due_date) : null;
  const amount = leadAmount(lead);
  const unread = Number(lead.unread_in ?? 0) > 0;
  return (
    <button type="button" onClick={onClick}
      className={cn('w-full text-left px-4 py-3 border-l-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        active ? 'bg-muted border-l-primary' : 'border-l-transparent hover:bg-muted/50')}>
      <div className="flex items-center gap-2">
        <span className={cn('w-2 h-2 rounded-full flex-shrink-0', STAGE_STYLE[stage.key].dot)} />
        <span className={cn('text-sm truncate flex-1', unread ? 'font-semibold' : 'font-medium')}>{lead.company || lead.client}</span>
        {priority.urgent && stage.key !== 'won' && stage.key !== 'lost' && (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] border-orange-300 bg-orange-50 text-orange-700"><Flame className="w-3 h-3 mr-0.5" />Urgente</Badge>
        )}
        {amount && <span className="text-xs tabular-nums text-muted-foreground whitespace-nowrap">{amount.estimate ? '~' : ''}{formatCLP(amount.value)}</span>}
      </div>
      <div className="pl-4 mt-0.5 space-y-0.5">
        <p className={cn('text-xs', stage.late ? 'text-destructive' : 'text-muted-foreground')}>
          {stage.note.startsWith(stage.label) ? <span className="font-medium">{stage.note}</span> : <><span className="font-medium">{stage.label}</span> · {stage.note}</>}
        </p>
        {priority.attention && (
          <p className={cn('text-xs font-medium', priority.attention.overdue ? 'text-destructive' : 'text-orange-700')}>{priority.attention.text}</p>
        )}
        {stage.key === 'replied' && lead.last_preview ? (
          <p className="text-xs text-foreground/80 truncate flex items-center gap-1"><Mail className="w-3 h-3 flex-shrink-0" />{lead.last_preview}</p>
        ) : priority.why ? (
          <p className="text-xs text-foreground/80 truncate italic">{priority.kind ? `${priority.kind}: ` : ''}{priority.why}</p>
        ) : priority.kind ? (
          <p className="text-xs text-muted-foreground">{priority.kind}</p>
        ) : null}
        {next && nextDue && (
          <p className={cn('text-xs truncate', nextDue.overdue ? 'text-destructive font-medium' : nextDue.today ? 'text-orange-700' : 'text-muted-foreground')}>
            Próximo: {ACTION_LABELS[next.action_type] ?? next.action} · {nextDue.text}
          </p>
        )}
        {showStaff && <p className="text-xs text-muted-foreground">{lead.staff_name ?? 'Sin vendedor'}</p>}
      </div>
    </button>
  );
}

function InterestedListItem({ row, active, onClick }: { row: InterestedRow; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('w-full text-left px-4 py-3 border-l-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        active ? 'bg-muted border-l-primary' : 'border-l-transparent hover:bg-muted/50')}>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full flex-shrink-0 bg-violet-400" />
        <span className="text-sm font-medium truncate flex-1">{row.company || row.client}</span>
        <span className="text-xs text-muted-foreground whitespace-nowrap">{agoPhrase(row.last_inbound_at)}</span>
      </div>
      <div className="pl-4 mt-0.5 space-y-0.5">
        <p className="text-xs text-muted-foreground"><span className="font-medium text-violet-700">{interestLabel(row)}</span>{row.zone_label ? ` · ${row.zone_label}` : ''}</p>
        {row.last_inbound_text && <p className="text-xs text-foreground/80 truncate italic">"{row.last_inbound_text}"</p>}
      </div>
    </button>
  );
}

export default function MyLeadsPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'ADMIN' || profile?.role === 'SUPERADMIN';
  const { features, isLoading: featuresLoading } = useWorkshopFeatures();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'leads' | 'interested'>(params.get('tab') === 'interesados' ? 'interested' : 'leads');
  const [scope, setScope] = useState<'me' | 'team'>(isAdmin ? 'team' : 'me');
  const [staffId, setStaffId] = useState<string | null>(null);
  const [filter, setFilter] = useState<LeadFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(params.get('lead'));
  const [interestedId, setInterestedId] = useState<string | null>(null);
  const { data: inbox, isLoading, isFetching, error, refetch } = useLeadInbox(scope, scope === 'team' ? staffId : null);
  const { data: interested = [], isLoading: interestedLoading, error: interestedError, refetch: refetchInterested } = useInterested();
  const { data: requests = [], isLoading: requestsLoading } = useServiceRequests();
  const { data: nextActions } = useActiveNextActions();

  const items = useMemo<Item[]>(() => {
    if (!inbox) return [];
    const now = new Date();
    return inbox.leads.map(lead => ({ lead, stage: leadStage(lead, inbox, now), priority: priorityView(lead, inbox), next: nextActions?.get(lead.id) }));
  }, [inbox, nextActions]);

  const counts = useMemo(() => Object.fromEntries(STAGE_FILTERS.map(f => [f.key, items.filter(i => matchesFilter(i.stage, i.lead, f.key)).length])), [items]);
  const q = search.trim().toLowerCase();
  const hit = (...values: Array<string | null | undefined>) => !q || values.some(v => v?.toLowerCase().includes(q));

  const visible = useMemo(
    () => items.filter(i => matchesFilter(i.stage, i.lead, filter) && hit(i.lead.client, i.lead.company, i.lead.client_email, i.lead.client_phone)),
    [items, filter, q], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const visibleInterested = interested.filter(r => hit(r.client, r.company, r.email, r.phone, r.last_inbound_text));

  // Clients who wrote go first, then everything by the day it arrived (urgent first within a day).
  const replied = visible.filter(i => i.stage.key === 'replied');
  const groups = useMemo(() => groupByDay(filter === 'replied' ? [] : visible.filter(i => i.stage.key !== 'replied')), [visible, filter]);

  const sellers = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of items) if (i.lead.staff_id) map.set(i.lead.staff_id, i.lead.staff_name ?? 'Sin nombre');
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const selected = tab === 'leads' ? items.find(i => i.lead.id === selectedId) ?? null : null;
  const selectedInterested = tab === 'interested' ? interested.find(r => r.contact_id === interestedId) ?? null : null;
  const request = selected ? requests.find(r => r.id === selected.lead.id) ?? null : null;
  const hasDetail = !!selected || !!selectedInterested;

  const selectLead = (id: string | null) => {
    setSelectedId(id);
    const next = new URLSearchParams(params);
    if (id) next.set('lead', id); else next.delete('lead');
    next.delete('tab');
    setParams(next, { replace: true });
  };

  if (!featuresLoading && !features.commercial) {
    return <div className="p-6 text-muted-foreground">El módulo comercial no está activo para este negocio.</div>;
  }

  const empty = (text: string) => (
    <div className="p-8 text-center text-sm text-muted-foreground space-y-2">
      <Inbox className="w-8 h-8 mx-auto opacity-50" />
      <p>{text}</p>
    </div>
  );

  const list = (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-4 space-y-3 border-b">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">{scope === 'team' && tab === 'leads' ? 'Leads del equipo' : 'Mis leads'}</h1>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Actualizar"
            onClick={() => (tab === 'leads' ? refetch() : refetchInterested())} disabled={isFetching}>
            <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
          </Button>
        </div>
        <div className="grid grid-cols-2 rounded-lg bg-muted p-1 text-sm">
          {([['leads', 'Leads', counts.all ?? 0], ['interested', 'Interesados', interested.length]] as const).map(([key, label, n]) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={cn('rounded-md px-3 py-1.5 transition-colors', tab === key ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground')}>
              {label} <span className="opacity-60">{n}</span>
            </button>
          ))}
        </div>
        {isAdmin && tab === 'leads' && (
          <Select value={scope === 'me' ? 'me' : staffId ?? 'all'} onValueChange={v => {
            if (v === 'me') { setScope('me'); setStaffId(null); } else { setScope('team'); setStaffId(v === 'all' ? null : v); }
          }}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todo el equipo</SelectItem>
              <SelectItem value="me">Solo los míos</SelectItem>
              {sellers.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="h-9 pl-8" placeholder="Buscar cliente, empresa, correo…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {tab === 'leads' ? (
          <div className="flex flex-wrap gap-1.5">
            {STAGE_FILTERS.map(f => (
              <button key={f.key} type="button" onClick={() => setFilter(f.key)}
                className={cn('rounded-full border px-2.5 py-1 text-xs transition-colors',
                  filter === f.key ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted',
                  f.key === 'urgent' && filter !== f.key && (counts.urgent ?? 0) > 0 && 'border-orange-300 text-orange-700')}>
                {f.label} <span className="opacity-70">{counts[f.key] ?? 0}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <Sparkles className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            Clientes con dudas o que consultaron precios en los últimos 14 días, sin pedir cotización todavía.{isAdmin ? '' : ' Solo de tu zona.'}
          </p>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'interested' ? (
          interestedLoading ? <p className="p-4 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</p>
          : interestedError ? <p className="p-4 text-sm text-destructive">No se pudieron cargar los interesados.</p>
          : visibleInterested.length === 0 ? empty(search ? 'Nadie coincide con la búsqueda.' : 'No hay interesados nuevos por ahora.')
          : visibleInterested.map(r => <InterestedListItem key={r.contact_id} row={r} active={r.contact_id === interestedId} onClick={() => setInterestedId(r.contact_id)} />)
        ) : isLoading ? (
          <p className="p-4 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</p>
        ) : error ? (
          <p className="p-4 text-sm text-destructive">No se pudieron cargar los leads: {error instanceof Error ? error.message : ''}</p>
        ) : visible.length === 0 ? (
          empty(search ? 'Ningún lead coincide con la búsqueda.' : filter === 'all' ? 'No tienes leads abiertos.' : 'No hay leads en esta vista.')
        ) : (
          <>
            {replied.length > 0 && (
              <div>
                <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-sky-700">Te escribieron · {replied.length}</p>
                {replied.map(i => <LeadListItem key={i.lead.id} item={i} active={i.lead.id === selectedId} showStaff={scope === 'team'} onClick={() => selectLead(i.lead.id)} />)}
              </div>
            )}
            {groups.map(g => (
              <div key={g.label}>
                <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label} · {g.items.length}</p>
                {g.items.map(i => <LeadListItem key={i.lead.id} item={i} active={i.lead.id === selectedId} showStaff={scope === 'team'} onClick={() => selectLead(i.lead.id)} />)}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="h-full flex min-h-0">
      {/* List: always on desktop; on mobile only when nothing is open */}
      <aside className={cn('w-full md:w-[380px] md:flex-shrink-0 md:border-r min-h-0', hasDetail ? 'hidden md:block' : 'block')}>
        {list}
      </aside>
      <section className={cn('flex-1 min-w-0 min-h-0 overflow-y-auto', hasDetail ? 'block' : 'hidden md:block')}>
        {selected ? (
          <div className="p-4 md:p-6 max-w-4xl">
            <LeadDetail key={selected.lead.id} lead={selected.lead} stage={selected.stage} priority={selected.priority} nextAction={selected.next ?? null}
              request={request} requestLoading={requestsLoading} onBack={() => selectLead(null)} />
          </div>
        ) : selectedInterested ? (
          <div className="p-4 md:p-6 max-w-4xl">
            <InterestedDetail key={selectedInterested.contact_id} row={selectedInterested} onBack={() => setInterestedId(null)}
              onTaken={id => { setInterestedId(null); setTab('leads'); setFilter('all'); setScope(isAdmin ? 'me' : 'me'); selectLead(id); }} />
          </div>
        ) : (
          <div className="h-full flex items-center justify-center p-8 text-center text-sm text-muted-foreground">
            <div className="space-y-2">
              <Inbox className="w-10 h-10 mx-auto opacity-40" />
              <p>{tab === 'leads' ? 'Elige un lead para ver todo: por qué llegó, la guía, la cotización y los correos.' : 'Elige un interesado para ver qué preguntó y decidir si lo tomas.'}</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
