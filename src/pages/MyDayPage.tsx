import { useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { RequestDetailDialog } from '@/components/requests/RequestDetailDialog';
import { RequestFactList } from '@/components/commercial/RequestFactList';
import { useAuth } from '@/contexts/AuthContext';
import { useCommercialFacts } from '@/hooks/useCommercialFacts';
import { useServiceRequests } from '@/hooks/useServiceRequests';
import { useWorkshopFeatures } from '@/hooks/useWorkshopFeatures';
import { buildMyDay } from '@/lib/insights';
import { cn } from '@/lib/utils';

export default function MyDayPage() {
  const { profile } = useAuth();
  const { features, isLoading: featuresLoading } = useWorkshopFeatures();
  const { data: facts, isLoading, isFetching, error, refetch } = useCommercialFacts('me');
  const { data: requests = [] } = useServiceRequests();
  const [openId, setOpenId] = useState<string | null>(null);
  const sections = useMemo(() => (facts ? buildMyDay(facts) : []), [facts]);
  const selected = requests.find(r => r.id === openId) ?? null;
  const pending = sections.reduce((sum, s) => sum + s.items.length, 0);
  const late = sections.reduce((sum, s) => sum + s.items.filter(i => i.late).length, 0);
  const firstName = profile?.full_name?.split(' ')[0];

  if (!featuresLoading && !features.commercial) {
    return (
      <div className="p-6">
        <PageHeader title="Mi día" />
        <p className="text-muted-foreground">El módulo comercial no está activo para este negocio.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <PageHeader
        title={firstName ? `Hola, ${firstName}` : 'Mi día'}
        description={facts
          ? pending === 0
            ? 'No tienes pendientes. Buen trabajo.'
            : `Tienes ${pending} ${pending === 1 ? 'pendiente' : 'pendientes'}${late ? `, ${late} ${late === 1 ? 'atrasado' : 'atrasados'}` : ''}. Empieza por los marcados en rojo.`
          : 'Tus pendientes de hoy.'}
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn('w-4 h-4 mr-1', isFetching && 'animate-spin')} /> Actualizar
          </Button>
        }
      />

      {isLoading ? (
        <p className="text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</p>
      ) : error ? (
        <p className="text-destructive">No se pudieron cargar tus pendientes: {error instanceof Error ? error.message : ''}</p>
      ) : (
        sections.map(section => (
          <section key={section.key} className="space-y-2">
            <h2 className="text-base font-semibold">
              {section.title}
              <span className="ml-2 text-sm font-normal text-muted-foreground">{section.items.length}</span>
            </h2>
            {section.items.length === 0
              ? <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-4">{section.empty}</p>
              : <RequestFactList items={section.items} onOpen={setOpenId} showStaff={false} />}
          </section>
        ))
      )}

      {selected && (
        <RequestDetailDialog request={selected} open={!!selected} onOpenChange={open => !open && setOpenId(null)} />
      )}
    </div>
  );
}
