import { useState } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getMetricDefinition } from './metricDefinitions';
import { MetricDetailModal } from './MetricDetailModal';
import { cn } from '@/lib/utils';
import { TrendingUp, Info } from 'lucide-react';

interface MetricCardProps {
  metricId: string;
  value: number | string;
  workshopId?: string | null;
  isAdmin?: boolean;
  className?: string;
  subtitle?: string;
}

export function MetricCard({
  metricId,
  value,
  workshopId,
  isAdmin = false,
  className,
  subtitle,
}: MetricCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const metric = getMetricDefinition(metricId);

  if (!metric) {
    console.warn(`Metric definition not found for: ${metricId}`);
    return null;
  }

  const formatValue = (val: number | string) => {
    if (typeof val === 'string') return val;
    
    switch (metric.unit) {
      case 'currency_clp':
        return new Intl.NumberFormat('es-CL', {
          style: 'currency',
          currency: 'CLP',
          maximumFractionDigits: 0,
        }).format(val);
      case 'currency_usd':
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 2,
        }).format(val);
      case 'hours':
        if (val < 1) return `${Math.round(val * 60)} min`;
        return `${val.toFixed(1)} hrs`;
      case 'percentage':
        return `${Math.round(val)}%`;
      default:
        return new Intl.NumberFormat('es-CL').format(val);
    }
  };

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div 
              className={cn(
                "metric-card group cursor-pointer",
                className
              )}
              onClick={() => setIsModalOpen(true)}
            >
              {/* Top row: icon + info */}
              <div className="flex items-start justify-between mb-3">
                <div className={cn(
                  "p-2.5 rounded-xl transition-transform duration-200 group-hover:scale-105",
                  metric.bgClass
                )}>
                  <metric.icon className={cn("w-5 h-5", metric.colorClass)} />
                </div>
                <Info className="w-4 h-4 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              
              {/* Value */}
              <div className="space-y-1">
                <p className={cn(
                  "text-2xl md:text-3xl font-bold tracking-tight",
                  metric.colorClass
                )}>
                  {formatValue(value)}
                </p>
                <p className="text-sm font-medium text-muted-foreground">
                  {metric.name}
                </p>
                {subtitle && (
                  <p className="text-xs text-muted-foreground/70 flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" />
                    {subtitle}
                  </p>
                )}
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            <p>Click para ver detalles</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <MetricDetailModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        metricId={metricId}
        currentValue={value}
        workshopId={workshopId}
        isAdmin={isAdmin}
      />
    </>
  );
}
