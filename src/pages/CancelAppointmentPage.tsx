import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { 
  Calendar, 
  Clock, 
  User, 
  Wrench, 
  Loader2, 
  XCircle, 
  CheckCircle2, 
  AlertTriangle,
  ArrowLeft
} from 'lucide-react';

interface AppointmentData {
  id: string;
  service_type: string;
  start_datetime: string;
  end_datetime: string;
  status: string;
  notes: string | null;
  workshop: {
    name: string;
    slug: string;
  };
  contact: {
    name: string;
  };
  assigned_user: {
    full_name: string;
  } | null;
}

const CancelAppointmentPage = () => {
  const { appointmentId, token } = useParams<{ appointmentId: string; token: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState(false);
  const [canceled, setCanceled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appointment, setAppointment] = useState<AppointmentData | null>(null);

  useEffect(() => {
    const loadAppointment = async () => {
      if (!appointmentId || !token) {
        setError('Enlace inválido');
        setLoading(false);
        return;
      }

      try {
        // Fetch appointment details through edge function for security
        const { data, error: fetchError } = await supabase.functions.invoke('public-booking-create', {
          body: {
            action: 'get_appointment',
            appointment_id: appointmentId,
            cancel_token: token
          }
        });

        if (fetchError) throw fetchError;

        if (!data?.ok || !data?.appointment) {
          setError(data?.error || 'Cita no encontrada o enlace expirado');
          setLoading(false);
          return;
        }

        // Check if already canceled
        if (data.appointment.status === 'canceled') {
          setCanceled(true);
        }

        setAppointment(data.appointment);
      } catch (err) {
        console.error('Error loading appointment:', err);
        setError('No se pudo cargar la información de la cita');
      } finally {
        setLoading(false);
      }
    };

    loadAppointment();
  }, [appointmentId, token]);

  const handleCancel = async () => {
    if (!appointmentId || !token) return;

    setCanceling(true);
    try {
      const { data, error: cancelError } = await supabase.functions.invoke('public-booking-create', {
        body: {
          action: 'cancel',
          appointment_id: appointmentId,
          cancel_token: token
        }
      });

      if (cancelError) throw cancelError;

      if (!data?.ok) {
        throw new Error(data?.error || 'Error al cancelar');
      }

      setCanceled(true);
      toast({
        title: 'Cita cancelada',
        description: 'Tu cita ha sido cancelada correctamente'
      });
    } catch (err: any) {
      console.error('Error canceling appointment:', err);
      toast({
        title: 'Error',
        description: err.message || 'No se pudo cancelar la cita',
        variant: 'destructive'
      });
    } finally {
      setCanceling(false);
    }
  };

  if (loading) {
    return (
      <div className="public-shell flex items-center justify-center p-4">
        <Card className="public-card w-full max-w-md text-center">
          <CardContent className="py-12">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="mt-4 text-muted-foreground">Cargando información de la cita...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="public-shell flex items-center justify-center p-4">
        <Card className="public-card w-full max-w-md text-center">
          <CardHeader>
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
            <CardTitle className="text-xl">Enlace inválido</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Este enlace puede haber expirado o la cita ya no existe.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (canceled) {
    return (
      <div className="public-shell flex items-center justify-center p-4">
        <Card className="public-card w-full max-w-md text-center">
          <CardHeader>
            <div className="mx-auto mb-4 h-16 w-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            </div>
            <CardTitle className="text-xl">Cita cancelada</CardTitle>
            <CardDescription>
              Tu cita ha sido cancelada correctamente
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {appointment && (
              <div className="bg-muted rounded-lg p-4 text-left space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Wrench className="h-4 w-4 text-muted-foreground" />
                  <span>{appointment.service_type}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {format(new Date(appointment.start_datetime), "EEEE d 'de' MMMM", { locale: es })}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span>{format(new Date(appointment.start_datetime), 'HH:mm')} hrs</span>
                </div>
              </div>
            )}
            {appointment?.workshop?.slug && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => navigate(`/agenda/${appointment.workshop.slug}`)}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Agendar nueva cita
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="public-shell flex items-center justify-center p-4">
      <Card className="public-card w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
            <XCircle className="h-8 w-8 text-destructive" />
          </div>
          <CardTitle className="text-xl">¿Cancelar tu cita?</CardTitle>
          <CardDescription>
            Esta acción no se puede deshacer
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {appointment && (
            <>
              <div className="text-center mb-2">
                <Badge variant="outline" className="text-sm">
                  {appointment.workshop?.name}
                </Badge>
              </div>
              <div className="bg-muted rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <Wrench className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <span className="font-medium">{appointment.service_type}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Calendar className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <span>
                    {format(new Date(appointment.start_datetime), "EEEE d 'de' MMMM 'de' yyyy", { locale: es })}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Clock className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <span>
                    {format(new Date(appointment.start_datetime), 'HH:mm')} - {format(new Date(appointment.end_datetime), 'HH:mm')} hrs
                  </span>
                </div>
                {appointment.assigned_user && (
                  <div className="flex items-center gap-3">
                    <User className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    <span>{appointment.assigned_user.full_name}</span>
                  </div>
                )}
              </div>
            </>
          )}

          <div className="flex flex-col gap-2 pt-4">
            <Button
              variant="destructive"
              className="w-full"
              onClick={handleCancel}
              disabled={canceling}
            >
              {canceling ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Cancelando...
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 mr-2" />
                  Confirmar cancelación
                </>
              )}
            </Button>
            {appointment?.workshop?.slug && (
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => navigate(`/agenda/${appointment.workshop.slug}`)}
              >
                Volver sin cancelar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default CancelAppointmentPage;
