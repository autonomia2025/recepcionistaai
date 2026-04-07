import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useWorkshopMode } from '@/hooks/useWorkshopMode';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from 'sonner';
import {
  User,
  Phone,
  Mail,
  MapPin,
  Calendar,
  Clock,
  Target,
  TrendingUp,
  MessageSquare,
  DollarSign,
  Car,
  FileText,
  CheckCircle2,
  XCircle,
  Package,
  Briefcase,
  ClipboardList,
  Hash,
  Building,
  Timer,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface Contact {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  lead_score: number;
  detected_intent: string | null;
  intent_confidence: number | null;
  should_recontact: boolean;
  recontact_at: string | null;
  recontact_reason: string | null;
  created_at: string;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  did_schedule: boolean | null;
  schedule_confidence: number | null;
  lead_score_reasoning: string | null;
  notes: string | null;
  tags: string[] | null;
  last_analyzed_at: string | null;
}

interface ServiceRequest {
  id: string;
  service_category: string;
  description: string | null;
  address: string | null;
  comuna: string | null;
  preferred_time_window: string | null;
  urgency: 'low' | 'medium' | 'high';
  status: string;
  estimated_value: number | null;
  notes: string | null;
  source: string;
  created_at: string;
  assigned_staff: { full_name: string } | null;
}

interface Appointment {
  id: string;
  service_type: string;
  start_datetime: string;
  end_datetime: string;
  status: string;
  notes: string | null;
  assigned_staff: { full_name: string } | null;
}

interface Conversation {
  id: string;
  status: string;
  sentiment: string | null;
  ai_summary: string | null;
  last_message_text?: string | null;
  last_message_at: string | null;
  messages_count: number;
}

interface QuotationItem {
  id: string;
  product_name: string;
  quantity: number;
  unit: string | null;
  duration: string | null;
  location: string | null;
  address: string | null;
  use_type: string | null;
  specifications: Record<string, unknown>;
  unit_price: number | null;
  total_price: number | null;
  confidence: number;
  status: string;
  extracted_at: string;
  created_at: string;
}

interface ClientDetailDialogProps {
  contact: Contact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getLeadScoreInfo(score: number) {
  if (score >= 80) return { emoji: '🔥', label: 'Caliente', className: 'bg-orange-500/10 text-orange-600 border-orange-500/30' };
  if (score >= 50) return { emoji: '⚡', label: 'Tibio', className: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30' };
  return { emoji: '💤', label: 'Frío', className: 'bg-muted text-muted-foreground border-muted' };
}

function getIntentLabel(intent: string | null) {
  const labels: Record<string, { label: string; emoji: string }> = {
    agendar_cita: { label: 'Agendar cita', emoji: '🎯' },
    cotizacion: { label: 'Cotización', emoji: '💰' },
    consulta: { label: 'Consulta', emoji: '💬' },
    reclamo: { label: 'Reclamo', emoji: '⚠️' },
    seguimiento: { label: 'Seguimiento', emoji: '🔄' },
    compra: { label: 'Compra', emoji: '🛒' },
    soporte: { label: 'Soporte', emoji: '🛠️' },
    otro: { label: 'Otro', emoji: '📝' },
  };
  return intent ? labels[intent] || { label: intent, emoji: '📝' } : null;
}

const URGENCY_LABELS: Record<string, { label: string; className: string }> = {
  low: { label: 'Baja', className: 'bg-green-500/10 text-green-600' },
  medium: { label: 'Media', className: 'bg-yellow-500/10 text-yellow-600' },
  high: { label: 'Alta', className: 'bg-red-500/10 text-red-600' },
};

const STATUS_LABELS: Record<string, string> = {
  new: 'Nueva',
  contacting: 'Contactando',
  waiting_customer: 'Esperando cliente',
  scheduled_visit: 'Visita agendada',
  quoted: 'Cotizado',
  approved: 'Aprobado',
  in_progress: 'En progreso',
  done: 'Completado',
  lost: 'Perdido',
  scheduled: 'Agendada',
  confirmed: 'Confirmada',
  completed: 'Completada',
  no_show: 'No asistió',
  canceled: 'Cancelada',
  pending: 'Pendiente',
};

const QUOTATION_STATUS_LABELS: Record<string, { label: string; className: string; icon: string }> = {
  pending: { label: 'Pendiente de cotizar', className: 'bg-yellow-500/10 text-yellow-600', icon: '⏳' },
  quoted: { label: 'Cotizado', className: 'bg-emerald-500/10 text-emerald-600', icon: '📋' },
  approved: { label: 'Aprobado', className: 'bg-green-500/10 text-green-600', icon: '✅' },
  rejected: { label: 'Rechazado', className: 'bg-red-500/10 text-red-600', icon: '❌' },
};

function ClientDetailContent({ contact }: { contact: Contact }) {
  const { data: workshopMode } = useWorkshopMode();
  const isChatbotOnly = workshopMode?.booking_mode === 'chatbot_only';
  const queryClient = useQueryClient();
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Fetch service requests
  const { data: serviceRequests } = useQuery({
    queryKey: ['client-service-requests', contact.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('service_requests')
        .select(`
          *,
          assigned_staff:profiles!service_requests_assigned_staff_id_fkey(full_name)
        `)
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as ServiceRequest[];
    },
  });

  // Fetch appointments (only for scheduling mode)
  const { data: appointments } = useQuery({
    queryKey: ['client-appointments', contact.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select(`
          *,
          assigned_staff:profiles!appointments_assigned_to_user_id_fkey(full_name)
        `)
        .eq('contact_id', contact.id)
        .order('start_datetime', { ascending: false });

      if (error) throw error;
      return data as Appointment[];
    },
    enabled: !isChatbotOnly,
  });

  // Fetch conversations
  const { data: conversations } = useQuery({
    queryKey: ['client-conversations', contact.id],
    queryFn: async () => {
      const { data: convData, error } = await supabase
        .from('conversations')
        .select(`
          *
        `)
        .eq('contact_id', contact.id)
        .order('last_message_at', { ascending: false });

      if (error) throw error;

      // Get message counts
      const conversationsWithCount = await Promise.all(
        (convData || []).map(async (conv) => {
          const { count } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('conversation_id', conv.id);

          return { ...conv, messages_count: count || 0 };
        })
      );

      return conversationsWithCount as Conversation[];
    },
  });

  // Fetch quotation items (for chatbot_only mode)
  const { data: quotationItems, refetch: refetchQuotationItems } = useQuery({
    queryKey: ['client-quotation-items', contact.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quotation_items')
        .select('*')
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as QuotationItem[];
    },
    enabled: true,
  });

  const scoreInfo = getLeadScoreInfo(contact.lead_score);
  const intentInfo = getIntentLabel(contact.detected_intent);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0,
    }).format(value);
  };

  const totalEstimatedValue = serviceRequests?.reduce((sum, sr) => sum + (sr.estimated_value || 0), 0) || 0;
  const totalQuotationValue = quotationItems?.reduce((sum, qi) => sum + (qi.total_price || 0), 0) || 0;

  // Re-analyze conversations to generate manual quote
  const handleReanalyze = async () => {
    setIsAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-manual-quote', {
        body: {
          contact_id: contact.id
        }
      });

      if (error) throw error;

      if (data?.success) {
        // Refresh data
        await refetchQuotationItems();
        queryClient.invalidateQueries({ queryKey: ['client-conversations', contact.id] });
        queryClient.invalidateQueries({ queryKey: ['contacts'] });

        toast.success(`Cotización generada correctamente: ${data.items_count} ítems detectados.`);
      } else {
        toast.info(data?.message || 'No se pudieron extraer ítems de cotización de la conversación.');
      }
    } catch (error) {
      console.error('Error generating manual quote:', error);
      toast.error('Error al generar la cotización con IA');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <ScrollArea className="h-[calc(100vh-120px)] md:h-[70vh] pr-2 md:pr-4">
      <div className="space-y-4 md:space-y-6">
        {/* Header with Lead Score */}
        <div className="flex flex-col sm:flex-row items-start justify-between gap-3 md:gap-4">
          <div className="flex items-center gap-3 md:gap-4">
            <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <User className="w-6 h-6 md:w-8 md:h-8 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg md:text-xl font-semibold truncate">{contact.name}</h3>
              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 mt-1">
                {contact.phone && (
                  <a href={`tel:${contact.phone}`} className="flex items-center gap-1 text-xs md:text-sm text-muted-foreground hover:text-primary">
                    <Phone className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{contact.phone}</span>
                  </a>
                )}
                {contact.email && (
                  <a href={`mailto:${contact.email}`} className="flex items-center gap-1 text-xs md:text-sm text-muted-foreground hover:text-primary">
                    <Mail className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate max-w-[200px]">{contact.email}</span>
                  </a>
                )}
              </div>
            </div>
          </div>
          <div className="text-left sm:text-right space-y-1 md:space-y-2 flex-shrink-0">
            <Badge className={cn('text-base md:text-lg px-2 md:px-3 py-0.5 md:py-1', scoreInfo.className)}>
              {scoreInfo.emoji} {contact.lead_score}
            </Badge>
            <p className="text-xs md:text-sm text-muted-foreground">{scoreInfo.label}</p>
          </div>
        </div>

        {/* Re-analyze Button (for chatbot_only mode) */}
        {conversations && conversations.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleReanalyze}
            disabled={isAnalyzing}
            className="w-full"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analizando conversaciones...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Re-analizar conversaciones ({conversations.length})
              </>
            )}
          </Button>
        )}

        {/* Tags */}
        {contact.tags && contact.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {contact.tags.map((tag, i) => (
              <Badge key={i} variant="secondary">{tag}</Badge>
            ))}
          </div>
        )}

        <Separator />

        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-2 md:gap-3">
          <Card>
            <CardContent className="p-2 md:p-3 flex items-center gap-2">
              <Target className="w-4 h-4 text-primary flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] md:text-xs text-muted-foreground">Intención</p>
                <p className="text-xs md:text-sm font-medium truncate">
                  {intentInfo ? `${intentInfo.emoji} ${intentInfo.label}` : '-'}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-2 md:p-3 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-primary flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] md:text-xs text-muted-foreground">Conversaciones</p>
                <p className="text-xs md:text-sm font-medium">{conversations?.length || 0}</p>
              </div>
            </CardContent>
          </Card>

          {isChatbotOnly ? (
            <>
              <Card>
                <CardContent className="p-2 md:p-3 flex items-center gap-2">
                  <Package className="w-4 h-4 text-primary flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] md:text-xs text-muted-foreground">Solicitudes</p>
                    <p className="text-xs md:text-sm font-medium">{serviceRequests?.length || 0}</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-2 md:p-3 flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-green-600 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] md:text-xs text-muted-foreground">Valor Est.</p>
                    <p className="text-xs md:text-sm font-medium text-green-600 truncate">
                      {totalEstimatedValue > 0 ? formatCurrency(totalEstimatedValue) : '-'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <>
              <Card>
                <CardContent className="p-2 md:p-3 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-primary flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] md:text-xs text-muted-foreground">Citas</p>
                    <p className="text-xs md:text-sm font-medium">{appointments?.length || 0}</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-2 md:p-3 flex items-center gap-2">
                  {contact.did_schedule ? (
                    <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-[10px] md:text-xs text-muted-foreground">¿Agendó?</p>
                    <p className="text-xs md:text-sm font-medium">
                      {contact.did_schedule === true ? 'Sí' : contact.did_schedule === false ? 'No' : '-'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* Lead Score Reasoning */}
        {contact.lead_score_reasoning && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Análisis de Lead
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{contact.lead_score_reasoning}</p>
            </CardContent>
          </Card>
        )}

        {/* Recontact Info */}
        {contact.should_recontact && (
          <Card className="border-warning/50 bg-warning/5">
            <CardContent className="p-3 md:p-4 flex items-start gap-3">
              <Clock className="w-5 h-5 text-warning mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="font-medium text-warning">Recontacto pendiente</p>
                {contact.recontact_at && (
                  <p className="text-sm text-muted-foreground">
                    Fecha: {(() => {
                      try {
                        // Handle both date-only (YYYY-MM-DD) and datetime formats
                        const dateStr = contact.recontact_at;
                        const date = dateStr.includes('T')
                          ? new Date(dateStr)
                          : new Date(dateStr + 'T12:00:00');
                        return format(date, "dd 'de' MMMM, yyyy", { locale: es });
                      } catch {
                        return contact.recontact_at;
                      }
                    })()}
                  </p>
                )}
                {contact.recontact_reason && (
                  <p className="text-sm mt-1 break-words">{contact.recontact_reason}</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Vehicle Info (only for scheduling mode) */}
        {!isChatbotOnly && (contact.vehicle_brand || contact.vehicle_model) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Car className="w-4 h-4" />
                Vehículo
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                {[contact.vehicle_brand, contact.vehicle_model, contact.vehicle_year].filter(Boolean).join(' ')}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Notes */}
        {contact.notes && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Notas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{contact.notes}</p>
            </CardContent>
          </Card>
        )}

        {/* Cotización Enviada Checkbox */}
        <QuoteSentCheckbox contactId={contact.id} initialValue={!!(contact as any).quote_sent} />

        <Separator />

        {/* Quotation Items - Available for all modes now */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium flex items-center gap-2">
              <ClipboardList className="w-4 h-4" />
              📋 Cotización Solicitada {quotationItems && quotationItems.length > 0 && `(${quotationItems.length})`}
            </h4>
            <Button
              variant="outline"
              size="sm"
              onClick={handleReanalyze}
              disabled={isAnalyzing}
              className="h-8 text-xs"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                  Generando...
                </>
              ) : (
                <>
                  <RefreshCw className="w-3 h-3 mr-1.5" />
                  Generar Cotización (IA)
                </>
              )}
            </Button>
          </div>

          {quotationItems && quotationItems.length > 0 ? (
            <div className="space-y-4">
              {quotationItems.map((item) => {
                const statusInfo = QUOTATION_STATUS_LABELS[item.status] || QUOTATION_STATUS_LABELS.pending;
                const specs = item.specifications as Record<string, string>;

                return (
                  <Card key={item.id} className="border-l-4 border-l-primary">
                    <CardContent className="p-4">
                      {/* Product Header */}
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Package className="w-5 h-5 text-primary" />
                            <h5 className="font-semibold text-base">{item.product_name}</h5>
                          </div>
                          <div className="flex items-center gap-3 text-sm">
                            <Badge variant="outline" className="flex items-center gap-1">
                              <Hash className="w-3 h-3" />
                              {item.quantity} {item.unit || 'unidad(es)'}
                            </Badge>
                            <Badge className={statusInfo.className}>
                              {statusInfo.icon} {statusInfo.label}
                            </Badge>
                          </div>
                        </div>
                        {(item.unit_price || item.total_price) && (
                          <div className="text-right">
                            {item.total_price && item.total_price > 0 && (
                              <p className="font-bold text-lg text-primary">{formatCurrency(item.total_price)}</p>
                            )}
                            {item.unit_price && item.unit_price > 0 && (
                              <p className="text-xs text-muted-foreground">{formatCurrency(item.unit_price)}/unidad</p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Location & Duration */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
                        {item.location && (
                          <div className="flex items-center gap-2 text-sm">
                            <MapPin className="w-4 h-4 text-muted-foreground" />
                            <span className="font-medium">Ubicación:</span>
                            <span>{item.location}</span>
                          </div>
                        )}
                        {item.address && (
                          <div className="flex items-start gap-2 text-sm col-span-1 md:col-span-2">
                            <Building className="w-4 h-4 text-muted-foreground mt-0.5" />
                            <span className="font-medium">Dirección:</span>
                            <span>{item.address}</span>
                          </div>
                        )}
                        {item.duration && (
                          <div className="flex items-center gap-2 text-sm">
                            <Timer className="w-4 h-4 text-muted-foreground" />
                            <span className="font-medium">Duración:</span>
                            <span>{item.duration}</span>
                          </div>
                        )}
                        {item.use_type && (
                          <div className="flex items-center gap-2 text-sm">
                            <Briefcase className="w-4 h-4 text-muted-foreground" />
                            <span className="font-medium">Uso:</span>
                            <span className="capitalize">{item.use_type}</span>
                          </div>
                        )}
                      </div>

                      {/* Specifications */}
                      {specs && Object.keys(specs).length > 0 && (
                        <div className="p-3 bg-muted/50 rounded-lg">
                          <p className="text-xs font-medium text-muted-foreground mb-2">Especificaciones:</p>
                          <ul className="space-y-1">
                            {Object.entries(specs).map(([key, value]) => (
                              <li key={key} className="text-sm flex items-start gap-2">
                                <span className="text-muted-foreground">•</span>
                                <span>
                                  <span className="font-medium capitalize">{key.replace(/_/g, ' ')}:</span>{' '}
                                  {typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Footer */}
                      <div className="flex items-center justify-between mt-3 pt-2 border-t text-xs text-muted-foreground">
                        <span>
                          Extraído: {format(new Date(item.extracted_at), "dd 'de' MMMM, HH:mm", { locale: es })}
                        </span>
                        <span className="flex items-center gap-1">
                          Confianza: {Math.round(item.confidence * 100)}%
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}

              {/* Total Value if any prices are available */}
              {totalQuotationValue > 0 && (
                <Card className="bg-primary/5 border-primary/20">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <DollarSign className="w-5 h-5 text-primary" />
                      <span className="font-medium">Valor Total Estimado</span>
                    </div>
                    <span className="font-bold text-xl text-primary">{formatCurrency(totalQuotationValue)}</span>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <div className="text-center py-8 border-2 border-dashed rounded-xl border-muted bg-muted/5">
              <ClipboardList className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No hay ítems de cotización detectados aún.</p>
              <p className="text-xs text-muted-foreground/60 mb-4">Usa el botón de arriba para analizar la conversación.</p>
            </div>
          )}
        </div>


        {/* Service Requests (for chatbot_only mode) */}
        {isChatbotOnly && serviceRequests && serviceRequests.length > 0 && (
          <div>
            <h4 className="font-medium mb-3 flex items-center gap-2">
              <Briefcase className="w-4 h-4" />
              Solicitudes de Servicio ({serviceRequests.length})
            </h4>
            <div className="space-y-3">
              {serviceRequests.map((sr) => (
                <Card key={sr.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline">{sr.service_category}</Badge>
                          <Badge className={URGENCY_LABELS[sr.urgency]?.className}>
                            {URGENCY_LABELS[sr.urgency]?.label || sr.urgency}
                          </Badge>
                          <Badge variant="secondary">
                            {STATUS_LABELS[sr.status] || sr.status}
                          </Badge>
                        </div>
                        {sr.description && (
                          <p className="text-sm text-muted-foreground mb-2">{sr.description}</p>
                        )}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          {sr.comuna && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              {sr.comuna}
                            </span>
                          )}
                          {sr.address && (
                            <span>{sr.address}</span>
                          )}
                          {sr.preferred_time_window && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {sr.preferred_time_window}
                            </span>
                          )}
                          {sr.assigned_staff && (
                            <span className="flex items-center gap-1">
                              <User className="w-3 h-3" />
                              {sr.assigned_staff.full_name}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        {sr.estimated_value && (
                          <p className="font-medium text-primary">{formatCurrency(sr.estimated_value)}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(sr.created_at), 'dd MMM yyyy', { locale: es })}
                        </p>
                      </div>
                    </div>
                    {sr.notes && (
                      <p className="text-sm mt-2 p-2 bg-muted/50 rounded">{sr.notes}</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Appointments (for scheduling mode) */}
        {!isChatbotOnly && appointments && appointments.length > 0 && (
          <div>
            <h4 className="font-medium mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Citas ({appointments.length})
            </h4>
            <div className="space-y-3">
              {appointments.map((apt) => (
                <Card key={apt.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline">{apt.service_type}</Badge>
                          <Badge variant="secondary">
                            {STATUS_LABELS[apt.status] || apt.status}
                          </Badge>
                        </div>
                        <p className="text-sm">
                          {format(new Date(apt.start_datetime), "EEEE dd 'de' MMMM, HH:mm", { locale: es })}
                        </p>
                        {apt.assigned_staff && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                            <User className="w-3 h-3" />
                            {apt.assigned_staff.full_name}
                          </p>
                        )}
                      </div>
                    </div>
                    {apt.notes && (
                      <p className="text-sm mt-2 p-2 bg-muted/50 rounded">{apt.notes}</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Conversations Summary */}
        {conversations && conversations.length > 0 && (
          <div>
            <h4 className="font-medium mb-3 flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              Conversaciones ({conversations.length})
            </h4>
            <div className="space-y-3">
              {conversations.slice(0, 3).map((conv) => (
                <Card key={conv.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="secondary">
                            {STATUS_LABELS[conv.status] || conv.status}
                          </Badge>
                          {conv.sentiment && (
                            <Badge variant="outline">
                              {conv.sentiment === 'positive' ? '😊' : conv.sentiment === 'negative' ? '😟' : '😐'}
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {conv.messages_count} mensajes
                          </span>
                        </div>
                        {conv.last_message_text ? (
                          <p className="text-sm text-foreground/90 line-clamp-2 italic mb-1">
                            "{conv.last_message_text}"
                          </p>
                        ) : conv.ai_summary && (
                          <p className="text-sm text-muted-foreground line-clamp-2">{conv.ai_summary}</p>
                        )}
                        {conv.last_message_text && conv.ai_summary && (
                          <p className="text-[11px] text-muted-foreground line-clamp-1 italic font-light">
                            IA: {conv.ai_summary}
                          </p>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {conv.last_message_at && format(new Date(conv.last_message_at), 'dd MMM', { locale: es })}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Footer Info */}
        <div className="text-xs text-muted-foreground pt-4 border-t">
          <p>Cliente desde: {format(new Date(contact.created_at), "dd 'de' MMMM, yyyy", { locale: es })}</p>
          {contact.last_analyzed_at && (
            <p>Último análisis: {format(new Date(contact.last_analyzed_at), "dd MMM yyyy, HH:mm", { locale: es })}</p>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}

export function ClientDetailDialog({ contact, open, onOpenChange }: ClientDetailDialogProps) {
  const isMobile = useIsMobile();

  if (!contact) return null;

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[90vh] px-3 pt-4">
          <SheetHeader className="pb-3">
            <SheetTitle className="text-lg">Ficha de Cliente</SheetTitle>
            <p className="sr-only">Información detallada del cliente seleccionado</p>
          </SheetHeader>
          <ClientDetailContent contact={contact} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] p-4 md:p-6">
        <DialogHeader>
          <DialogTitle>Ficha de Cliente</DialogTitle>
          <DialogDescription className="sr-only">Información detallada del cliente seleccionado</DialogDescription>
        </DialogHeader>
        <ClientDetailContent contact={contact} />
      </DialogContent>
    </Dialog>
  );
}
