import { Search, User, BotOff, MessageSquare, MapPin } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Conversation } from '@/hooks/useConversations';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

interface ConversationListProps {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (conversation: Conversation) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

function getLeadScoreIndicator(score: number) {
  if (score >= 80) return { emoji: '🔥', label: 'Caliente', className: 'text-orange-500' };
  if (score >= 50) return { emoji: '⚡', label: 'Tibio', className: 'text-amber-500' };
  return { emoji: '💤', label: 'Frío', className: 'text-muted-foreground' };
}

function getIntentLabel(intent: string | null) {
  const labels: Record<string, string> = {
    agendar_cita: '🎯 Agendar',
    cotizacion: '💰 Cotización',
    consulta: '💬 Consulta',
    reclamo: '⚠️ Reclamo',
    seguimiento: '🔄 Seguimiento',
    compra: '🛒 Compra',
    soporte: '🛠️ Soporte',
    otro: '📝 Otro',
  };
  return intent ? labels[intent] || intent : null;
}

function getSentimentEmoji(sentiment: string | null) {
  const sentiments: Record<string, string> = {
    positive: '😊',
    neutral: '😐',
    negative: '😟',
  };
  return sentiment ? sentiments[sentiment] || '' : '';
}

function getZoneLabel(zone: string | null) {
  const zones: Record<string, { label: string; emoji: string }> = {
    talca: { label: 'Talca', emoji: '📍' },
    puerto_montt: { label: 'Pto. Montt', emoji: '📍' },
    santiago: { label: 'Santiago', emoji: '📍' },
  };
  return zone ? zones[zone] || null : null;
}

function getStatusBadge(status: string) {
  const statusConfig: Record<string, { label: string; className: string }> = {
    new: { label: 'Nuevo', className: 'badge-info' },
    in_progress: { label: 'En curso', className: 'badge-warning' },
    booked: { label: 'Agendado', className: 'badge-success' },
    closed: { label: 'Cerrado', className: 'badge-neutral' },
    lost: { label: 'Perdido', className: 'badge-error' },
  };
  return statusConfig[status] || { label: status, className: 'badge-neutral' };
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  searchQuery,
  onSearchChange,
}: ConversationListProps) {
  const filteredConversations = conversations.filter((conv) =>
    conv.contacts.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    conv.contacts.phone?.includes(searchQuery)
  );

  return (
    <div className="h-full flex flex-col border-r border-border/60 bg-card/70 backdrop-blur-sm">
      {/* Search Header */}
      <div className="p-4 border-b border-border/60">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
            <Input
              placeholder="Buscar conversación..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10 bg-background/50 border-border/60 focus:bg-background"
            />
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {filteredConversations.length} conversación{filteredConversations.length !== 1 ? 'es' : ''}
        </p>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {filteredConversations.length === 0 ? (
          <div className="empty-state py-12">
            <MessageSquare className="empty-state-icon" />
            <p className="empty-state-title">Sin conversaciones</p>
            <p className="empty-state-description">
              Las conversaciones aparecerán aquí cuando los clientes te escriban
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {filteredConversations.map((conv) => {
              const scoreInfo = getLeadScoreIndicator(conv.contacts.lead_score);
              const intentLabel = getIntentLabel(conv.contacts.detected_intent);
              const sentimentEmoji = getSentimentEmoji(conv.sentiment);
              const statusBadge = getStatusBadge(conv.status);
              const zoneInfo = getZoneLabel((conv.contacts as any).zone);
              const isNew = conv.status === 'new';
              const isSelected = selectedId === conv.id;
              
              return (
                <div
                  key={conv.id}
                  onClick={() => onSelect(conv)}
                  className={cn(
                    'relative px-4 py-3.5 cursor-pointer transition-all duration-150',
                    'hover:bg-muted/40',
                    isSelected && 'bg-primary/5 border-l-2 border-l-primary',
                    isNew && !isSelected && 'bg-primary/[0.02]'
                  )}
                >
                  {/* Unread indicator */}
                  {isNew && !isSelected && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full" />
                  )}
                  
                  <div className="flex items-start gap-3">
                    {/* Avatar / Score indicator */}
                    <div className={cn(
                      'flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg',
                      isNew ? 'bg-primary/10' : 'bg-muted'
                    )}>
                      {scoreInfo.emoji}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      {/* Header: Name + Time */}
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className={cn(
                          'font-medium text-sm truncate',
                          isNew && 'font-semibold text-foreground'
                        )}>
                          {conv.contacts.name} {sentimentEmoji}
                        </span>
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                          {conv.last_message_at
                            ? formatDistanceToNow(new Date(conv.last_message_at), { 
                                addSuffix: false, 
                                locale: es 
                              })
                            : '-'}
                        </span>
                      </div>
                      
                      {/* Badges row */}
                      <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                        <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full border', statusBadge.className)}>
                          {statusBadge.label}
                        </span>
                        {intentLabel && (
                          <span className="text-[11px] text-muted-foreground">
                            {intentLabel}
                          </span>
                        )}
                        {conv.bot_paused && (
                          <span className="text-[10px] bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 border border-orange-200/50">
                            <BotOff className="w-2.5 h-2.5" />
                            Pausado
                          </span>
                        )}
                      </div>
                      
                      {/* AI Summary */}
                      {conv.ai_summary && (
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          {conv.ai_summary}
                        </p>
                      )}
                      
                      {/* Assigned staff */}
                      {conv.assigned_to && (
                        <div className="mt-1.5">
                          <Badge variant="secondary" className="text-[10px] py-0 px-1.5 gap-0.5 font-normal">
                            <User className="w-2.5 h-2.5" />
                            {conv.assigned_to.full_name.split(' ')[0]}
                          </Badge>
                        </div>
                      )}
                      
                      {/* Recontact badge */}
                      {conv.contacts.should_recontact && (
                        <div className="mt-1.5">
                          <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200/50">
                            ⏰ Recontactar
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
