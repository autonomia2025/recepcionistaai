import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  RefreshCw, 
  MessageSquare, 
  Bot, 
  XCircle, 
  AlertTriangle,
  Clock,
  Globe,
  ChevronDown,
  ChevronRight,
  Shield,
  CheckCircle2
} from "lucide-react";
import { format, subHours, subDays } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

type TimeRange = '1h' | '24h' | '7d' | '30d';

interface WebChatLog {
  id: string;
  workshop_id: string;
  session_id: string;
  event_type: string;
  origin: string | null;
  message_preview: string | null;
  bot_reply_preview: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface Workshop {
  id: string;
  name: string;
}

const EVENT_TYPE_CONFIG: Record<string, { label: string; icon: typeof MessageSquare; color: string }> = {
  message_received: { label: 'Mensaje', icon: MessageSquare, color: 'bg-primary' },
  bot_replied: { label: 'Bot respondió', icon: Bot, color: 'bg-emerald-600' },
  origin_rejected: { label: 'Origen rechazado', icon: XCircle, color: 'bg-destructive' },
  rate_limited: { label: 'Rate limit', icon: Clock, color: 'bg-amber-600' },
  error: { label: 'Error', icon: AlertTriangle, color: 'bg-destructive' },
  bot_disabled: { label: 'Bot desactivado', icon: Bot, color: 'bg-muted-foreground' },
};

export default function WebChatLogsPage() {
  const [selectedWorkshop, setSelectedWorkshop] = useState<string>('all');
  const [selectedEventType, setSelectedEventType] = useState<string>('all');
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());

