import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { CalendarEvent } from '@/hooks/useCalendarEvents';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { es } from 'date-fns/locale';
import { 
  Calendar, 
  Clock, 
  User, 
  Phone, 
  Mail, 
  Car, 
  MessageSquare,
  Target,
  Sparkles,
  AlertCircle
} from 'lucide-react';

const TIMEZONE = 'America/Santiago';

interface EventDetailDialogProps {
  event: CalendarEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface AppointmentDetails {
  id: string;
  service_type: string;
  status: string;
  notes: string | null;
  contact: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    vehicle_brand: string | null;
    vehicle_model: string | null;
    vehicle_year: number | null;
    lead_score: number | null;
    detected_intent: string | null;
  } | null;
  conversation: {
    id: string;
    ai_summary: string | null;
    sentiment: string | null;
  } | null;
  assignedTo: {
    id: string;
    full_name: string;
    email: string;
  } | null;
}

const serviceTypeLabels: Record<string, string> = {
  'mantencion_general': 'Mantención General',
  'cambio_aceite': 'Cambio de Aceite',
  'frenos': 'Revisión de Frenos',
  'suspension': 'Suspensión',
  'diagnostico': 'Diagnóstico',
  'otro': 'Otro Servicio',
};

const statusLabels: Record<string, { label: string; color: string }> = {
  'scheduled': { label: 'Agendada', color: 'bg-emerald-500' },
  'confirmed': { label: 'Confirmada', color: 'bg-green-500' },
  'completed': { label: 'Completada', color: 'bg-gray-500' },
  'no_show': { label: 'No asistió', color: 'bg-red-500' },
  'canceled': { label: 'Cancelada', color: 'bg-gray-400' },
};

const intentLabels: Record<string, string> = {
  'agendar_cita': '🎯 Agendar cita',
  'cotizacion': '💰 Cotización',
  'consulta': '💬 Consulta',
  'reclamo': '⚠️ Reclamo',
  'seguimiento': '🔄 Seguimiento',
};

const sentimentInfo: Record<string, { emoji: string; label: string; color: string }> = {
  'positive': { emoji: '😊', label: 'Positivo', color: 'text-green-600' },
  'neutral': { emoji: '😐', label: 'Neutral', color: 'text-muted-foreground' },
  'negative': { emoji: '😠', label: 'Negativo', color: 'text-red-600' },
};

