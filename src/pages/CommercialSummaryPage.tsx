import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { AlertTriangle, CheckCircle2, ChevronDown, Info, Loader2, RefreshCw, TrendingDown, UserRound } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RequestDetailDialog } from '@/components/requests/RequestDetailDialog';
import { RequestFactList } from '@/components/commercial/RequestFactList';
import { useCommercialFacts, useTeamActivity } from '@/hooks/useCommercialFacts';
import { useServiceRequests } from '@/hooks/useServiceRequests';
import { useWorkshopFeatures } from '@/hooks/useWorkshopFeatures';
import { buildTeamActivity, buildTeamInsights, closeRates, type Insight, type SellerCard, type Severity } from '@/lib/insights';
import { cn } from '@/lib/utils';

const SEVERITY: Record<Severity, { icon: typeof Info; card: string; icon_class: string }> = {
  high: { icon: AlertTriangle, card: 'border-l-4 border-l-red-500', icon_class: 'text-red-600' },
  medium: { icon: AlertTriangle, card: 'border-l-4 border-l-amber-500', icon_class: 'text-amber-600' },
  info: { icon: TrendingDown, card: 'border-l-4 border-l-sky-500', icon_class: 'text-sky-600' },
  good: { icon: CheckCircle2, card: 'border-l-4 border-l-emerald-500', icon_class: 'text-emerald-600' },
};

function InsightCard({ insight, facts, onOpen }: {
  insight: Insight;
  facts: NonNullable<ReturnType<typeof useCommercialFacts>['data']>;
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const style = SEVERITY[insight.severity];
  const items = facts.open_requests.filter(r => insight.requestIds.includes(r.id));
  const Icon = style.icon;
  return (
    <Card className={style.card}>
      <CardContent className="p-4 space-y-3">
        <div className="flex gap-3">
          <Icon className={cn('w-5 h-5 mt-0.5 flex-shrink-0', style.icon_class)} />
          <p className="text-[15px] leading-relaxed">{insight.text}</p>
        </div>
        {items.length > 0 && (
          <>
            <Button variant="ghost" size="sm" className="h-8 -ml-2" onClick={() => setOpen(v => !v)}>
              <ChevronDown className={cn('w-4 h-4 mr-1 transition-transform', open && 'rotate-180')} />
              {open ? 'Ocultar' : `Ver ${items.length === 1 ? 'la solicitud' : `las ${items.length} solicitudes`}`}
            </Button>
            {open && <RequestFactList items={items} onOpen={onOpen} />}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RateTable({ title, rows }: { title: string; rows: ReturnType<typeof closeRates> }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay cotizaciones aceptadas ni rechazadas.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map(row => (
              <li key={row.name} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">{row.name}</span>
                <span className="text-right tabular-nums">
                  {row.rate != null
                    ? <><span className="font-semibold">{row.rate}%</span> <span className="text-muted-foreground">({row.won} de {row.closed})</span></>
                    : <span className="text-muted-foreground">{row.won} de {row.closed} · aún pocos datos</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SellerActivityCard({ card }: { card: SellerCard }) {
  const style = SEVERITY[card.severity];
  const Icon = card.severity === 'good' || card.severity === 'info' ? UserRound : style.icon;
  return (
    <Card className={style.card}>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start gap-3">
          <Icon className={cn('w-5 h-5 mt-0.5 flex-shrink-0', card.severity === 'info' ? 'text-muted-foreground' : style.icon_class)} />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">{card.name}</p>
            <p className="text-[15px] leading-relaxed">{card.headline}</p>
            {card.lines.map(line => <p key={line} className="text-sm text-muted-foreground">{line}</p>)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TeamActivitySection() {
  const { data, isLoading, error } = useTeamActivity(30);
  const cards = useMemo(() => (data ? buildTeamActivity(data) : []), [data]);
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Cómo trabaja el equipo</h2>
        <p className="text-sm text-muted-foreground">Últimos 30 días. Primero quien necesita ayuda hoy. La velocidad se compara con el equipo solo cuando hay casos suficientes.</p>
      </div>
      {isLoading ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Calculando…</p>
      ) : error ? (
        <p className="text-sm text-destructive">No se pudo calcular la actividad del equipo.</p>
      ) : cards.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-4">Todavía no hay vendedores con solicitudes.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {cards.map(card => <SellerActivityCard key={card.staffId} card={card} />)}
        </div>
      )}
    </section>
  );
}

export default function CommercialSummaryPage() {
  const { features, isLoading: featuresLoading } = useWorkshopFeatures();
  const { data: facts, isLoading, isFetching, error, refetch, dataUpdatedAt } = useCommercialFacts('team');
  const { data: requests = [] } = useServiceRequests();
  const [openId, setOpenId] = useState<string | null>(null);
  const insights = useMemo(() => (facts ? buildTeamInsights(facts) : []), [facts]);
  const selected = requests.find(r => r.id === openId) ?? null;

  if (!featuresLoading && !features.commercial) {
    return (
      <div className="p-6">
        <PageHeader title="Resumen comercial" />
        <p className="text-muted-foreground">El módulo comercial no está activo para este negocio.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <PageHeader
        title="Resumen comercial"
        description="Lo que requiere tu atención, explicado en palabras. Toca una frase para ver las solicitudes."
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn('w-4 h-4 mr-1', isFetching && 'animate-spin')} /> Actualizar
          </Button>
        }
      />

      {isLoading ? (
        <p className="text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Calculando…</p>
      ) : error ? (
        <p className="text-destructive">No se pudo calcular el resumen: {error instanceof Error ? error.message : ''}</p>
      ) : facts && (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Hoy</h2>
            {insights.map(insight => <InsightCard key={insight.key} insight={insight} facts={facts} onOpen={setOpenId} />)}
          </section>

          <TeamActivitySection />

          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">Cierre de cotizaciones</h2>
              <p className="text-sm text-muted-foreground">Últimos 90 días. El porcentaje aparece desde {facts.thresholds.min_sample} cotizaciones cerradas.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <RateTable title="Por vendedor" rows={closeRates(facts, 'staff_name')} />
              <RateTable title="Por zona" rows={closeRates(facts, 'zone_label')} />
            </div>
          </section>

          <p className="text-xs text-muted-foreground">
            Calculado a las {format(new Date(dataUpdatedAt || Date.now()), 'HH:mm', { locale: es })} con los datos de este momento.
          </p>
        </>
      )}

      {selected && (
        <RequestDetailDialog request={selected} open={!!selected} onOpenChange={open => !open && setOpenId(null)} />
      )}
    </div>
  );
}