  // Fetch workshops
  const { data: workshops = [] } = useQuery({
    queryKey: ['workshops-for-logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workshops')
        .select('id, name')
        .eq('web_chat_enabled', true)
        .order('name');
      if (error) throw error;
      return data as Workshop[];
    },
  });

  // Calculate time filter
  const timeFilter = useMemo(() => {
    const now = new Date();
    switch (timeRange) {
      case '1h': return subHours(now, 1);
      case '24h': return subHours(now, 24);
      case '7d': return subDays(now, 7);
      case '30d': return subDays(now, 30);
      default: return subHours(now, 24);
    }
  }, [timeRange]);

  // Fetch logs
  const { data: logs = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['web-chat-logs', selectedWorkshop, selectedEventType, timeRange],
    queryFn: async () => {
      let query = supabase
        .from('web_chat_logs')
        .select('*')
        .gte('created_at', timeFilter.toISOString())
        .order('created_at', { ascending: false })
        .limit(500);

      if (selectedWorkshop !== 'all') {
        query = query.eq('workshop_id', selectedWorkshop);
      }

      if (selectedEventType !== 'all') {
        query = query.eq('event_type', selectedEventType);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as WebChatLog[];
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Calculate stats
  const stats = useMemo(() => {
    const received = logs.filter(l => l.event_type === 'message_received').length;
    const replied = logs.filter(l => l.event_type === 'bot_replied').length;
    const rejected = logs.filter(l => l.event_type === 'origin_rejected').length;
    const errors = logs.filter(l => l.event_type === 'error').length;
    const rateLimited = logs.filter(l => l.event_type === 'rate_limited').length;
    return { received, replied, rejected, errors, rateLimited };
  }, [logs]);

  // Group logs by session
  const sessionGroups = useMemo(() => {
    const groups = new Map<string, { logs: WebChatLog[]; workshop_id: string; workshop_name: string }>();
    
    logs.forEach(log => {
      const key = `${log.workshop_id}-${log.session_id}`;
      if (!groups.has(key)) {
        const workshopName = (log.metadata?.workshop_name as string) || 
          workshops.find(w => w.id === log.workshop_id)?.name || 
          'Desconocido';
        groups.set(key, { 
          logs: [], 
          workshop_id: log.workshop_id,
          workshop_name: workshopName
        });
      }
      groups.get(key)!.logs.push(log);
    });

    return Array.from(groups.entries()).map(([key, value]) => ({
      key,
      session_id: value.logs[0].session_id,
      ...value,
      first_event: value.logs[value.logs.length - 1].created_at,
      last_event: value.logs[0].created_at,
      has_errors: value.logs.some(l => ['error', 'origin_rejected'].includes(l.event_type)),
    })).sort((a, b) => new Date(b.last_event).getTime() - new Date(a.last_event).getTime());
  }, [logs, workshops]);

  const toggleSession = (key: string) => {
    setExpandedSessions(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const getEventConfig = (eventType: string) => {
    return EVENT_TYPE_CONFIG[eventType] || { 
      label: eventType, 
      icon: AlertTriangle, 
      color: 'bg-muted' 
    };
  };

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Web Chat Logs" 
        description="Monitor de interacciones del chat web por workshop"
      />

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 items-center">
            <Select value={selectedWorkshop} onValueChange={setSelectedWorkshop}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Workshop" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los workshops</SelectItem>
                {workshops.map(w => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedEventType} onValueChange={setSelectedEventType}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Tipo de evento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los eventos</SelectItem>
                {Object.entries(EVENT_TYPE_CONFIG).map(([key, config]) => (
                  <SelectItem key={key} value={key}>{config.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">Última hora</SelectItem>
                <SelectItem value="24h">Últimas 24h</SelectItem>
                <SelectItem value="7d">Últimos 7 días</SelectItem>
                <SelectItem value="30d">Últimos 30 días</SelectItem>
              </SelectContent>
            </Select>

            <Button 
              variant="outline" 
              size="icon"
              onClick={() => refetch()}
              disabled={isRefetching}
            >
              <RefreshCw className={cn("h-4 w-4", isRefetching && "animate-spin")} />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <MessageSquare className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.received}</p>
                <p className="text-xs text-muted-foreground">Mensajes</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-500/10 rounded-lg">
                <Bot className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.replied}</p>
                <p className="text-xs text-muted-foreground">Respuestas</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-destructive/10 rounded-lg">
                <XCircle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.rejected}</p>
                <p className="text-xs text-muted-foreground">Rechazados</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/10 rounded-lg">
                <Clock className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.rateLimited}</p>
                <p className="text-xs text-muted-foreground">Rate Limit</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-destructive/10 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.errors}</p>
                <p className="text-xs text-muted-foreground">Errores</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sessions List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Sesiones ({sessionGroups.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : sessionGroups.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No hay logs en el período seleccionado</p>
            </div>
          ) : (
            <ScrollArea className="h-[600px]">
              <div className="space-y-2">
                {sessionGroups.map(session => (
                  <div key={session.key} className="border rounded-lg overflow-hidden">
                    {/* Session Header */}
                    <button
                      onClick={() => toggleSession(session.key)}
                      className={cn(
                        "w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors text-left",
                        session.has_errors && "bg-destructive/5 hover:bg-destructive/10"
                      )}
                    >
                      {expandedSessions.has(session.key) ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{session.workshop_name}</span>
                          <Badge variant="outline" className="font-mono text-xs">
                            {session.session_id.slice(0, 8)}...
                          </Badge>
                          {session.has_errors && (
                            <Badge variant="destructive" className="text-xs">
                              Error
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {session.logs.length} eventos • 
                          {' '}{format(new Date(session.last_event), 'dd/MM HH:mm', { locale: es })}
                        </p>
                      </div>

                      <div className="flex items-center gap-1">
                        {session.logs.some(l => l.event_type === 'bot_replied') && (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        )}
                        {session.logs.some(l => l.event_type === 'origin_rejected') && (
                          <Shield className="h-4 w-4 text-destructive" />
                        )}
                      </div>
                    </button>

                    {/* Session Details */}
                    {expandedSessions.has(session.key) && (
                      <div className="border-t bg-muted/20 p-3 space-y-3">
                        {/* Session Info */}
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="text-muted-foreground">Workshop ID</p>
                            <p className="font-mono text-xs">{session.workshop_id}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Session ID</p>
                            <p className="font-mono text-xs">{session.session_id}</p>
                          </div>
                        </div>

                        {/* Origin Check */}
                        {session.logs[0]?.origin && (
                          <div className="bg-background p-2 rounded border">
                            <p className="text-xs text-muted-foreground">Origen</p>
                            <p className="font-mono text-sm">{session.logs[0].origin}</p>
                            {session.logs.some(l => l.event_type === 'origin_rejected') && (
                              <div className="mt-2 p-2 bg-destructive/10 rounded text-xs text-destructive">
                                <strong>⚠️ Origen rechazado:</strong> Verificar dominios permitidos en configuración
                                {session.logs.find(l => l.event_type === 'origin_rejected')?.metadata?.allowed_domains && (
                                  <p className="mt-1 font-mono">
                                    Permitidos: {JSON.stringify(
                                      session.logs.find(l => l.event_type === 'origin_rejected')?.metadata?.allowed_domains
                                    )}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Event Timeline */}
                        <div className="space-y-2">
                          <p className="text-sm font-medium">Timeline de eventos</p>
                          {[...session.logs].reverse().map(log => {
                            const config = getEventConfig(log.event_type);
                            const Icon = config.icon;
                            return (
                              <div key={log.id} className="flex gap-3 text-sm">
                                <div className="flex-shrink-0 mt-0.5">
                                  <div className={cn("p-1 rounded", config.color)}>
                                    <Icon className="h-3 w-3 text-primary-foreground" />
                                  </div>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">{config.label}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {format(new Date(log.created_at), 'HH:mm:ss')}
                                    </span>
                                  </div>
                                  {log.message_preview && (
                                    <p className="text-muted-foreground truncate">
                                      📩 {log.message_preview}
                                    </p>
                                  )}
                                  {log.bot_reply_preview && (
                                    <p className="text-emerald-700 dark:text-emerald-400 truncate">
                                      🤖 {log.bot_reply_preview}
                                    </p>
                                  )}
                                  {log.metadata && Object.keys(log.metadata).length > 0 && (
                                    <details className="mt-1">
                                      <summary className="text-xs text-muted-foreground cursor-pointer">
                                        Ver metadata
                                      </summary>
                                      <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto">
                                        {JSON.stringify(log.metadata, null, 2)}
                                      </pre>
                                    </details>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