export function EventDetailDialog({ event, open, onOpenChange }: EventDetailDialogProps) {
  // Fetch appointment details if this event has an appointment_id
  const { data: appointmentDetails, isLoading } = useQuery({
    queryKey: ['appointment-details', event?.appointment_id],
    queryFn: async (): Promise<AppointmentDetails | null> => {
      if (!event?.appointment_id) return null;

      const { data: appointment, error } = await supabase
        .from('appointments')
        .select(`
          id,
          service_type,
          status,
          notes,
          contact_id,
          assigned_to_user_id
        `)
        .eq('id', event.appointment_id)
        .single();

      if (error || !appointment) return null;

      // Fetch contact
      let contact = null;
      if (appointment.contact_id) {
        const { data: contactData } = await supabase
          .from('contacts')
          .select('id, name, phone, email, vehicle_brand, vehicle_model, vehicle_year, lead_score, detected_intent')
          .eq('id', appointment.contact_id)
          .single();
        contact = contactData;
      }

      // Fetch conversation summary
      let conversation = null;
      if (appointment.contact_id) {
        const { data: convData } = await supabase
          .from('conversations')
          .select('id, ai_summary, sentiment')
          .eq('contact_id', appointment.contact_id)
          .order('last_message_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        conversation = convData;
      }

      // Fetch assigned user
      let assignedTo = null;
      if (appointment.assigned_to_user_id) {
        const { data: userData } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .eq('id', appointment.assigned_to_user_id)
          .single();
        assignedTo = userData;
      }

      return {
        id: appointment.id,
        service_type: appointment.service_type,
        status: appointment.status,
        notes: appointment.notes,
        contact,
        conversation,
        assignedTo,
      };
    },
    enabled: !!event?.appointment_id && open,
  });

  if (!event) return null;

  const formatTime = (dateStr: string) => {
    const date = toZonedTime(new Date(dateStr), TIMEZONE);
    return format(date, 'HH:mm');
  };

  const formatDate = (dateStr: string) => {
    const date = toZonedTime(new Date(dateStr), TIMEZONE);
    return format(date, "EEEE d 'de' MMMM, yyyy", { locale: es });
  };

  const hasAppointmentDetails = !!appointmentDetails;
  const statusInfo = appointmentDetails ? statusLabels[appointmentDetails.status] : null;
  const sentInfo = appointmentDetails?.conversation?.sentiment 
    ? sentimentInfo[appointmentDetails.conversation.sentiment] 
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            {event.title}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh]">
          <div className="space-y-4">
            {/* Event Time Info */}
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="h-4 w-4" />
                {event.is_all_day ? (
                  <span>Todo el día</span>
                ) : (
                  <span>{formatTime(event.start_time)} - {formatTime(event.end_time)}</span>
                )}
              </div>
              <div className="text-muted-foreground">
                {formatDate(event.start_time)}
              </div>
            </div>

            {event.description && (
              <p className="text-sm text-muted-foreground">{event.description}</p>
            )}

            {isLoading && (
              <div className="text-center py-4 text-muted-foreground">
                Cargando detalles...
              </div>
            )}

            {hasAppointmentDetails && appointmentDetails && (
              <>
                <Separator />

                {/* Service & Status */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Target className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">
                        {serviceTypeLabels[appointmentDetails.service_type] || appointmentDetails.service_type}
                      </span>
                    </div>
                    {statusInfo && (
                      <Badge className={`${statusInfo.color} text-white`}>
                        {statusInfo.label}
                      </Badge>
                    )}
                  </div>

                  {/* Assigned To */}
                  {appointmentDetails.assignedTo && (
                    <div className="flex items-center gap-2 text-sm">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span>Asignado a: <strong>{appointmentDetails.assignedTo.full_name}</strong></span>
                    </div>
                  )}
                </div>

                {/* Contact Info */}
                {appointmentDetails.contact && (
                  <>
                    <Separator />
                    <div className="space-y-3">
                      <h4 className="font-medium flex items-center gap-2">
                        <User className="h-4 w-4" />
                        Cliente
                      </h4>
                      
                      <div className="pl-6 space-y-2 text-sm">
                        <p className="font-medium">{appointmentDetails.contact.name}</p>
                        
                        {appointmentDetails.contact.phone && (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Phone className="h-3 w-3" />
                            {appointmentDetails.contact.phone}
                          </div>
                        )}
                        
                        {appointmentDetails.contact.email && (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Mail className="h-3 w-3" />
                            {appointmentDetails.contact.email}
                          </div>
                        )}

                        {(appointmentDetails.contact.vehicle_brand || appointmentDetails.contact.vehicle_model) && (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Car className="h-3 w-3" />
                            {[
                              appointmentDetails.contact.vehicle_brand,
                              appointmentDetails.contact.vehicle_model,
                              appointmentDetails.contact.vehicle_year
                            ].filter(Boolean).join(' ')}
                          </div>
                        )}

                        {appointmentDetails.contact.lead_score !== null && (
                          <div className="flex items-center gap-2">
                            <span className="text-lg">
                              {appointmentDetails.contact.lead_score >= 80 ? '🔥' : 
                               appointmentDetails.contact.lead_score >= 50 ? '⚡' : '💤'}
                            </span>
                            <span>Lead Score: {appointmentDetails.contact.lead_score}</span>
                          </div>
                        )}

                        {appointmentDetails.contact.detected_intent && (
                          <div className="text-muted-foreground">
                            Intención: {intentLabels[appointmentDetails.contact.detected_intent] || appointmentDetails.contact.detected_intent}
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {/* AI Summary */}
                {appointmentDetails.conversation && (
                  <>
                    <Separator />
                    <div className="space-y-3">
                      <h4 className="font-medium flex items-center gap-2">
                        <Sparkles className="h-4 w-4" />
                        Resumen de Conversación
                      </h4>
                      
                      <div className="pl-6 space-y-2 text-sm">
                        {sentInfo && (
                          <div className={`flex items-center gap-2 ${sentInfo.color}`}>
                            <span>{sentInfo.emoji}</span>
                            <span>Sentimiento: {sentInfo.label}</span>
                          </div>
                        )}

                        {appointmentDetails.conversation.ai_summary && (
                          <div className="bg-muted/50 p-3 rounded-lg">
                            <div className="flex items-start gap-2">
                              <MessageSquare className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                              <p className="text-muted-foreground">
                                {appointmentDetails.conversation.ai_summary}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {/* Notes */}
                {appointmentDetails.notes && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <h4 className="font-medium flex items-center gap-2">
                        <AlertCircle className="h-4 w-4" />
                        Notas
                      </h4>
                      <p className="pl-6 text-sm text-muted-foreground">{appointmentDetails.notes}</p>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
