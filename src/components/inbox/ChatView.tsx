import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Send, Phone, User, Brain, Clock, Target, Smile, RefreshCw, CalendarCheck, Mail, Car, Tag, MessageSquare, TrendingUp, AlertCircle, Bot, BotOff, Info, X, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useMessages, useSendMessage, Message } from '@/hooks/useMessages';
import { Conversation } from '@/hooks/useConversations';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface ChatViewProps {
  conversation: Conversation;
}

function getLeadScoreColor(score: number) {
  if (score >= 80) return { bg: 'bg-orange-500', text: 'text-orange-600', light: 'bg-orange-500/10' };
  if (score >= 50) return { bg: 'bg-amber-500', text: 'text-amber-600', light: 'bg-amber-500/10' };
  return { bg: 'bg-slate-400', text: 'text-slate-500', light: 'bg-slate-500/10' };
}

function getLeadScoreLabel(score: number) {
  if (score >= 80) return { label: 'Lead Caliente', emoji: '🔥', description: 'Alta probabilidad de conversión' };
  if (score >= 50) return { label: 'Lead Tibio', emoji: '⚡', description: 'Interés moderado' };
  return { label: 'Lead Frío', emoji: '💤', description: 'Bajo interés detectado' };
}

function getSentimentInfo(sentiment: string | null) {
  switch (sentiment) {
    case 'positive': return { icon: Smile, label: 'Positivo', className: 'text-emerald-500 bg-emerald-500/10' };
    case 'negative': return { icon: AlertCircle, label: 'Negativo', className: 'text-red-500 bg-red-500/10' };
    default: return { icon: Smile, label: 'Neutral', className: 'text-muted-foreground bg-muted' };
  }
}

function getStatusBadge(status: string) {
  const styles: Record<string, string> = {
    new: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    in_progress: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    booked: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    closed: 'bg-slate-500/10 text-slate-600 border-slate-500/20',
    lost: 'bg-red-500/10 text-red-600 border-red-500/20',
  };
  const labels: Record<string, string> = {
    new: 'Nuevo',
    in_progress: 'En progreso',
    booked: 'Agendado',
    closed: 'Cerrado',
    lost: 'Perdido',
  };
  return { style: styles[status] || styles.new, label: labels[status] || status };
}

