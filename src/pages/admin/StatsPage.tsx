import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { SuperAdminIntentMetrics } from '@/components/admin/SuperAdminIntentMetrics';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricCard } from '@/components/metrics';
import {
  MINUTES_SAVED_PER_CONVERSATION,
  COST_PER_WHATSAPP_MESSAGE,
  COST_PER_AI_CALL,
  LABOR_COST_PER_HOUR_USD
} from '@/components/metrics/metricDefinitions';
import { useAllWorkshopBilling } from '@/hooks/admin/useWorkshopBilling';

interface UsageStats {
  total_messages_sent: number;
  total_messages_received: number;
  total_ai_calls: number;
  total_conversations: number;
  total_auto_resolved: number;
  total_whatsapp_cost: number;
  total_ai_cost: number;
  total_minutes_saved: number;
}

interface WorkshopUsage {
  workshop_id: string;
  workshop_name: string;
  whatsapp_provider: string;
  messages_sent: number;
  messages_received: number;
  ai_calls: number;
  conversations: number;
  cost_usd: number;
  minutes_saved: number;
}

export default function StatsPage() {
  // Fetch billing data for MRR
  const { data: allBilling } = useAllWorkshopBilling();

  // Fetch aggregated stats from messages, conversations, etc.
  const { data: liveStats, isLoading: loadingLive } = useQuery({
    queryKey: ['admin-live-stats'],
    queryFn: async () => {
      // Get message counts
      const { data: messages, error: msgError } = await supabase
        .from('messages')
        .select('direction, workshop_id');

      if (msgError) throw msgError;

      // Get conversations
      const { data: conversations, error: convError } = await supabase
        .from('conversations')
        .select('id, status, workshop_id');

      if (convError) throw convError;

      // Get workshops with provider info
      const { data: workshops, error: wsError } = await supabase
        .from('workshops')
        .select('id, name, is_active, whatsapp_provider');

      if (wsError) throw wsError;

      const inbound = messages?.filter(m => m.direction === 'inbound').length || 0;
      const outbound = messages?.filter(m => m.direction === 'outbound').length || 0;
      const totalConversations = conversations?.length || 0;
      const autoResolved = conversations?.filter(c => c.status === 'booked' || c.status === 'closed').length || 0;

      // Estimate AI calls as outbound messages (each outbound = 1 AI call when bot enabled)
      const aiCalls = outbound;

      // Count Twilio messages for cost calculation
      const twilioWorkshopIds = new Set(workshops?.filter(w => w.whatsapp_provider === 'twilio').map(w => w.id) || []);
      const twilioInbound = messages?.filter(m => m.direction === 'inbound' && twilioWorkshopIds.has(m.workshop_id)).length || 0;
      const twilioOutbound = messages?.filter(m => m.direction === 'outbound' && twilioWorkshopIds.has(m.workshop_id)).length || 0;
      const metaOutbound = outbound - twilioOutbound;

      // Calculate costs:
      // - Twilio: $0.005 per message (inbound + outbound)
      // - Meta: Only outbound (24h conversation window is free)
      const whatsappCost = ((twilioInbound + twilioOutbound) + metaOutbound) * COST_PER_WHATSAPP_MESSAGE;
      const aiCost = aiCalls * COST_PER_AI_CALL;

      // Calculate time saved
      const minutesSaved = totalConversations * MINUTES_SAVED_PER_CONVERSATION;

      // Group by workshop
      const workshopStats: Record<string, WorkshopUsage> = {};

      workshops?.forEach(ws => {
        workshopStats[ws.id] = {
          workshop_id: ws.id,
          workshop_name: ws.name,
          whatsapp_provider: ws.whatsapp_provider || 'meta',
          messages_sent: 0,
          messages_received: 0,
          ai_calls: 0,
          conversations: 0,
          cost_usd: 0,
          minutes_saved: 0,
        };
      });

      messages?.forEach(m => {
        if (workshopStats[m.workshop_id]) {
          if (m.direction === 'inbound') {
            workshopStats[m.workshop_id].messages_received++;
          } else {
            workshopStats[m.workshop_id].messages_sent++;
            workshopStats[m.workshop_id].ai_calls++;
          }
        }
      });

      conversations?.forEach(c => {
        if (workshopStats[c.workshop_id]) {
          workshopStats[c.workshop_id].conversations++;
        }
      });

      // Calculate costs per workshop based on provider
      // Twilio: $0.005 per message (inbound + outbound)
      // Meta: Only outbound (24h window is free for inbound replies)
      Object.values(workshopStats).forEach(ws => {
        const whatsappMessages = ws.whatsapp_provider === 'twilio'
          ? ws.messages_sent + ws.messages_received // Twilio charges both
          : ws.messages_sent; // Meta only charges outbound
        ws.cost_usd = (whatsappMessages * COST_PER_WHATSAPP_MESSAGE) + (ws.ai_calls * COST_PER_AI_CALL);
        ws.minutes_saved = ws.conversations * MINUTES_SAVED_PER_CONVERSATION;
      });

      return {
        totals: {
          total_messages_sent: outbound,
          total_messages_received: inbound,
          total_ai_calls: aiCalls,
          total_conversations: totalConversations,
          total_auto_resolved: autoResolved,
          total_whatsapp_cost: whatsappCost,
          total_ai_cost: aiCost,
          total_minutes_saved: minutesSaved,
        } as UsageStats,
        workshops: Object.values(workshopStats).sort((a, b) => b.conversations - a.conversations),
        workshopCount: workshops?.length || 0,
        activeWorkshops: workshops?.filter(w => w.is_active).length || 0,
      };
    },
  });

  const formatCurrencyUSD = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const formatCurrencyCLP = (amount: number) => {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatHours = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return `${mins} min`;
    return `${hours}h ${mins}m`;
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('es-CL').format(num);
  };

  // Calculate MRR from billing data
  const mrr = allBilling?.reduce((sum, b) => {
    return sum + (b.monthly_fee_clp || 0);
  }, 0) || 0;

  const activeClients = liveStats?.activeWorkshops || 0;

  if (loadingLive) {
    return (
      <div className="page-shell page-stack">
        <PageHeader
          title="Estadísticas"
          description="Métricas de uso y rendimiento de la plataforma"
        />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mt-6">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4">
                <div className="h-16 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const stats = liveStats?.totals;
  const totalCost = (stats?.total_whatsapp_cost || 0) + (stats?.total_ai_cost || 0);
  const hoursSaved = Math.floor((stats?.total_minutes_saved || 0) / 60);

  // Value calculation: Chilean minimum wage ~$500k CLP/month = ~$3.5/hour
  const valueSaved = hoursSaved * LABOR_COST_PER_HOUR_USD;
  const roi = totalCost > 0 ? ((valueSaved - totalCost) / totalCost) * 100 : 0;

  return (
    <div className="page-shell page-stack">
      <PageHeader
        title="Estadísticas"
        description="Métricas de uso, costos y valor generado por la plataforma"
      />

      {/* Financial Summary - with MetricCards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard
          metricId="active_clients"
          value={activeClients}
          isAdmin
        />
        <MetricCard
          metricId="mrr"
          value={mrr}
          isAdmin
        />
        <MetricCard
          metricId="hours_saved"
          value={hoursSaved}
          isAdmin
        />
        <MetricCard
          metricId="roi"
          value={roi}
          isAdmin
        />
      </div>

      {/* Value & Cost Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          metricId="value_generated_usd"
          value={valueSaved}
          isAdmin
          subtitle={`A $${LABOR_COST_PER_HOUR_USD}/hora de trabajo`}
        />
        <MetricCard
          metricId="operational_cost"
          value={totalCost}
          isAdmin
          subtitle="WhatsApp + AI"
        />
        <MetricCard
          metricId="net_profit"
          value={valueSaved - totalCost}
          isAdmin
          subtitle="Valor - Costos"
        />
      </div>

      {/* Intent Analysis */}
      <SuperAdminIntentMetrics />

      {/* Activity Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard
          metricId="conversations"
          value={stats?.total_conversations || 0}
          isAdmin
          subtitle={`${formatNumber(stats?.total_auto_resolved || 0)} auto-resueltas`}
        />
        <MetricCard
          metricId="messages_received"
          value={stats?.total_messages_received || 0}
          isAdmin
          subtitle="De clientes"
        />
        <MetricCard
          metricId="bot_messages"
          value={stats?.total_messages_sent || 0}
          isAdmin
          subtitle="Respuestas bot"
        />
        <MetricCard
          metricId="ai_calls"
          value={stats?.total_ai_calls || 0}
          isAdmin
          subtitle="Invocaciones"
        />
      </div>

      {/* Workshops breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Uso por Cliente</CardTitle>
          <CardDescription>
            Desglose de actividad y costos ({liveStats?.activeWorkshops}/{liveStats?.workshopCount} activos)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {liveStats?.workshops && liveStats.workshops.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 font-medium text-muted-foreground">Cliente</th>
                    <th className="pb-3 font-medium text-muted-foreground">Conversaciones</th>
                    <th className="pb-3 font-medium text-muted-foreground">Recibidos</th>
                    <th className="pb-3 font-medium text-muted-foreground">Enviados</th>
                    <th className="pb-3 font-medium text-muted-foreground">Tiempo Ahorrado</th>
                    <th className="pb-3 font-medium text-muted-foreground">Costo</th>
                  </tr>
                </thead>
                <tbody>
                  {liveStats.workshops.map((ws) => (
                    <tr key={ws.workshop_id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="py-4 font-medium">{ws.workshop_name}</td>
                      <td className="py-4">{formatNumber(ws.conversations)}</td>
                      <td className="py-4">{formatNumber(ws.messages_received)}</td>
                      <td className="py-4">{formatNumber(ws.messages_sent)}</td>
                      <td className="py-4">{formatHours(ws.minutes_saved)}</td>
                      <td className="py-4">{formatCurrencyUSD(ws.cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No hay datos de uso todavía
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cost breakdown */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Costos WhatsApp</CardTitle>
            <CardDescription>
              Costo estimado por mensajes vía WhatsApp Business API
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Mensajes enviados</span>
              <span className="font-medium">{formatNumber(stats?.total_messages_sent || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Costo por mensaje</span>
              <span className="font-medium">{formatCurrencyUSD(COST_PER_WHATSAPP_MESSAGE)}</span>
            </div>
            <div className="border-t pt-4 flex justify-between">
              <span className="font-medium">Total WhatsApp</span>
              <span className="font-bold text-lg">{formatCurrencyUSD(stats?.total_whatsapp_cost || 0)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Costos AI</CardTitle>
            <CardDescription>
              Costo estimado por llamadas a inteligencia artificial
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Llamadas AI</span>
              <span className="font-medium">{formatNumber(stats?.total_ai_calls || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Costo por llamada</span>
              <span className="font-medium">{formatCurrencyUSD(COST_PER_AI_CALL)}</span>
            </div>
            <div className="border-t pt-4 flex justify-between">
              <span className="font-medium">Total AI</span>
              <span className="font-bold text-lg">{formatCurrencyUSD(stats?.total_ai_cost || 0)}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
