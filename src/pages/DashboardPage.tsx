import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkshopMode } from '@/hooks/useWorkshopMode';
import { PageHeader } from '@/components/layout/PageHeader';
import { MetricCard } from '@/components/metrics';
import { ZoneMetrics } from '@/components/dashboard/ZoneMetrics';
import { MINUTES_SAVED_PER_CONVERSATION, VALUE_PER_HOUR_CLP } from '@/components/metrics/metricDefinitions';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart3 } from 'lucide-react';

const ZONE_LABELS: Record<string, string> = {
  santiago: 'Santiago',
  talca: 'Talca',
  puerto_montt: 'Puerto Montt',
};

function MetricSkeleton() {
  return (
    <div className="metric-card">
      <div className="flex items-start justify-between mb-3">
        <Skeleton className="w-10 h-10 rounded-xl" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-32" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { profile } = useAuth();

  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard-stats', profile?.workshop_id],
    queryFn: async () => {
      if (!profile?.workshop_id) return null;
      
      const [conversations, contacts, appointments, messagesOut, messagesIn, closedClients] = await Promise.all([
        supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('workshop_id', profile.workshop_id),
        supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('workshop_id', profile.workshop_id),
        supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('workshop_id', profile.workshop_id),
        supabase.from('messages').select('*', { count: 'exact', head: true }).eq('workshop_id', profile.workshop_id).eq('direction', 'outbound'),
        supabase.from('messages').select('*', { count: 'exact', head: true }).eq('workshop_id', profile.workshop_id).eq('direction', 'inbound'),
        supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('workshop_id', profile.workshop_id).not('closed_at', 'is', null),
      ]);
      
      const conversationCount = conversations.count || 0;
      const minutesSaved = conversationCount * MINUTES_SAVED_PER_CONVERSATION;
      const hoursSaved = minutesSaved / 60;
      const valueGenerated = Math.round(hoursSaved * VALUE_PER_HOUR_CLP);
      
      return {
        conversations: conversationCount,
        contacts: contacts.count || 0,
        appointments: appointments.count || 0,
        messagesOut: messagesOut.count || 0,
        messagesIn: messagesIn.count || 0,
        closedClients: closedClients.count || 0,
        hoursSaved,
        valueGenerated,
      };
    },
    enabled: !!profile?.workshop_id,
  });

  const workshopId = profile?.workshop_id;

  const conversionRate = stats?.conversations 
    ? Math.round((stats.appointments / stats.conversations) * 100) 
    : 0;

  // Handle users without a workshop (after all hooks)
  if (profile && !profile.workshop_id) {
    return (
      <div className="page-shell page-stack animate-in">
        <PageHeader title="Dashboard" description="Resumen de tu negocio" />
        <div className="empty-state">
          <BarChart3 className="empty-state-icon" />
          <h3 className="empty-state-title">Sin negocio asignado</h3>
          <p className="empty-state-description">
            Tu cuenta aún no está asociada a ningún negocio. Si fuiste invitado, revisa tu correo y usa el link de invitación. Si necesitas ayuda, contacta a tu administrador.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="page-shell page-stack animate-in">
        <PageHeader title="Dashboard" description="Resumen de tu negocio" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-6">
          {[...Array(4)].map((_, i) => <MetricSkeleton key={i} />)}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          {[...Array(4)].map((_, i) => <MetricSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="page-shell page-stack">
        <PageHeader title="Dashboard" description="Resumen de tu negocio" />
        <div className="empty-state">
          <BarChart3 className="empty-state-icon" />
          <h3 className="empty-state-title">Sin datos aún</h3>
          <p className="empty-state-description">
            Los datos aparecerán cuando comiences a recibir conversaciones
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell page-stack animate-in">
      <PageHeader title="Dashboard" description="Resumen de tu negocio" />
      
      {/* Section: Key Metrics */}
      <div>
        <div className="section-header">
          <h2 className="section-title">Métricas principales</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 md:gap-5">
          <MetricCard
            metricId="hours_saved"
            value={stats.hoursSaved}
            workshopId={workshopId}
            className="bg-gradient-to-br from-primary/5 via-transparent to-transparent"
          />
          <MetricCard
            metricId="value_generated"
            value={stats.valueGenerated}
            workshopId={workshopId}
            className="bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent"
          />
          <MetricCard
            metricId="conversations"
            value={stats.conversations}
            workshopId={workshopId}
          />
          <MetricCard
            metricId="clients"
            value={stats.contacts}
            workshopId={workshopId}
          />
          <MetricCard
            metricId="closed_clients"
            value={stats.closedClients}
            workshopId={workshopId}
            className="bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent"
          />
        </div>
      </div>

      {/* Section: Zone Metrics (SOC Ingenieria only) */}
      {workshopId && <ZoneMetrics workshopId={workshopId} />}

      {/* Section: Activity */}
      <div>
        <div className="section-header">
          <h2 className="section-title">Actividad</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
          <MetricCard
            metricId="bot_messages"
            value={stats.messagesOut}
            workshopId={workshopId}
          />
          <MetricCard
            metricId="messages_received"
            value={stats.messagesIn}
            workshopId={workshopId}
          />
          <MetricCard
            metricId="appointments"
            value={stats.appointments}
            workshopId={workshopId}
          />
          <MetricCard
            metricId="conversion_rate"
            value={conversionRate}
            workshopId={workshopId}
          />
        </div>
      </div>
    </div>
  );
}
