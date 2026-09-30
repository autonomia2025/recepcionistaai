import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { ArrowRight, Info, Loader2, Star } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatCLP } from '@/lib/quoteTotals';
import {
  type CommercialMetrics as Metrics, type Explanation, type MetricId, PERIODS, type PeriodKey,
  explain, hoursText, normalizeMetrics, pctText, periodRange, rangeText, recordsFor, shortDate, TONE_TEXT,
} from '@/lib/metrics';
import { cn } from '@/lib/utils';
import { ChangeBadge, MetricExplainer } from '@/components/metrics/MetricExplainer';

function useCommercialMetrics(period: PeriodKey) {
  const { profile } = useAuth();
  const range = periodRange(period);
  return useQuery({
    queryKey: ['commercial-metrics', range.from, range.to, profile?.workshop_id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('commercial_metrics', { _from: range.from, _to: range.to });
      if (error) throw error;
      return normalizeMetrics(data as unknown as Metrics);
    },
    enabled: !!profile?.workshop_id,
    refetchOnWindowFocus: true,
  });
}

function Tile({ e, onOpen, className }: { e: Explanation; onOpen: () => void; className?: string }) {
  return (
    <button type="button" onClick={onOpen}
      className={cn('group flex flex-col items-stretch justify-start text-left rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{e.title}</p>
        <Info className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary flex-shrink-0" />
      </div>
      <p className={cn('mt-1 text-2xl font-bold tracking-tight tabular-nums', TONE_TEXT[e.tone])}>{e.value}</p>
      {e.caption && <p className="text-xs text-muted-foreground mt-0.5">{e.caption}</p>}
      <div className="mt-1"><ChangeBadge change={e.change} /></div>
    </button>
  );
}

function WeeklyChart({ data, dataKey, format }: { data: Array<Record<string, number | string>>; dataKey: string; format: (v: number) => string }) {
  return (
    <div className="h-28">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={0} />
          <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number) => [format(v), '']} labelFormatter={l => `Semana del ${l}`} />
          <Bar dataKey={dataKey} fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// "Resultados comerciales" (admins, commercial module): North Star, leading
// indicator, ROI, funnel, speed, value, pipeline, team health and tables.
export function CommercialMetrics() {
  const [period, setPeriod] = useState<PeriodKey>('this_month');
  const { data: m, isLoading, error } = useCommercialMetrics(period);
  const [openId, setOpenId] = useState<MetricId | null>(null);

  const weekly = useMemo(() => (m?.north_star.weekly ?? []).map(w => ({
    label: shortDate(w.week), amount: w.amount, fastPct: w.leads > 0 ? Math.round((w.fast / w.leads) * 100) : 0,
  })), [m]);

  const range = periodRange(period);
  const e = (id: MetricId) => explain(id, m!);
  const open = openId && m ? e(openId) : null;
  const trend = openId === 'north_star' ? <WeeklyChart data={weekly} dataKey="amount" format={v => formatCLP(v)} />
    : openId === 'leading_fast' ? <WeeklyChart data={weekly} dataKey="fastPct" format={v => `${v}%`} /> : undefined;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="section-title">Resultados comerciales</h2>
          <p className="text-sm text-muted-foreground">{rangeText(range.from, range.to)} · leads que nacieron del bot. Toca cualquier número para ver de dónde sale.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PERIODS.map(p => (
            <button key={p.key} type="button" onClick={() => setPeriod(p.key)}
              className={cn('rounded-full border px-3 py-1 text-xs transition-colors', period === p.key ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted')}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Calculando…</p>
      ) : error || !m ? (
        <p className="text-sm text-destructive">No se pudieron calcular las métricas comerciales.</p>
      ) : (
        <>
          {/* North Star + leading indicator + ROI */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <button type="button" onClick={() => setOpenId('north_star')}
              className="lg:col-span-2 text-left rounded-xl border-2 border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5 hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary flex items-center gap-1.5"><Star className="w-3.5 h-3.5" /> North Star</p>
                <Info className="w-4 h-4 text-muted-foreground/60" />
              </div>
              <p className="mt-1 text-sm font-medium">Ventas ganadas con leads del bot</p>
              <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
                <p className="text-4xl font-bold tracking-tight tabular-nums">{formatCLP(m.north_star.amount)}</p>
                <p className="text-sm text-muted-foreground pb-1">{m.north_star.count} {m.north_star.count === 1 ? 'venta' : 'ventas'} · neto</p>
              </div>
              <ChangeBadge change={e('north_star').change} />
              <div className="mt-2"><WeeklyChart data={weekly} dataKey="amount" format={v => formatCLP(v)} /></div>
            </button>
            <Tile e={e('leading_fast')} onOpen={() => setOpenId('leading_fast')} className="bg-primary/5" />
            <Tile e={e('roi')} onOpen={() => setOpenId('roi')} className="bg-emerald-500/5" />
          </div>

          {/* Funnel of the leads that arrived in the period */}
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">Embudo de los leads que llegaron en el período</h3>
              <p className="text-xs text-muted-foreground">{formatCLP(m.funnel.won_amount)} ganados de estos leads · {m.funnel.lost} perdidos</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {(['funnel_leads', 'funnel_contacted', 'funnel_quoted', 'funnel_won'] as const).map((id, i) => {
                const x = e(id);
                return (
                  <div key={id} className="flex items-center gap-2">
                    <button type="button" onClick={() => setOpenId(id)}
                      className="flex-1 rounded-lg border p-3 text-left hover:border-primary/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <p className="text-xs text-muted-foreground">{x.title}</p>
                      <p className="text-2xl font-bold tabular-nums">{x.value}</p>
                      <p className="text-xs text-muted-foreground">{i === 0 ? 'llegaron' : x.caption}</p>
                    </button>
                    {i < 3 && <ArrowRight className="hidden md:block w-4 h-4 text-muted-foreground flex-shrink-0" />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Speed, value and pipeline */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {(['speed_contact', 'speed_quote', 'urgent_on_time', 'pipeline', 'avg_ticket', 'avg_discount', 'cycle', 'lost'] as const).map(id => (
              <Tile key={id} e={e(id)} onOpen={() => setOpenId(id)} />
            ))}
          </div>

          {/* Team health */}
          <div>
            <h3 className="text-sm font-semibold mb-2">Salud del equipo</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {(['clients_waiting', 'discount_over_limit', 'email_tone', 'adherence'] as const).map(id => (
                <Tile key={id} e={e(id)} onOpen={() => setOpenId(id)} />
              ))}
            </div>
          </div>

          {/* By seller / by zone */}
          <Tabs defaultValue="seller" className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Comparación</h3>
              <TabsList className="h-8">
                <TabsTrigger value="seller" className="text-xs">Por vendedor</TabsTrigger>
                <TabsTrigger value="zone" className="text-xs">Por zona</TabsTrigger>
              </TabsList>
            </div>
            {(['seller', 'zone'] as const).map(kind => {
              const rows = (kind === 'seller' ? m.by_seller : m.by_zone) ?? [];
              return (
                <TabsContent key={kind} value={kind} className="mt-3">
                  {rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sin datos en este período.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-muted-foreground border-b">
                            <th className="text-left font-medium py-2 pr-3">{kind === 'seller' ? 'Vendedor' : 'Zona'}</th>
                            <th className="text-right font-medium py-2 px-2">Leads</th>
                            <th className="text-right font-medium py-2 px-2">Cotizados</th>
                            <th className="text-right font-medium py-2 px-2">En 1 día hábil</th>
                            <th className="text-right font-medium py-2 px-2">Tiempo a cotizar</th>
                            <th className="text-right font-medium py-2 px-2">Ganados</th>
                            <th className="text-right font-medium py-2 pl-2">$ ganado</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {rows.map(r => (
                            <tr key={r.name}>
                              <td className="py-2 pr-3 font-medium">{r.name}</td>
                              <td className="py-2 px-2 text-right tabular-nums">{r.leads}</td>
                              <td className="py-2 px-2 text-right tabular-nums">{r.quoted} <span className="text-xs text-muted-foreground">({pctText(r.quoted, r.leads)})</span></td>
                              <td className="py-2 px-2 text-right tabular-nums">{pctText(r.fast, r.leads)}</td>
                              <td className="py-2 px-2 text-right tabular-nums">{hoursText(r.quote_median)}</td>
                              <td className="py-2 px-2 text-right tabular-nums">{r.won}</td>
                              <td className="py-2 pl-2 text-right tabular-nums font-medium">{formatCLP(r.won_amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="text-xs text-muted-foreground mt-2">Leads, cotizados y tiempos: de los leads que llegaron en el período. Ganados: ventas cerradas en el período.</p>
                    </div>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        </>
      )}

      <MetricExplainer explanation={open} open={!!open} onOpenChange={o => !o && setOpenId(null)}
        records={open && m ? recordsFor(open.records, m) : []} trend={trend} />
    </section>
  );
}
