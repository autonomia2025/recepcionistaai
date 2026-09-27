import { ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatCLP } from '@/lib/quoteTotals';
import { cn } from '@/lib/utils';
import type { OpenRequestFact } from '@/lib/insights';

// Compact, clickable list of requests behind a sentence or a "Mi día" section.
export function RequestFactList({ items, onOpen, showStaff = true }: {
  items: Array<OpenRequestFact & { note?: string; late?: boolean }>;
  onOpen: (requestId: string) => void;
  showStaff?: boolean;
}) {
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {items.map(item => (
        <li key={item.id}>
          <button type="button" onClick={() => onOpen(item.id)}
            className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">
                {item.company || item.client}
                {item.company && <span className="font-normal text-muted-foreground"> · {item.client}</span>}
              </p>
              <p className={cn('text-xs', item.late ? 'text-destructive' : 'text-muted-foreground')}>
                {[item.note, item.zone_label, showStaff ? item.staff_name : null].filter(Boolean).join(' · ')}
              </p>
            </div>
            {item.late && <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700 text-[10px]">Atrasada</Badge>}
            {item.amount != null && Number(item.amount) > 0 && (
              <span className="text-sm tabular-nums text-muted-foreground whitespace-nowrap">
                {item.amount_is_estimate ? '~' : ''}{formatCLP(Number(item.amount))}
              </span>
            )}
            <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          </button>
        </li>
      ))}
    </ul>
  );
}
