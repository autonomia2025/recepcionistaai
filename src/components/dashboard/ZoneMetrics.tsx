import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { MapPin } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MetricCard } from '@/components/metrics';
import { MINUTES_SAVED_PER_CONVERSATION, VALUE_PER_HOUR_CLP } from '@/components/metrics/metricDefinitions';

const SOC_WORKSHOP_ID = '610fb257-a649-4115-b944-21f31e7952db';

const ZONE_LABELS: Record<string, string> = {
  all: 'Total',
  talca: 'Talca',
  puerto_montt: 'Puerto Montt',
  santiago: 'Santiago',
};

const ZONE_TABS = ['all', 'talca', 'puerto_montt', 'santiago'];

interface ZoneMetricsProps {
  workshopId: string;
}

export function ZoneMetrics({ workshopId }: ZoneMetricsProps) {
  const isSOC = workshopId === SOC_WORKSHOP_ID;

  const { data, isLoading } = useQuery({
    queryKey: ['zone-metrics-full', workshopId],
    queryFn: async () => {
      const [contactsRes, conversationsRes, appointmentsRes, messagesOutRes, messagesInRes, closedRes] = await Promise.all([
        supabase.from('contacts').select('zone').eq('workshop_id', workshopId),
        supabase.from('conversations').select('id, contact_id, contacts(zone)').eq('workshop_id', workshopId),
        supabase.from('appointments').select('id, contact_id, contacts(zone)').eq('workshop_id', workshopId),
        supabase.from('messages').select('conversation_id, conversations(contact_id, contacts(zone))').eq('workshop_id', workshopId).eq('direction', 'outbound'),
        supabase.from('messages').select('conversation_id, conversations(contact_id, contacts(zone))').eq('workshop_id', workshopId).eq('direction', 'inbound'),
        supabase.from('contacts').select('zone').eq('workshop_id', workshopId).not('closed_at', 'is', null),
      ]);

      const zones = ['all', 'talca', 'puerto_montt', 'santiago'];

      const getZone = (item: any): string | null => {
        return item?.contacts?.zone || null;
      };

      const metrics: Record<string, {
        contacts: number;
        conversations: number;
        appointments: number;
        messagesOut: number;
        messagesIn: number;
        closedClients: number;
        hoursSaved: number;
        valueGenerated: number;
      }> = {};

      zones.forEach(zone => {
        const filterByZone = (items: any[] | null, getZ: (item: any) => string | null) => {
          if (!items) return 0;
          if (zone === 'all') return items.length;
          return items.filter(i => getZ(i) === zone).length;
        };

        const contacts = filterByZone(contactsRes.data, c => c.zone);
        const conversations = filterByZone(conversationsRes.data, getZone);
        const appointments = filterByZone(appointmentsRes.data, getZone);
        const messagesOut = filterByZone(messagesOutRes.data, i => i?.conversations?.contacts?.zone || null);
        const messagesIn = filterByZone(messagesInRes.data, i => i?.conversations?.contacts?.zone || null);
        const closedClients = filterByZone(closedRes.data, c => c.zone);

        const minutesSaved = conversations * MINUTES_SAVED_PER_CONVERSATION;
        const hoursSaved = minutesSaved / 60;
        const valueGenerated = Math.round(hoursSaved * VALUE_PER_HOUR_CLP);

        metrics[zone] = { contacts, conversations, appointments, messagesOut, messagesIn, closedClients, hoursSaved, valueGenerated };
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
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

      <Tabs defaultValue="all" className="w-full">
        <TabsList className="mb-4">
          {ZONE_TABS.map(zone => (
            <TabsTrigger key={zone} value={zone} className="gap-1.5">
              {zone !== 'all' && <MapPin className="w-3 h-3" />}
              {ZONE_LABELS[zone]}
            </TabsTrigger>
          ))}
        </TabsList>

        {ZONE_TABS.map(zone => {
          const m = data?.metrics[zone];
          if (!m) return null;

          const conversionRate = m.conversations > 0
            ? Math.round((m.appointments / m.conversations) * 100)
            : 0;

          return (
            <TabsContent key={zone} value={zone}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 md:gap-5 mb-4">
                <MetricCard
                  metricId="hours_saved"
                  value={m.hoursSaved}
                  workshopId={workshopId}
                  className="bg-gradient-to-br from-primary/5 via-transparent to-transparent"
                />
                <MetricCard
                  metricId="value_generated"
                  value={m.valueGenerated}
                  workshopId={workshopId}
                  className="bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent"
                />
                <MetricCard
                  metricId="conversations"
                  value={m.conversations}
                  workshopId={workshopId}
                />
                <MetricCard
                  metricId="clients"
                  value={m.contacts}
                  workshopId={workshopId}
                />
                <MetricCard
                  metricId="closed_clients"
                  value={m.closedClients}
                  workshopId={workshopId}
                  className="bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
                <MetricCard
                  metricId="bot_messages"
                  value={m.messagesOut}
                  workshopId={workshopId}
                />
                <MetricCard
                  metricId="messages_received"
                  value={m.messagesIn}
                  workshopId={workshopId}
                />
                <MetricCard
                  metricId="appointments"
                  value={m.appointments}
                  workshopId={workshopId}
                />
                <MetricCard
                  metricId="conversion_rate"
                  value={conversionRate}
                  workshopId={workshopId}
                />
              </div>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
