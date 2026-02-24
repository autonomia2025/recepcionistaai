import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TrendingUp, TrendingDown, Minus, Info, Database, Calculator, Calendar } from 'lucide-react';
import { getMetricDefinition, MetricDefinition } from './metricDefinitions';
import { useMetricBreakdown, BreakdownPeriod } from '@/hooks/useMetricBreakdown';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface MetricDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metricId: string;
  currentValue: number | string;
  workshopId?: string | null;
  isAdmin?: boolean;
}

export function MetricDetailModal({
  open,
  onOpenChange,
  metricId,
  currentValue,
  workshopId,
  isAdmin = false,
}: MetricDetailModalProps) {
  const [period, setPeriod] = useState<BreakdownPeriod>('week');
  const metric = getMetricDefinition(metricId);

  const { data: breakdown, isLoading } = useMetricBreakdown({
    metricId,
    workshopId,
    period,
    isAdmin,
  });

  if (!metric) return null;

  const formatValue = (value: number | string, unit: string) => {
    if (typeof value === 'string') return value;
    
    switch (unit) {
      case 'currency_clp':
        return new Intl.NumberFormat('es-CL', {
          style: 'currency',
          currency: 'CLP',
          maximumFractionDigits: 0,
        }).format(value);
      case 'currency_usd':
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 2,
        }).format(value);
      case 'hours':
        if (value < 1) return `${Math.round(value * 60)} min`;
        return `${value.toFixed(1)} hrs`;
      case 'percentage':
        return `${Math.round(value)}%`;
      default:
        return new Intl.NumberFormat('es-CL').format(value);
    }
  };

  const TrendIcon = breakdown?.comparison.trend === 'up' 
    ? TrendingUp 
    : breakdown?.comparison.trend === 'down' 
      ? TrendingDown 
      : Minus;

  const trendColor = breakdown?.comparison.trend === 'up' 
    ? 'text-green-600' 
    : breakdown?.comparison.trend === 'down' 
      ? 'text-red-600' 
      : 'text-muted-foreground';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${metric.bgClass}`}>
              <metric.icon className={`w-5 h-5 ${metric.colorClass}`} />
            </div>
            <span>{metric.name}</span>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 max-h-[60vh] overflow-y-auto">
          <div className="space-y-6 pb-4 pr-4">
          {/* Current Value */}
          <div className="text-center py-4 bg-muted/30 rounded-lg">
            <p className={`text-4xl font-bold ${metric.colorClass}`}>
              {formatValue(currentValue, metric.unit)}
            </p>
            {breakdown && !isLoading && (
              <div className={`flex items-center justify-center gap-1 mt-2 text-sm ${trendColor}`}>
                <TrendIcon className="w-4 h-4" />
                <span>
                  {breakdown.comparison.change >= 0 ? '+' : ''}
                  {breakdown.comparison.change.toFixed(0)}% vs período anterior
                </span>
              </div>
            )}
          </div>

          {/* What it means */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Info className="w-4 h-4" />
              ¿Qué significa?
            </div>
            <p className="text-sm leading-relaxed">{metric.description}</p>
          </div>

          {/* Data source */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Database className="w-4 h-4" />
              ¿De dónde sale?
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">{metric.dataSource}</p>
          </div>

          {/* Formula */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Calculator className="w-4 h-4" />
              ¿Cómo se calcula?
            </div>
            <div className="bg-muted/50 px-3 py-2 rounded-md">
              <code className="text-sm">{metric.formula}</code>
            </div>
            {breakdown?.calculationExample && !isLoading && (
              <p className="text-xs text-muted-foreground mt-1">
                Ejemplo actual: {breakdown.calculationExample}
              </p>
            )}
          </div>

          {/* Period breakdown */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Calendar className="w-4 h-4" />
              Desglose por período
            </div>
            
            <Tabs value={period} onValueChange={(v) => setPeriod(v as BreakdownPeriod)}>
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="day">Hoy</TabsTrigger>
                <TabsTrigger value="week">Semana</TabsTrigger>
                <TabsTrigger value="month">Mes</TabsTrigger>
                <TabsTrigger value="all">Total</TabsTrigger>
              </TabsList>

              <TabsContent value={period} className="mt-4">
                {isLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-24 w-full" />
                  </div>
                ) : breakdown?.breakdown && breakdown.breakdown.length > 0 ? (
                  <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={breakdown.breakdown}>
                        <XAxis 
                          dataKey="label" 
                          tick={{ fontSize: 11 }} 
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis hide />
                        <Tooltip 
                          formatter={(value: number) => [formatValue(value, metric.unit), metric.name]}
                          labelFormatter={(label) => `${label}`}
                        />
                        <Bar 
                          dataKey="value" 
                          fill="hsl(var(--primary))" 
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    Sin datos para este período
                  </div>
                )}

                {breakdown && !isLoading && breakdown.comparison.previous > 0 && (
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Período anterior:</span>
                    <Badge variant="outline" className={trendColor}>
                      {formatValue(breakdown.comparison.previous, metric.unit)}
                    </Badge>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
