import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Activity, AlertTriangle, CheckCircle2, XCircle,
  Mail, MessageSquare, Bot, Clock, Wifi, WifiOff,
  RefreshCw, ChevronDown, ChevronUp, ExternalLink, Eye
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface WorkshopHealth {
  id: string;
  name: string;
  gmail_connected: boolean;
  gmail_email: string | null;
  whatsapp_connected: boolean;
  web_chat_enabled: boolean;
  bot_enabled: boolean;
  email_reminders_enabled: boolean;
  last_inbound: string | null;
  last_outbound: string | null;
  errors_24h: number;
  bot_paused_count: number;
  overall_status: 'healthy' | 'warning' | 'critical';
}

interface ConversationPreview {
  id: string;
  contact_name: string;
  last_inbound: string | null;
  last_outbound: string | null;
  last_message_at: string | null;
  status: string;
}

function StatusBadge({ status }: { status: 'healthy' | 'warning' | 'critical' }) {
  const config = {
    healthy: { label: 'OK', className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
    warning: { label: 'Alerta', className: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
    critical: { label: 'Crítico', className: 'bg-red-500/10 text-red-600 border-red-500/20' },
  };

  const { label, className } = config[status];

  return (
    <Badge variant="outline" className={className}>
      {status === 'healthy' && <CheckCircle2 className="w-3 h-3 mr-1" />}
      {status === 'warning' && <AlertTriangle className="w-3 h-3 mr-1" />}
      {status === 'critical' && <XCircle className="w-3 h-3 mr-1" />}
      {label}
    </Badge>
  );
}

function ConnectionIndicator({ connected, label }: { connected: boolean; label: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <div className={`flex items-center gap-1 text-xs ${connected ? 'text-emerald-600' : 'text-muted-foreground'}`}>
            {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{label}: {connected ? 'Conectado' : 'Desconectado'}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function TimeAgo({ date }: { date: string | null }) {
  if (!date) return <span className="text-muted-foreground text-xs">-</span>;

  const d = new Date(date);
  const hoursAgo = (Date.now() - d.getTime()) / (1000 * 60 * 60);
  const isStale = hoursAgo > 12;

  return (
    <span className={`text-xs ${isStale ? 'text-amber-600 font-medium' : 'text-muted-foreground'}`}>
      {formatDistanceToNow(d, { addSuffix: true, locale: es })}
    </span>
  );
}

function ConversationMiniLog({ workshopId }: { workshopId: string }) {
  const { data: conversations, isLoading } = useQuery({
    queryKey: ['health-conversations', workshopId],
    queryFn: async () => {
      // Get last 5 conversations with their latest messages
      const { data: convs, error } = await supabase
        .from('conversations')
        .select(`
          id,
          status,
          last_message_at,
          contacts!inner(name)
        `)
        .eq('workshop_id', workshopId)
        .order('last_message_at', { ascending: false })
        .limit(5);

      if (error) throw error;

      // For each conversation, get last inbound and outbound messages
      const results: ConversationPreview[] = await Promise.all(
        (convs || []).map(async (conv) => {
          const { data: lastIn } = await supabase
            .from('messages')
            .select('text')
            .eq('conversation_id', conv.id)
            .eq('direction', 'inbound')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          const { data: lastOut } = await supabase
            .from('messages')
            .select('text')
            .eq('conversation_id', conv.id)
            .eq('direction', 'outbound')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          return {
            id: conv.id,
            contact_name: (conv.contacts as any)?.name || 'Sin nombre',
            last_inbound: lastIn?.text || null,
            last_outbound: lastOut?.text || null,
            last_message_at: conv.last_message_at,
            status: conv.status,
          };
        })
      );

      return results;
    },
    enabled: !!workshopId,
  });

  const { setImpersonatedWorkshopId } = useAuth();
  const navigate = useNavigate();

  const handleGoToInbox = () => {
    setImpersonatedWorkshopId(workshopId);
    navigate('/inbox');
  };

  if (isLoading) {
    return (
      <div className="space-y-2 p-3">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (!conversations || conversations.length === 0) {
    return (
      <div className="p-3 text-center text-muted-foreground text-sm">
        Sin conversaciones recientes
      </div>
    );
  }

  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center justify-between px-1 mb-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Últimas Conversaciones</h4>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[10px] gap-1.5 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
          onClick={handleGoToInbox}
        >
          <Eye className="w-3 h-3" />
          Ver Inbox Completo
        </Button>
      </div>
      {conversations.map((conv) => (
        <div key={conv.id} className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{conv.contact_name}</span>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {conv.status}
              </Badge>
              {conv.last_message_at && (
                <span className="text-[10px] text-muted-foreground">
                  {format(new Date(conv.last_message_at), "dd/MM HH:mm")}
                </span>
              )}
            </div>
          </div>
          {conv.last_inbound && (
            <div className="text-xs">
              <span className="text-muted-foreground">👤 Cliente: </span>
              <span className="text-foreground">{conv.last_inbound.substring(0, 120)}{conv.last_inbound.length > 120 ? '…' : ''}</span>
            </div>
          )}
          {conv.last_outbound && (
            <div className="text-xs">
              <span className="text-muted-foreground">🤖 Bot: </span>
              <span className="text-foreground">{conv.last_outbound.substring(0, 120)}{conv.last_outbound.length > 120 ? '…' : ''}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function HealthCheckPage() {
  const [expandedWorkshop, setExpandedWorkshop] = useState<string | null>(null);

  const { data: workshops, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['health-check-workshops'],
    queryFn: async () => {
      const { data: workshopsData, error: workshopsError } = await supabase
        .from('workshops')
        .select(`
          id, name, 
          gmail_connected, gmail_email,
          whatsapp_connected, 
          web_chat_enabled, 
          bot_enabled,
          email_reminders_enabled
        `)
        .eq('is_active', true)
        .order('name');

      if (workshopsError) throw workshopsError;

      const healthPromises = (workshopsData || []).map(async (w) => {
        const { data: lastIn } = await supabase
          .from('messages')
          .select('created_at')
          .eq('workshop_id', w.id)
          .eq('direction', 'inbound')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const { data: lastOut } = await supabase
          .from('messages')
          .select('created_at')
          .eq('workshop_id', w.id)
          .eq('direction', 'outbound')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const { count: errorCount } = await supabase
          .from('health_logs')
          .select('*', { count: 'exact', head: true })
          .eq('workshop_id', w.id)
          .eq('event_type', 'error')
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

        const { count: pausedCount } = await supabase
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('workshop_id', w.id)
          .eq('bot_paused', true);

        const hoursInactive = lastIn?.created_at
          ? (Date.now() - new Date(lastIn.created_at).getTime()) / (1000 * 60 * 60)
          : 999;

        let overall_status: 'healthy' | 'warning' | 'critical' = 'healthy';
        if ((errorCount || 0) >= 5) overall_status = 'critical';
        else if (hoursInactive > 12 && hoursInactive < 999) overall_status = 'warning';
        else if (w.email_reminders_enabled && !w.gmail_connected) overall_status = 'warning';

        return {
          ...w,
          last_inbound: lastIn?.created_at || null,
          last_outbound: lastOut?.created_at || null,
          errors_24h: errorCount || 0,
          bot_paused_count: pausedCount || 0,
          overall_status,
        } as WorkshopHealth;
      });

      return Promise.all(healthPromises);
    },
    refetchInterval: 60000,
  });

  const stats = {
    total: workshops?.length || 0,
    healthy: workshops?.filter(w => w.overall_status === 'healthy').length || 0,
    warning: workshops?.filter(w => w.overall_status === 'warning').length || 0,
    critical: workshops?.filter(w => w.overall_status === 'critical').length || 0,
    gmailConnected: workshops?.filter(w => w.gmail_connected).length || 0,
    whatsappConnected: workshops?.filter(w => w.whatsapp_connected).length || 0,
  };

  return (
    <div className="page-shell page-stack animate-in">
      <div className="flex items-center justify-between mb-6">
        <PageHeader
          title="Health Check"
          description="Estado de salud de todas las empresas"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Actualizar
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Total</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span className="text-sm text-muted-foreground">OK</span>
            </div>
            <p className="text-2xl font-bold mt-1 text-emerald-600">{stats.healthy}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span className="text-sm text-muted-foreground">Alertas</span>
            </div>
            <p className="text-2xl font-bold mt-1 text-amber-600">{stats.warning}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-500" />
              <span className="text-sm text-muted-foreground">Críticos</span>
            </div>
            <p className="text-2xl font-bold mt-1 text-red-600">{stats.critical}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-emerald-500" />
              <span className="text-sm text-muted-foreground">Gmail</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stats.gmailConnected}/{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-green-500" />
              <span className="text-sm text-muted-foreground">WhatsApp</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stats.whatsappConnected}/{stats.total}</p>
          </CardContent>
        </Card>
      </div>

      {/* Workshops Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Bot className="w-5 h-5" />
            Estado por Empresa
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead className="text-center">Estado</TableHead>
                  <TableHead className="text-center">Integraciones</TableHead>
                  <TableHead>Último Entrante</TableHead>
                  <TableHead>Último Saliente</TableHead>
                  <TableHead className="text-center">Errores 24h</TableHead>
                  <TableHead className="text-center">Bot Pausado</TableHead>
                  <TableHead className="text-center">Conversaciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workshops?.map((w) => (
                  <Collapsible
                    key={w.id}
                    open={expandedWorkshop === w.id}
                    onOpenChange={(open) => setExpandedWorkshop(open ? w.id : null)}
                    asChild
                  >
                    <>
                      <TableRow className="group">
                        <TableCell className="font-medium">
                          <div>
                            {w.name}
                            {w.gmail_email && (
                              <p className="text-xs text-muted-foreground">{w.gmail_email}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <StatusBadge status={w.overall_status} />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-2">
                            <ConnectionIndicator connected={w.gmail_connected} label="Gmail" />
                            <ConnectionIndicator connected={w.whatsapp_connected} label="WhatsApp" />
                            <ConnectionIndicator connected={w.web_chat_enabled || false} label="WebChat" />
                            <ConnectionIndicator connected={w.bot_enabled || false} label="Bot" />
                          </div>
                        </TableCell>
                        <TableCell>
                          <TimeAgo date={w.last_inbound} />
                        </TableCell>
                        <TableCell>
                          <TimeAgo date={w.last_outbound} />
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`font-medium ${w.errors_24h >= 5 ? 'text-red-600' : w.errors_24h > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                            {w.errors_24h}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`font-medium ${w.bot_paused_count > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                            {w.bot_paused_count}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="sm" className="gap-1 text-xs">
                              <MessageSquare className="w-3 h-3" />
                              Ver
                              {expandedWorkshop === w.id ? (
                                <ChevronUp className="w-3 h-3" />
                              ) : (
                                <ChevronDown className="w-3 h-3" />
                              )}
                            </Button>
                          </CollapsibleTrigger>
                        </TableCell>
                      </TableRow>
                      <CollapsibleContent asChild>
                        <tr>
                          <td colSpan={8} className="p-0">
                            <div className="bg-muted/20 border-t">
                              <ConversationMiniLog workshopId={w.id} />
                            </div>
                          </td>
                        </tr>
                      </CollapsibleContent>
                    </>
                  </Collapsible>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}