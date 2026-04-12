import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { MapPin } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

const SOC_WORKSHOP_ID = '610fb257-a649-4115-b944-21f31e7952db';

const ZONE_LABELS: Record<string, string> = {
  talca: 'Talca',
  puerto_montt: 'Puerto Montt',
  santiago: 'Santiago',
};

const ZONE_COLORS: Record<string, string> = {
  talca: 'bg-blue-500/10 text-blue-600 border-blue-200',
  puerto_montt: 'bg-emerald-500/10 text-emerald-600 border-emerald-200',
  santiago: 'bg-violet-500/10 text-violet-600 border-violet-200',
};

interface ZoneMetricsProps {
  workshopId: string;
}

export function ZoneMetrics({ workshopId }: ZoneMetricsProps) {
  const isSOC = workshopId === SOC_WORKSHOP_ID;

  const { data, isLoading } = useQuery({
    queryKey: ['zone-metrics', workshopId],
    queryFn: async () => {
      const [contactsRes, conversationsRes, appointmentsRes] = await Promise.all([
        supabase.from('contacts').select('zone').eq('workshop_id', workshopId),
        supabase.from('conversations').select('id, contact_id, contacts(zone)').eq('workshop_id', workshopId),
        supabase.from('appointments').select('id, contact_id, contacts(zone)').eq('workshop_id', workshopId),
      ]);

      const zones = ['talca', 'puerto_montt', 'santiago'];
      const metrics = zones.map(zone => {
        const contacts = contactsRes.data?.filter(c => c.zone === zone).length || 0;
        const conversations = conversationsRes.data?.filter(c => (c.contacts as any)?.zone === zone).length || 0;
        const appointments = appointmentsRes.data?.filter(a => (a.contacts as any)?.zone === zone).length || 0;
        const sinZona = zone === 'talca' ? 0 : 0; // placeholder
        return { zone, contacts, conversations, appointments };
      });

      const sinZona = contactsRes.data?.filter(c => !c.zone).length || 0;

      return { metrics, sinZona };
    },
    enabled: isSOC,
  });

  if (!isSOC) return null;

  if (isLoading) {
    return (
      <div>
        <div className="section-header">
          <h2 className="section-title flex items-center gap-2">
            <MapPin className="w-4 h-4" />
            Métricas por Zona
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="metric-card">
              <Skeleton className="h-6 w-24 mb-3" />
              <Skeleton className="h-8 w-16 mb-2" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title flex items-center gap-2">
          <MapPin className="w-4 h-4" />
          Métricas por Zona
        </h2>
        {data?.sinZona ? (
          <span className="text-xs text-muted-foreground">{data.sinZona} contactos sin zona asignada</span>
        ) : null}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {data?.metrics.map(m => (
          <div key={m.zone} className={`metric-card border ${ZONE_COLORS[m.zone]}`}>
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="w-4 h-4" />
              <span className="font-semibold text-sm">{ZONE_LABELS[m.zone]}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-2xl font-bold">{m.contacts}</p>
                <p className="text-xs text-muted-foreground">Contactos</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{m.conversations}</p>
                <p className="text-xs text-muted-foreground">Conversaciones</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{m.appointments}</p>
                <p className="text-xs text-muted-foreground">Citas</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
