import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Activity, CheckCircle2, AlertTriangle, XCircle,
  Mail, MessageSquare, Clock
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

interface HealthStatusCardProps {
  workshopId: string;
}

export function HealthStatusCard({ workshopId }: HealthStatusCardProps) {
  const { data: health, isLoading } = useQuery({
    queryKey: ['workshop-health', workshopId],
    queryFn: async () => {
      // Workshop info
      const { data: workshop } = await supabase
        .from('workshops')
        .select('gmail_connected, whatsapp_connected, email_reminders_enabled')
        .eq('id', workshopId)
        .single();
      
      // Último mensaje recibido
      const { data: lastMessage } = await supabase
        .from('messages')
        .select('created_at')
        .eq('workshop_id', workshopId)
        .eq('direction', 'inbound')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      // Errores últimas 24h
      const { count: errorCount } = await supabase
        .from('health_logs')
        .select('*', { count: 'exact', head: true })
        .eq('workshop_id', workshopId)
        .eq('event_type', 'error')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
      
      // Calcular estado general
      const hoursInactive = lastMessage?.created_at 
        ? (Date.now() - new Date(lastMessage.created_at).getTime()) / (1000 * 60 * 60)
        : 0;
      
      let status: 'healthy' | 'warning' | 'critical' = 'healthy';
      let statusMessage = 'Todo funcionando correctamente';
      
      if ((errorCount || 0) >= 5) {
        status = 'critical';
        statusMessage = `${errorCount} errores en las últimas 24h`;
      } else if (workshop?.email_reminders_enabled && !workshop?.gmail_connected) {
        status = 'warning';
        statusMessage = 'Recordatorios activos pero Gmail desconectado';
      } else if (hoursInactive > 12 && lastMessage) {
        status = 'warning';
        statusMessage = 'Sin actividad en más de 12 horas';
      }
      
      return {
        gmailConnected: workshop?.gmail_connected || false,
        whatsappConnected: workshop?.whatsapp_connected || false,
        remindersEnabled: workshop?.email_reminders_enabled || false,
        lastEvent: lastMessage?.created_at || null,
        errorsCount: errorCount || 0,
        status,
        statusMessage,
      };
    },
    enabled: !!workshopId,
    refetchInterval: 300000, // Cada 5 minutos
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!health) return null;

  const statusConfig = {
    healthy: { 
      icon: CheckCircle2, 
      label: 'OK', 
      color: 'text-emerald-600',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/20'
    },
    warning: { 
      icon: AlertTriangle, 
      label: 'Alerta', 
      color: 'text-amber-600',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20'
    },
    critical: { 
      icon: XCircle, 
      label: 'Problema', 
      color: 'text-red-600',
      bg: 'bg-red-500/10',
      border: 'border-red-500/20'
    },
  };

  const config = statusConfig[health.status];
  const StatusIcon = config.icon;

  return (
    <Card className={`${config.bg} ${config.border} border`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Activity className="w-4 h-4" />
          Estado del Sistema
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status principal */}
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-full ${config.bg}`}>
            <StatusIcon className={`w-5 h-5 ${config.color}`} />
          </div>
          <div>
            <p className={`font-semibold ${config.color}`}>{config.label}</p>
            <p className="text-xs text-muted-foreground">{health.statusMessage}</p>
          </div>
        </div>

        {/* Indicadores */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <Mail className={`w-4 h-4 ${health.gmailConnected ? 'text-emerald-500' : 'text-muted-foreground'}`} />
            <span className="text-muted-foreground">Gmail</span>
            {health.gmailConnected ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-500 ml-auto" />
            ) : (
              <XCircle className="w-3 h-3 text-muted-foreground ml-auto" />
            )}
          </div>
          <div className="flex items-center gap-2">
            <MessageSquare className={`w-4 h-4 ${health.whatsappConnected ? 'text-emerald-500' : 'text-muted-foreground'}`} />
            <span className="text-muted-foreground">WhatsApp</span>
            {health.whatsappConnected ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-500 ml-auto" />
            ) : (
              <XCircle className="w-3 h-3 text-muted-foreground ml-auto" />
            )}
          </div>
        </div>

        {/* Último evento */}
        {health.lastEvent && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t">
            <Clock className="w-3 h-3" />
            <span>Último mensaje: {formatDistanceToNow(new Date(health.lastEvent), { addSuffix: true, locale: es })}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}