import { useEffect, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { CheckCircle2, HelpCircle, Loader2, MessageCircle, PhoneCall, RefreshCw, Shield, Sparkles, ThumbsDown, ThumbsUp, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useCallGuide, useCallGuideFeedback, useGenerateCallGuide } from '@/hooks/useCallGuide';
import { useWorkshopFeatures } from '@/hooks/useWorkshopFeatures';

function Block({ icon: Icon, title, children }: { icon: typeof PhoneCall; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <Icon className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm font-medium">{title}</p>
        {children}
      </div>
    </div>
  );
}

// "Antes de llamar": AI-drafted brief for the seller's first call, generated the
// first time the request is opened. Only what the customer said backs it up.
export function CallGuideCard({ requestId, conversationId }: { requestId: string; conversationId: string | null }) {
  const { features } = useWorkshopFeatures();
  const { guide, stale } = useCallGuide(requestId, conversationId);
  const generate = useGenerateCallGuide(requestId);
  const [unavailable, setUnavailable] = useState(false);
  const autoStarted = useRef(false);

  // First open: write the guide automatically.
  useEffect(() => {
    if (!features.commercial || guide.isLoading || guide.data || autoStarted.current) return;
    autoStarted.current = true;
    generate.mutate(false, { onSuccess: data => { if (!data.guide) setUnavailable(true); } });
  }, [features.commercial, guide.isLoading, guide.data, generate]);

  if (!features.commercial || unavailable) return null;

  const data = guide.data?.content;
  const working = generate.isPending;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold flex items-center gap-2"><PhoneCall className="w-4 h-4 text-primary" /> Antes de llamar</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
            <Sparkles className="w-3 h-3" /> Sugerencia de la IA según la conversación
            {guide.data && !working && <> · {formatDistanceToNow(new Date(guide.data.generated_at), { locale: es, addSuffix: true })}</>}
          </p>
        </div>
        {guide.data && (
          <Button variant={stale ? 'default' : 'ghost'} size="sm" className="h-8 flex-shrink-0" disabled={working}
            onClick={() => generate.mutate(true, { onError: err => toast.error('No se pudo actualizar la guía', { description: err.message }) })}>
            <RefreshCw className={cn('w-3.5 h-3.5 mr-1', working && 'animate-spin')} />
            {stale ? 'Hay mensajes nuevos · Actualizar' : 'Actualizar'}
          </Button>
        )}
      </div>

      {(working && !data) || guide.isLoading ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Leyendo la conversación y preparando la guía… (unos segundos)</p>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : generate.isError && !data ? (
        <div className="text-sm space-y-2">
          <p className="text-destructive">No se pudo preparar la guía: {generate.error.message}</p>
          <Button variant="outline" size="sm" onClick={() => generate.mutate(false)}>Reintentar</Button>
        </div>
      ) : data ? (
        <div className={cn('space-y-4', working && 'opacity-50 pointer-events-none')}>
          {data.opening && (
            <Block icon={MessageCircle} title="Para abrir la llamada">
              <p className="text-sm border-l-2 border-primary/40 pl-3 italic">“{data.opening}”</p>
            </Block>
          )}

          {data.known.length > 0 && (
            <Block icon={CheckCircle2} title="Lo que ya sabemos">
              <ul className="space-y-1.5">
                {data.known.map(item => (
                  <li key={item.fact} className="text-sm">
                    {item.fact}
                    <span className="block text-xs text-muted-foreground italic">Dijo: “{item.evidence}”</span>
                  </li>
                ))}
              </ul>
            </Block>
          )}

          {data.missing.length > 0 && (
            <Block icon={HelpCircle} title="Pregúntale">
              <ul className="list-disc pl-4 space-y-1 text-sm marker:text-muted-foreground">
                {data.missing.map(item => <li key={item}>{item}</li>)}
              </ul>
            </Block>
          )}

          {data.profile && (
            <Block icon={UserRound} title="Cómo es el cliente">
              <p className="text-sm">
                <span className="font-medium">{data.profile.label.charAt(0).toUpperCase() + data.profile.label.slice(1)}</span>
                <span className="block text-xs text-muted-foreground italic">Dijo: “{data.profile.evidence}”</span>
              </p>
            </Block>
          )}

          {data.objections.length > 0 && (
            <Block icon={Shield} title="Si pone objeciones">
              <ul className="space-y-2">
                {data.objections.map(item => (
                  <li key={item.objection} className="text-sm">
                    <p className="font-medium">“{item.objection}”</p>
                    <p className="text-muted-foreground">{item.answer}</p>
                    {item.source && <p className="text-xs text-muted-foreground mt-0.5">Según: {item.source}</p>}
                  </li>
                ))}
              </ul>
            </Block>
          )}

          {data.known.length === 0 && data.missing.length === 0 && data.objections.length === 0 && (
            <p className="text-sm text-muted-foreground">La conversación todavía es muy corta para preparar una guía útil.</p>
          )}

          {guide.data && <GuideFeedback guideId={guide.data.id} />}
        </div>
      ) : null}
    </div>
  );
}

function GuideFeedback({ guideId }: { guideId: string }) {
  const { mine, save } = useCallGuideFeedback(guideId);
  const [writing, setWriting] = useState(false);
  const [comment, setComment] = useState('');
  const current = mine.data;

  const send = (useful: boolean, text?: string) =>
    save.mutate({ useful, comment: text }, {
      onSuccess: () => { setWriting(false); toast.success('¡Gracias! Con esto mejoramos las guías.'); },
      onError: err => toast.error('No se pudo guardar tu opinión', { description: err instanceof Error ? err.message : undefined }),
    });

  return (
    <div className="border-t pt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground mr-1">¿Te sirvió esta guía?</span>
        <Button size="sm" variant={current?.useful === true ? 'default' : 'outline'} className="h-7" disabled={save.isPending} onClick={() => send(true)}>
          <ThumbsUp className="w-3.5 h-3.5 mr-1" /> Sí
        </Button>
        <Button size="sm" variant={current?.useful === false ? 'default' : 'outline'} className="h-7" disabled={save.isPending}
          onClick={() => { setComment(current?.comment ?? ''); setWriting(true); }}>
          <ThumbsDown className="w-3.5 h-3.5 mr-1" /> No
        </Button>
      </div>
      {writing && (
        <div className="space-y-2">
          <Textarea rows={2} className="resize-none text-sm" value={comment} maxLength={1000} placeholder="¿Qué estuvo mal o qué faltó? (opcional)"
            onChange={event => setComment(event.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" className="h-7" disabled={save.isPending} onClick={() => send(false, comment)}>Enviar</Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setWriting(false)}>Cancelar</Button>
          </div>
        </div>
      )}
    </div>
  );
}
