import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowDownLeft, ArrowUpRight, ExternalLink, Loader2, Mail, RefreshCw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ClientEmailThread } from '@/components/email/ClientEmailThread';
import { type EmailThreadRow, useEmailThreads } from '@/hooks/useCommercialFacts';
import { useWorkshopFeatures } from '@/hooks/useWorkshopFeatures';
import { agoPhrase } from '@/lib/leads';
import { cn } from '@/lib/utils';

const HOUR = 3_600_000;
const waitingLong = (t: EmailThreadRow) => t.last_direction === 'in' && Date.now() - new Date(t.last_email_at).getTime() > 24 * HOUR;

function ThreadItem({ thread, active, onClick }: { thread: EmailThreadRow; active: boolean; onClick: () => void }) {
  const clientWaiting = thread.last_direction === 'in';
  return (
    <button type="button" onClick={onClick}
      className={cn('w-full text-left px-4 py-3 border-l-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        active ? 'bg-muted border-l-primary' : 'border-l-transparent hover:bg-muted/50')}>
      <div className="flex items-center gap-2">
        {clientWaiting ? <ArrowDownLeft className="w-4 h-4 text-sky-600 flex-shrink-0" /> : <ArrowUpRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
        <span className="text-sm font-medium truncate flex-1">{thread.company || thread.client}</span>
        <span className="text-xs text-muted-foreground whitespace-nowrap">{agoPhrase(thread.last_email_at)}</span>
      </div>
      <div className="pl-6 mt-0.5 space-y-0.5">
        <p className="text-xs text-muted-foreground truncate">{(thread.sellers ?? []).join(', ') || 'Sin vendedor'} · {thread.sent} enviados, {thread.received} recibidos</p>
        {thread.last_preview && <p className="text-xs text-foreground/80 truncate">{thread.last_preview}</p>}
        {clientWaiting && (
          <p className={cn('text-xs font-medium', waitingLong(thread) ? 'text-destructive' : 'text-sky-700')}>
            {waitingLong(thread) ? 'El cliente espera respuesta hace más de 24 horas' : 'El cliente escribió último'}
          </p>
        )}
      </div>
    </button>
  );
}

// Every client email of the team (admins): who writes to whom, how often and
// who is waiting for an answer. Opening a thread shows it complete.
export default function TeamEmailsPage() {
  const navigate = useNavigate();
  const { features, isLoading: featuresLoading } = useWorkshopFeatures();
  const [staffId, setStaffId] = useState<string | null>(null);
  const [onlyWaiting, setOnlyWaiting] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isLoading, isFetching, error, refetch } = useEmailThreads(staffId, 30);
  const { data: everyone } = useEmailThreads(null, 30);

  const sellers = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of everyone?.threads ?? []) (t.seller_ids ?? []).forEach((id, i) => map.set(id, t.sellers?.[i] ?? 'Sin nombre'));
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [everyone]);

  const threads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.threads ?? []).filter(t => (!onlyWaiting || t.last_direction === 'in') &&
      (!q || [t.client, t.company, t.last_subject].some(v => v?.toLowerCase().includes(q))));
  }, [data, onlyWaiting, search]);
  const waitingCount = (data?.threads ?? []).filter(t => t.last_direction === 'in').length;
  const current = threads.find(t => t.contact_id === selected) ?? (data?.threads ?? []).find(t => t.contact_id === selected) ?? null;

  if (!featuresLoading && !features.commercial) {
    return <div className="p-6 text-muted-foreground">El módulo comercial no está activo para este negocio.</div>;
  }

  return (
    <div className="h-full flex min-h-0">
      <aside className={cn('w-full md:w-[380px] md:flex-shrink-0 md:border-r min-h-0 flex flex-col', current ? 'hidden md:flex' : 'flex')}>
        <div className="p-4 space-y-3 border-b">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-lg font-semibold">Correos del equipo</h1>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetch()} disabled={isFetching} aria-label="Actualizar">
              <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Últimos 30 días, desde los Outlook conectados. Solo correos con clientes.</p>
          <Select value={staffId ?? 'all'} onValueChange={v => setStaffId(v === 'all' ? null : v)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los vendedores</SelectItem>
              {sellers.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="h-9 pl-8" placeholder="Buscar cliente o asunto…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="flex gap-1.5">
            {[{ v: false, label: 'Todos', n: data?.threads.length ?? 0 }, { v: true, label: 'Cliente espera respuesta', n: waitingCount }].map(f => (
              <button key={String(f.v)} type="button" onClick={() => setOnlyWaiting(f.v)}
                className={cn('rounded-full border px-2.5 py-1 text-xs transition-colors', onlyWaiting === f.v ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted')}>
                {f.label} <span className="opacity-70">{f.n}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {isLoading ? (
            <p className="p-4 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</p>
          ) : error ? (
            <p className="p-4 text-sm text-destructive">No se pudieron cargar los correos: {error instanceof Error ? error.message : ''}</p>
          ) : threads.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground space-y-2">
              <Mail className="w-8 h-8 mx-auto opacity-50" />
              <p>{(data?.threads.length ?? 0) === 0 ? 'Todavía no hay correos con clientes. Aparecen cuando los vendedores conectan su Outlook.' : 'Nada en esta vista.'}</p>
            </div>
          ) : threads.map(t => <ThreadItem key={t.contact_id} thread={t} active={t.contact_id === selected} onClick={() => setSelected(t.contact_id)} />)}
        </div>
      </aside>

      <section className={cn('flex-1 min-w-0 min-h-0 overflow-y-auto', current ? 'block' : 'hidden md:block')}>
        {current ? (
          <div className="p-4 md:p-6 max-w-4xl space-y-4">
            <Button variant="ghost" size="sm" className="-ml-2 h-8 md:hidden" onClick={() => setSelected(null)}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Correos del equipo
            </Button>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">{current.company || current.client}</h2>
                <p className="text-sm text-muted-foreground">
                  {current.company ? `${current.client} · ` : ''}{(current.sellers ?? []).join(', ') || 'Sin vendedor'} · {current.sent} enviados, {current.received} recibidos
                  {current.from_panel > 0 ? ` (${current.from_panel} desde el panel)` : ''}
                </p>
              </div>
              {current.request_id && (
                <Button variant="outline" onClick={() => navigate(`/leads?lead=${current.request_id}`)}>
                  <ExternalLink className="w-4 h-4 mr-1" /> Ver el lead
                </Button>
              )}
            </div>
            {waitingLong(current) && <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700">El cliente espera respuesta hace más de 24 horas</Badge>}
            <ClientEmailThread key={current.contact_id} contactId={current.contact_id} title="Conversación completa" />
          </div>
        ) : (
          <div className="h-full flex items-center justify-center p-8 text-center text-sm text-muted-foreground">
            <div className="space-y-2">
              <Mail className="w-10 h-10 mx-auto opacity-40" />
              <p>Elige un cliente para leer la conversación completa con el vendedor.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
