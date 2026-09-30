import { useState } from 'react';
import { CalendarClock, Check, Loader2, Mail, MapPin, Phone, RefreshCw, Send, Sparkles, Timer } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { type NextAction, useCompleteNextAction, useRefreshNextAction } from '@/hooks/useCommercialFacts';
import { ACTION_LABELS, dueLabel } from '@/lib/leads';
import { cn } from '@/lib/utils';

const ICONS: Record<string, typeof Phone> = {
  call: Phone, email: Mail, send_quote: Send, follow_up: CalendarClock, visit: MapPin, wait: Timer,
};

// "Qué hacer ahora": one concrete action with a date and an argument.
export function NextActionCard({ requestId, action }: { requestId: string; action: NextAction | null | undefined }) {
  const refresh = useRefreshNextAction();
  const complete = useCompleteNextAction();
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);

  const regenerate = () => refresh.mutate(requestId, {
    onError: err => toast.error('No se pudo actualizar la sugerencia', { description: err instanceof Error ? err.message : undefined }),
  });

  if (!action) {
    return (
      <section className="rounded-lg border border-dashed p-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Sparkles className="w-4 h-4" /> La IA está preparando qué hacer ahora con este lead.
        </p>
        <Button size="sm" variant="outline" onClick={regenerate} disabled={refresh.isPending}>
          {refresh.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
          Sugerir ahora
        </Button>
      </section>
    );
  }

  const Icon = ICONS[action.action_type] ?? CalendarClock;
  const due = dueLabel(action.due_date);
  const done = !!action.done_at;

  return (
    <section className={cn('rounded-lg border p-4 space-y-2',
      done ? 'bg-muted/40' : due.overdue ? 'border-red-300 bg-red-50/50 dark:bg-red-950/20' : 'border-primary/30 bg-primary/5')}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-primary" /> Qué hacer ahora</h4>
        <Badge variant="outline" className="text-[11px]"><Icon className="w-3 h-3 mr-1" />{ACTION_LABELS[action.action_type] ?? action.action_type}</Badge>
        <Badge variant="outline" className={cn('text-[11px]', due.overdue ? 'border-red-300 bg-red-50 text-red-700' : due.today ? 'border-orange-300 bg-orange-50 text-orange-700' : '')}>{due.text}</Badge>
        {done && <Badge className="text-[11px] bg-emerald-600 hover:bg-emerald-600"><Check className="w-3 h-3 mr-1" />Hecho</Badge>}
        {action.model === 'reglas' && <span className="text-[11px] text-muted-foreground">sugerencia básica</span>}
      </div>
      <p className={cn('text-[15px] font-medium', done && 'line-through text-muted-foreground')}>{action.action}</p>
      {action.argument && <p className="text-sm"><span className="text-muted-foreground">Argumento:</span> {action.argument}</p>}
      {action.evidence && <p className="text-sm italic text-muted-foreground">El cliente dijo: "{action.evidence}"</p>}
      {action.reason && <p className="text-xs text-muted-foreground">{action.reason}</p>}
      {done && action.done_note && <p className="text-xs">Nota: {action.done_note}</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        {!done && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button size="sm"><Check className="w-4 h-4 mr-1" /> Hecho</Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-2" align="start">
              <p className="text-sm font-medium">¿Cómo te fue? (opcional)</p>
              <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Ej: decide el lunes con el gerente" maxLength={300} />
              <Button size="sm" className="w-full" disabled={complete.isPending} onClick={() => complete.mutate({ id: action.id, note }, {
                onSuccess: () => { setOpen(false); setNote(''); toast.success('Anotado', { description: 'La próxima sugerencia considerará lo que pasó.' }); },
                onError: err => toast.error('No se pudo marcar', { description: err instanceof Error ? err.message : undefined }),
              })}>
                {complete.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Marcar como hecho
              </Button>
            </PopoverContent>
          </Popover>
        )}
        <Button size="sm" variant="ghost" onClick={regenerate} disabled={refresh.isPending}>
          {refresh.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
          Otra sugerencia
        </Button>
      </div>
    </section>
  );
}
