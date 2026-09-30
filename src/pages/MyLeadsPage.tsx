import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Inbox, Loader2, Mail, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LeadDetail } from '@/components/leads/LeadDetail';
import { STAGE_STYLE } from '@/components/leads/stageStyle';
import { useAuth } from '@/contexts/AuthContext';
import { useLeadInbox } from '@/hooks/useCommercialFacts';
import { useServiceRequests } from '@/hooks/useServiceRequests';
import { useWorkshopFeatures } from '@/hooks/useWorkshopFeatures';
import { formatCLP } from '@/lib/quoteTotals';
import { type LeadRow, type LeadStage, type StageKey, STAGE_FILTERS, groupByDay, leadAmount, leadStage, matchesFilter } from '@/lib/leads';
import { cn } from '@/lib/utils';

type Filter = 'all' | StageKey | 'closed';
interface Item { lead: LeadRow; stage: LeadStage }

function LeadListItem({ item, active, showStaff, onClick }: { item: Item; active: boolean; showStaff: boolean; onClick: () => void }) {
  const { lead, stage } = item;
  const amount = leadAmount(lead);
  const unread = Number(lead.unread_in ?? 0) > 0;
  return (
    <button type="button" onClick={onClick}
      className={cn('w-full text-left px-4 py-3 border-l-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        active ? 'bg-muted border-l-primary' : 'border-l-transparent hover:bg-muted/50')}>
      <div className="flex items-center gap-2">
        <span className={cn('w-2 h-2 rounded-full flex-shrink-0', STAGE_STYLE[stage.key].dot)} />
        <span className={cn('text-sm truncate flex-1', unread ? 'font-semibold' : 'font-medium')}>{lead.company || lead.client}</span>
        {amount && <span className="text-xs tabular-nums text-muted-foreground whitespace-nowrap">{amount.estimate ? '~' : ''}{formatCLP(amount.value)}</span>}
      </div>
      <div className="pl-4 mt-0.5 space-y-0.5">
        <p className={cn('text-xs', stage.late ? 'text-destructive' : 'text-muted-foreground')}>
          {stage.note.startsWith(stage.label) ? <span className="font-medium">{stage.note}</span> : <><span className="font-medium">{stage.label}</span> · {stage.note}</>}
        </p>
        {stage.key === 'replied' && lead.last_preview && (
          <p className="text-xs text-foreground/80 truncate flex items-center gap-1"><Mail className="w-3 h-3 flex-shrink-0" />{lead.last_preview}</p>
        )}
        {showStaff && <p className="text-xs text-muted-foreground">{lead.staff_name ?? 'Sin vendedor'}</p>}
      </div>
    </button>
  );
}

export default function MyLeadsPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'ADMIN' || profile?.role === 'SUPERADMIN';
  const { features, isLoading: featuresLoading } = useWorkshopFeatures();
  const [params, setParams] = useSearchParams();
  const [scope, setScope] = useState<'me' | 'team'>(isAdmin ? 'team' : 'me');
  const [staffId, setStaffId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(params.get('lead'));
  const { data: inbox, isLoading, isFetching, error, refetch } = useLeadInbox(scope, scope === 'team' ? staffId : null);
  const { data: requests = [], isLoading: requestsLoading } = useServiceRequests();

  const items = useMemo<Item[]>(() => {
    if (!inbox) return [];
    const now = new Date();
    return inbox.leads.map(lead => ({ lead, stage: leadStage(lead, inbox, now) }));
  }, [inbox]);

  const counts = useMemo(() => Object.fromEntries(STAGE_FILTERS.map(f => [f.key, items.filter(i => matchesFilter(i.stage, i.lead, f.key)).length])), [items]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(i => matchesFilter(i.stage, i.lead, filter) &&
      (!q || [i.lead.client, i.lead.company, i.lead.client_email, i.lead.client_phone].some(v => v?.toLowerCase().includes(q))));
  }, [items, filter, search]);

  // Clients who wrote go first, then everything by the day it arrived.
  const replied = visible.filter(i => i.stage.key === 'replied');
  const groups = useMemo(() => groupByDay(filter === 'replied' ? [] : visible.filter(i => i.stage.key !== 'replied')), [visible, filter]);

  const sellers = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of items) if (i.lead.staff_id) map.set(i.lead.staff_id, i.lead.staff_name ?? 'Sin nombre');
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const selected = items.find(i => i.lead.id === selectedId) ?? null;
  const request = selected ? requests.find(r => r.id === selected.lead.id) ?? null : null;

  const select = (id: string | null) => {
    setSelectedId(id);
    const next = new URLSearchParams(params);
    if (id) next.set('lead', id); else next.delete('lead');
    setParams(next, { replace: true });
  };

  if (!featuresLoading && !features.commercial) {
    return <div className="p-6 text-muted-foreground">El módulo comercial no está activo para este negocio.</div>;
  }

  const list = (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-4 space-y-3 border-b">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">{scope === 'team' ? 'Leads del equipo' : 'Mis leads'}</h1>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetch()} disabled={isFetching} aria-label="Actualizar">
            <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
          </Button>
        </div>
        {isAdmin && (
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
        <div className="flex flex-wrap gap-1.5">
          {STAGE_FILTERS.map(f => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)}
              className={cn('rounded-full border px-2.5 py-1 text-xs transition-colors',
                filter === f.key ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted')}>
              {f.label} <span className="opacity-70">{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</p>
        ) : error ? (
          <p className="p-4 text-sm text-destructive">No se pudieron cargar los leads: {error instanceof Error ? error.message : ''}</p>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground space-y-2">
            <Inbox className="w-8 h-8 mx-auto opacity-50" />
            <p>{search ? 'Ningún lead coincide con la búsqueda.' : filter === 'all' ? 'No tienes leads abiertos.' : 'No hay leads en esta vista.'}</p>
          </div>
        ) : (
          <>
            {replied.length > 0 && (
              <div>
                <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-sky-700">Te escribieron · {replied.length}</p>
                {replied.map(i => <LeadListItem key={i.lead.id} item={i} active={i.lead.id === selectedId} showStaff={scope === 'team'} onClick={() => select(i.lead.id)} />)}
              </div>
            )}
            {groups.map(g => (
              <div key={g.label}>
                <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label} · {g.items.length}</p>
                {g.items.map(i => <LeadListItem key={i.lead.id} item={i} active={i.lead.id === selectedId} showStaff={scope === 'team'} onClick={() => select(i.lead.id)} />)}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="h-full flex min-h-0">
      {/* List: always on desktop; on mobile only when no lead is open */}
      <aside className={cn('w-full md:w-[380px] md:flex-shrink-0 md:border-r min-h-0', selected ? 'hidden md:block' : 'block')}>
        {list}
      </aside>
      <section className={cn('flex-1 min-w-0 min-h-0 overflow-y-auto', selected ? 'block' : 'hidden md:block')}>
        {selected ? (
          <div className="p-4 md:p-6 max-w-4xl">
            <LeadDetail key={selected.lead.id} lead={selected.lead} stage={selected.stage} request={request} requestLoading={requestsLoading} onBack={() => select(null)} />
          </div>
        ) : (
          <div className="h-full flex items-center justify-center p-8 text-center text-sm text-muted-foreground">
            <div className="space-y-2">
              <Inbox className="w-10 h-10 mx-auto opacity-40" />
              <p>Elige un lead para ver todo: por qué llegó, la guía, la cotización y los correos.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