function ChatMessage({ message, isSuperAdmin }: { message: Message, isSuperAdmin?: boolean }) {
  const isInbound = message.direction === 'inbound';
  const hasReasoning = !isInbound && message.metadata?.reasoning;

  return (
    <div className={cn('flex', isInbound ? 'justify-start' : 'justify-end')}>
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-4 py-2.5 shadow-sm',
          isInbound
            ? 'bg-muted text-foreground rounded-bl-md'
            : 'bg-primary text-primary-foreground rounded-br-md'
        )}
      >
        <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{message.text}</p>
        <div className="flex items-center justify-between mt-1.5 gap-2">
          <p className={cn(
            'text-[10px] opacity-70',
            isInbound ? 'text-muted-foreground' : 'text-primary-foreground'
          )}>
            {format(new Date(message.created_at), 'HH:mm', { locale: es })}
          </p>
          {isSuperAdmin && !isInbound && message.metadata && (
            <div className="flex items-center gap-1 opacity-70">
              <Brain className="w-2.5 h-2.5" />
              <span className="text-[9px] uppercase tracking-tighter font-bold">Bot Meta</span>
            </div>
          )}
        </div>

        {isSuperAdmin && hasReasoning && (
          <div className="mt-2 pt-2 border-t border-white/20 text-[10px] italic opacity-80 leading-snug">
            <p className="font-bold uppercase tracking-wide text-[8px] mb-0.5 opacity-60">Razonamiento IA:</p>
            {message.metadata?.reasoning}
            {message.metadata?.intent && (
              <div className="flex gap-2 mt-1 font-mono text-[9px]">
                <span>Intent: {message.metadata.intent}</span>
                <span>Conf: {Math.round((message.metadata.confidence || 0) * 100)}%</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatView({ conversation }: ChatViewProps) {
  const [message, setMessage] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isTogglingBot, setIsTogglingBot] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { data: messages, isLoading } = useMessages(conversation.id);
  const sendMessage = useSendMessage();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const isSuperAdmin = profile?.role === 'SUPERADMIN';

  const contact = conversation.contacts;
  const scoreColors = getLeadScoreColor(contact.lead_score);
  const scoreLabel = getLeadScoreLabel(contact.lead_score);
  const sentimentInfo = getSentimentInfo(conversation.sentiment);
  const statusBadge = getStatusBadge(conversation.status);
  const SentimentIcon = sentimentInfo.icon;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Detect dominant channel from messages
  const detectedChannel = messages?.length
    ? messages.filter(m => m.direction === 'inbound').slice(-1)[0]?.channel || messages[0]?.channel || 'whatsapp'
    : 'whatsapp';

  const handleSend = async () => {
    if (!message.trim() || sendMessage.isPending) return;

    const text = message.trim();
    setMessage('');

    try {
      await sendMessage.mutateAsync({
        conversationId: conversation.id,
        text,
        channel: detectedChannel,
      });
    } catch (error) {
      console.error('Error sending message:', error);
      setMessage(text);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleReanalyze = async () => {
    setIsAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-conversation', {
        body: {
          conversation_id: conversation.id,
          contact_id: contact.id,
        },
      });

      if (error) throw error;

      if (data.success && !data.skipped) {
        toast.success('Análisis completado', {
          description: `Lead Score: ${data.analysis.lead_score} | ${data.analysis.did_schedule ? 'Agendó ✓' : 'No agendó'}`,
        });
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
        queryClient.invalidateQueries({ queryKey: ['clients'] });
      } else if (data.skipped) {
        toast.info('Sin mensajes para analizar');
      }
    } catch (error) {
      console.error('Error analyzing conversation:', error);
      toast.error('Error al analizar', {
        description: 'Intenta de nuevo más tarde',
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleToggleBot = async () => {
    setIsTogglingBot(true);
    try {
      const newPausedState = !conversation.bot_paused;

      const { error } = await supabase
        .from('conversations')
        .update({ bot_paused: newPausedState })
        .eq('id', conversation.id);

      if (error) throw error;

      toast.success(newPausedState ? 'Bot pausado' : 'Bot activado', {
        description: newPausedState
          ? 'Ahora responderás manualmente a este cliente'
          : 'El bot volverá a responder automáticamente',
      });

      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    } catch (error) {
      console.error('Error toggling bot:', error);
      toast.error('Error al cambiar estado del bot');
    } finally {
      setIsTogglingBot(false);
    }
  };

  const handleDeleteConversation = async () => {
    setIsDeleting(true);
    try {
      // Delete messages first, then the conversation
      const { error: msgError } = await supabase
        .from('messages')
        .delete()
        .eq('conversation_id', conversation.id);
      if (msgError) throw msgError;

      const { error: convError } = await supabase
        .from('conversations')
        .delete()
        .eq('id', conversation.id);
      if (convError) throw convError;

      toast.success('Conversación eliminada');
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      setShowDeleteDialog(false);
    } catch (error) {
      console.error('Error deleting conversation:', error);
      toast.error('Error al eliminar la conversación');
    } finally {
      setIsDeleting(false);
    }
  };

  const hasVehicleInfo = contact.vehicle_brand || contact.vehicle_model || contact.vehicle_year;
  const isBotPaused = conversation.bot_paused;

  // Client Info Panel Content (reusable for both desktop and mobile sheet)
  const ClientInfoContent = () => (
    <div className="space-y-4">
      {/* Lead Score Card */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Lead Score
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReanalyze}
              disabled={isAnalyzing}
              className="h-7 text-xs"
            >
              <RefreshCw className={cn('w-3 h-3 mr-1', isAnalyzing && 'animate-spin')} />
              {isAnalyzing ? 'Analizando...' : 'Analizar'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <div className={cn('text-4xl font-bold', scoreColors.text)}>
              {contact.lead_score}
            </div>
            <div>
              <div className="flex items-center gap-1">
                <span className="text-lg">{scoreLabel.emoji}</span>
                <span className={cn('font-semibold text-sm', scoreColors.text)}>{scoreLabel.label}</span>
              </div>
              <p className="text-xs text-muted-foreground">{scoreLabel.description}</p>
            </div>
          </div>
          <Progress value={contact.lead_score} className="h-2" />
          {contact.lead_score_reasoning && (
            <p className="text-xs text-muted-foreground bg-muted p-2 rounded-md">
              {contact.lead_score_reasoning}
            </p>
          )}
          {contact.last_analyzed_at && (
            <p className="text-[10px] text-muted-foreground">
              Último análisis: {formatDistanceToNow(new Date(contact.last_analyzed_at), { addSuffix: true, locale: es })}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Intent & Sentiment */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Brain className="w-4 h-4" />
            Análisis IA
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 rounded-lg bg-muted">
              <div className="flex items-center gap-1.5 mb-1">
                <Target className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Intención</span>
              </div>
              <p className="text-sm font-medium capitalize">
                {contact.detected_intent?.replace(/_/g, ' ') || 'Sin detectar'}
              </p>
              {contact.intent_confidence && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {Math.round((contact.intent_confidence as number) * 100)}% confianza
                </p>
              )}
            </div>

            <div className="p-3 rounded-lg bg-muted">
              <div className="flex items-center gap-1.5 mb-1">
                <SentimentIcon className={cn('w-3.5 h-3.5', sentimentInfo.className.split(' ')[0])} />
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Sentimiento</span>
              </div>
              <p className="text-sm font-medium">{sentimentInfo.label}</p>
            </div>
          </div>

          {conversation.ai_summary && (
            <div className="p-3 rounded-lg bg-muted">
              <div className="flex items-center gap-1.5 mb-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Resumen</span>
              </div>
              <p className="text-xs leading-relaxed">{conversation.ai_summary}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Contact Info */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <User className="w-4 h-4" />
            Información de Contacto
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5">
          <div className="flex items-center gap-2 text-sm">
            <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
            <span>{contact.phone || contact.whatsapp_id || 'Sin teléfono'}</span>
          </div>
          {contact.email && (
            <div className="flex items-center gap-2 text-sm">
              <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="truncate">{contact.email}</span>
            </div>
          )}
          {hasVehicleInfo && (
            <div className="flex items-start gap-2 text-sm">
              <Car className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              <span>
                {[contact.vehicle_brand, contact.vehicle_model, contact.vehicle_year].filter(Boolean).join(' ')}
              </span>
            </div>
          )}
          {contact.tags && contact.tags.length > 0 && (
            <div className="flex items-start gap-2">
              <Tag className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              <div className="flex flex-wrap gap-1">
                {contact.tags.map((tag: string, i: number) => (
                  <Badge key={i} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recontact Alert */}
      {contact.should_recontact && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-warning/20 flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4 text-warning" />
              </div>
              <div>
                <p className="font-medium text-sm text-warning">Recontactar</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {contact.recontact_reason || 'Cliente requiere seguimiento'}
                </p>
                {contact.recontact_at && (
                  <p className="text-xs text-warning mt-1">
                    {format(new Date(contact.recontact_at), "d MMM 'a las' HH:mm", { locale: es })}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notes */}
      {contact.notes && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Notas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">{contact.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Created Date */}
      <div className="text-center pt-2">
        <p className="text-[10px] text-muted-foreground">
          Cliente desde {format(new Date(contact.created_at), "d 'de' MMMM yyyy", { locale: es })}
        </p>
      </div>
    </div>
  );

  return (
    <div className="h-full flex overflow-hidden">
      {/* Chat Section */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Compact Header - hidden on mobile (shown in InboxPage) */}
        <div className="hidden md:flex px-4 py-3 border-b border-border/60 bg-card/70 backdrop-blur-sm items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold">{contact.name}</h3>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Phone className="w-3 h-3" />
                {contact.phone || contact.whatsapp_id}
                <Badge variant="secondary" className="ml-1 text-[10px] py-0 px-1.5">
                  {detectedChannel === 'instagram' ? '📸 Instagram' : 
                   detectedChannel === 'email' || detectedChannel === 'gmail' ? '📧 Email' :
                   detectedChannel === 'web' || detectedChannel === 'web_chat' ? '🌐 Web' :
                   '💬 WhatsApp'}
                </Badge>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 lg:gap-3">
            {/* Bot Toggle */}
            <Button
              variant={isBotPaused ? "outline" : "default"}
              size="sm"
              onClick={handleToggleBot}
              disabled={isTogglingBot}
              className={cn(
                "h-8 text-xs gap-1.5 transition-colors",
                isBotPaused
                  ? "border-orange-500/50 text-orange-600 hover:bg-orange-500/10"
                  : "bg-emerald-600 hover:bg-emerald-700"
              )}
            >
              {isBotPaused ? (
                <>
                  <BotOff className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Bot Pausado</span>
                </>
              ) : (
                <>
                  <Bot className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Bot Activo</span>
                </>
              )}
            </Button>

            <Badge variant="outline" className={cn('text-xs hidden sm:flex', statusBadge.style)}>
              {statusBadge.label}
            </Badge>
            {contact.did_schedule && (
              <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/20 hidden sm:flex">
                <CalendarCheck className="w-3 h-3 mr-1" />
                Agendado
              </Badge>
            )}

            {/* Delete Conversation */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowDeleteDialog(true)}
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="w-4 h-4" />
            </Button>

            {/* Mobile: Info Sheet Trigger */}
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="lg:hidden h-8 w-8">
                  <Info className="w-4 h-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[85vw] sm:w-[400px] p-0">
                <SheetHeader className="p-4 border-b">
                  <SheetTitle>Información del Cliente</SheetTitle>
                </SheetHeader>
                <ScrollArea className="h-[calc(100vh-60px)]">
                  <div className="p-4">
                    <ClientInfoContent />
                  </div>
                </ScrollArea>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        {/* Mobile Header Controls */}
        <div className="md:hidden px-3 py-2 border-b border-border/60 bg-card/70 backdrop-blur-sm flex items-center justify-between gap-2">
          <Button
            variant={isBotPaused ? "outline" : "default"}
            size="sm"
            onClick={handleToggleBot}
            disabled={isTogglingBot}
            className={cn(
              "h-8 text-xs gap-1.5 transition-colors flex-1",
              isBotPaused
                ? "border-orange-500/50 text-orange-600 hover:bg-orange-500/10"
                : "bg-emerald-600 hover:bg-emerald-700"
            )}
          >
            {isBotPaused ? (
              <>
                <BotOff className="w-3.5 h-3.5" />
                Bot Pausado
              </>
            ) : (
              <>
                <Bot className="w-3.5 h-3.5" />
                Bot Activo
              </>
            )}
          </Button>

          <Badge variant="outline" className={cn('text-xs', statusBadge.style)}>
            {statusBadge.label}
          </Badge>

          {/* Mobile: Delete Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowDeleteDialog(true)}
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="w-4 h-4" />
          </Button>

          {/* Mobile: Info Sheet Trigger */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8">
                <Info className="w-4 h-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[85vw] sm:w-[400px] p-0">
              <SheetHeader className="p-4 border-b">
                <SheetTitle>Información del Cliente</SheetTitle>
              </SheetHeader>
              <ScrollArea className="h-[calc(100vh-60px)]">
                <div className="p-4">
                  <ClientInfoContent />
                </div>
              </ScrollArea>
            </SheetContent>
          </Sheet>
        </div>

        {/* Bot Paused Banner */}
        {isBotPaused && (
          <div className="px-4 py-2 bg-orange-500/10 border-b border-orange-500/20 flex items-center justify-between">
            <div className="flex items-center gap-2 text-orange-600">
              <BotOff className="w-4 h-4" />
              <span className="text-sm font-medium">
                Bot pausado - Respondiendo manualmente
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToggleBot}
              disabled={isTogglingBot}
              className="h-7 text-xs text-orange-600 hover:text-orange-700 hover:bg-orange-500/20"
            >
              Reactivar bot
            </Button>
          </div>
        )}

        {/* Messages */}
        <ScrollArea className="flex-1 p-4">
          <div className="space-y-3">
            {isLoading ? (
              <div className="text-center text-muted-foreground py-8">Cargando mensajes...</div>
            ) : messages?.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">No hay mensajes</div>
            ) : (
              messages?.map((msg) => <ChatMessage key={msg.id} message={msg} isSuperAdmin={isSuperAdmin} />)
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Input */}
        <div className="p-3 md:p-4 border-t border-border/60 bg-card/70 backdrop-blur-sm">
          <div className="flex items-end gap-2">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Escribe un mensaje..."
              className="min-h-[44px] max-h-32 resize-none text-base md:text-sm"
              rows={1}
            />
            <Button
              onClick={handleSend}
              disabled={!message.trim() || sendMessage.isPending}
              size="icon"
              className="h-11 w-11 shrink-0"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Desktop Client Info Panel */}
      <div className="w-80 border-l border-border/60 bg-muted/30 hidden lg:flex flex-col">
        <ScrollArea className="flex-1">
          <div className="p-4">
            <ClientInfoContent />
          </div>
        </ScrollArea>
      </div>
      {/* Delete Conversation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar conversación?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarán todos los mensajes de esta conversación con <strong>{contact.name}</strong>. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteConversation}
              disabled={isDeleting}
            >
              {isDeleting ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
