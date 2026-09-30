import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Calculator, Check, ChevronRight, Database, Info, TrendingDown, TrendingUp, X, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { formatCLP } from '@/lib/quoteTotals';
import { type Change, type Explanation, type MetricRecord, shortDate, TONE_TEXT, type Tone } from '@/lib/metrics';
import { cn } from '@/lib/utils';

const TONE_BAR: Record<Tone, string> = { good: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500', neutral: 'bg-primary' };

export function ChangeBadge({ change }: { change: Change | null }) {
  if (!change) return null;
  const Icon = change.direction === 'down' ? TrendingDown : TrendingUp;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs',
      change.direction === 'up' || change.direction === 'new' ? 'text-emerald-700' : change.direction === 'down' ? 'text-red-700' : 'text-muted-foreground')}>
      {change.direction !== 'flat' && <Icon className="w-3.5 h-3.5" />}{change.text}
    </span>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof Info; title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Icon className="w-3.5 h-3.5" />{title}</h4>
      {children}
    </section>
  );
}

// Full explanation of a metric: what it measures, the calculation with the
// period's real numbers, where every piece of data comes from, what counts
// and what doesn't, what moves it, and the requests behind it.
export function MetricExplainer({ explanation: e, open, onOpenChange, records = [], trend }: {
  explanation: Explanation | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  records?: MetricRecord[];
  trend?: ReactNode;
}) {
  const navigate = useNavigate();
  if (!e) return null;
  const showAmount = records.some(r => r.amount != null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col gap-0">
        <div className={cn('h-1 w-full flex-shrink-0', TONE_BAR[e.tone])} />
        <SheetHeader className="px-6 pt-5 pb-4 border-b text-left space-y-1">
          <SheetTitle className="text-base">{e.title}</SheetTitle>
          <SheetDescription asChild>
            <div className="space-y-1">
              <p className={cn('text-3xl font-bold tracking-tight', TONE_TEXT[e.tone])}>{e.value}</p>
              {e.caption && <p className="text-sm text-muted-foreground">{e.caption}</p>}
              <ChangeBadge change={e.change} />
            </div>
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-6">
          {e.small && (
            <p className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-2.5 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />{e.small}
            </p>
          )}

          <Section icon={Info} title="Qué mide">
            <p className="text-sm leading-relaxed">{e.what}</p>
          </Section>

          {trend && <Section icon={TrendingUp} title="Últimas 8 semanas">{trend}</Section>}

          <Section icon={Calculator} title="Cómo se calcula (con los números reales)">
            <div className="rounded-lg border divide-y text-sm">
              {e.steps.map((s, i) => (
                <div key={i} className="flex items-start justify-between gap-4 px-3 py-2">
                  <span className="text-muted-foreground">{s.label}</span>
                  {s.value && <span className="font-medium tabular-nums text-right whitespace-nowrap">{s.value}</span>}
                </div>
              ))}
              <div className="px-3 py-2.5 bg-muted/50 font-semibold flex items-center gap-2"><ArrowRight className="w-4 h-4 text-primary" />{e.result}</div>
            </div>
          </Section>

          <Section icon={Database} title="De dónde salen los datos">
            <ul className="space-y-2">
              {e.sources.map(s => (
                <li key={s.data} className="text-sm">
                  <span className="font-medium">{s.data}</span>
                  <span className="block text-muted-foreground text-xs mt-0.5">Se registra en: {s.where}</span>
                </li>
              ))}
            </ul>
          </Section>

          {(e.counts.length > 0 || e.excludes.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {e.counts.length > 0 && (
                <Section icon={Check} title="Qué cuenta">
                  <ul className="space-y-1.5">{e.counts.map(c => <li key={c} className="flex gap-1.5 text-sm"><Check className="w-3.5 h-3.5 mt-0.5 text-emerald-600 flex-shrink-0" />{c}</li>)}</ul>
                </Section>
              )}
              {e.excludes.length > 0 && (
                <Section icon={X} title="Qué no cuenta">
                  <ul className="space-y-1.5">{e.excludes.map(c => <li key={c} className="flex gap-1.5 text-sm"><X className="w-3.5 h-3.5 mt-0.5 text-red-500 flex-shrink-0" />{c}</li>)}</ul>
                </Section>
              )}
            </div>
          )}

          {e.drivers.length > 0 && (
            <Section icon={Zap} title="Qué la mueve">
              <div className="flex flex-wrap gap-1.5">{e.drivers.map(d => <Badge key={d} variant="secondary" className="font-normal">{d}</Badge>)}</div>
            </Section>
          )}

          {e.records && (
            <Section icon={Database} title={`Los datos detrás del número (${records.length})`}>
              {records.length === 0 ? (
                <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-3">No hay registros en este período.</p>
              ) : (
                <ul className="rounded-lg border divide-y">
                  {records.map(r => (
                    <li key={`${r.id}-${r.date}`}>
                      <button type="button" onClick={() => { onOpenChange(false); navigate(`/leads?lead=${r.id}`); }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{r.client}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {[r.seller ?? 'Sin vendedor', r.zone, r.stage, r.cold ? 'Frío' : null].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">{shortDate(r.date)}</span>
                        {showAmount && <span className="text-sm tabular-nums whitespace-nowrap w-24 text-right">{r.amount != null ? formatCLP(Number(r.amount)) : '—'}</span>}
                        <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
