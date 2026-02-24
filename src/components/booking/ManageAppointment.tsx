import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { format, addDays, setHours, setMinutes, isAfter, isBefore, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { Search, Calendar as CalendarIcon, Clock, User, Wrench, Loader2, XCircle, RefreshCw, AlertTriangle } from 'lucide-react';

interface Appointment {
  id: string;
  service_type: string;
  start_datetime: string;
  end_datetime: string;
  status: string;
  notes: string | null;
  cancel_token: string | null;
  contact: {
    name: string;
    phone: string;
  };
  assigned_user: {
    id: string;
    full_name: string;
  } | null;
}

interface TimeSlot {
  start: Date;
  end: Date;
  available: boolean;
}

interface ManageAppointmentProps {
  workshopId: string;
}

export const ManageAppointment = ({ workshopId }: ManageAppointmentProps) => {
  const { toast } = useToast();
  const [phone, setPhone] = useState('');
  const [searching, setSearching] = useState(false);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  // Reschedule state
  const [rescheduleDialogOpen, setRescheduleDialogOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedTime, setSelectedTime] = useState<TimeSlot | null>(null);
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState<{ start_time: string; end_time: string }[]>([]);
  const [rescheduling, setRescheduling] = useState(false);

  // Cancel state
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const searchAppointments = async () => {
    if (!phone.trim()) {
      toast({
        title: 'Ingresa tu teléfono',
        description: 'Necesitamos tu número para buscar tus citas',
        variant: 'destructive'
      });
      return;
    }

    setSearching(true);
    setHasSearched(true);

    try {
      // Normalize phone number - remove spaces and special characters
      const normalizedPhone = phone.replace(/[\s\-\(\)]/g, '');
      
      // First find the contact by phone field (searching with multiple patterns)
      const { data: contacts, error: contactError } = await supabase
        .from('contacts')
        .select('id')
        .eq('workshop_id', workshopId)
        .or(`phone.ilike.%${normalizedPhone}%,phone.ilike.%${normalizedPhone.slice(-8)}%,phone.ilike.%${normalizedPhone.slice(-9)}%`);

      console.log('Searching contacts with phone:', normalizedPhone, 'Result:', contacts, 'Error:', contactError);

      if (contactError) throw contactError;

      if (!contacts || contacts.length === 0) {
        setAppointments([]);
        return;
      }

      const contactIds = contacts.map(c => c.id);

      // Get appointments for these contacts (including cancel_token for authorization)
      const { data: appointmentsData, error: appointmentsError } = await supabase
        .from('appointments')
        .select(`
          id,
          service_type,
          start_datetime,
          end_datetime,
          status,
          notes,
          cancel_token,
          assigned_to_user_id
        `)
        .eq('workshop_id', workshopId)
        .in('contact_id', contactIds)
        .in('status', ['scheduled', 'confirmed'])
        .gte('start_datetime', new Date().toISOString())
        .order('start_datetime', { ascending: true });

      if (appointmentsError) throw appointmentsError;

      // Get contact and user details
      const enrichedAppointments = await Promise.all(
        (appointmentsData || []).map(async (apt) => {
          const { data: contact } = await supabase
            .from('contacts')
            .select('name, phone')
            .eq('id', contactIds[0])
            .single();

          let assignedUser = null;
          if (apt.assigned_to_user_id) {
            const { data: user } = await supabase
              .from('profiles')
              .select('id, full_name')
              .eq('id', apt.assigned_to_user_id)
              .single();
            assignedUser = user;
          }

          return {
            ...apt,
            cancel_token: apt.cancel_token,
            contact: contact || { name: 'Sin nombre', phone },
            assigned_user: assignedUser
          };
        })
      );

      setAppointments(enrichedAppointments);
    } catch (error) {
      console.error('Error searching appointments:', error);
      toast({
        title: 'Error',
        description: 'No se pudieron buscar las citas',
        variant: 'destructive'
      });
    } finally {
      setSearching(false);
    }
  };

  const loadAvailableSlots = async (date: Date, userId: string, duration: number) => {
    setLoadingSlots(true);
    
    // Load calendar events for this user
    const startDate = new Date();
    const endDate = addDays(startDate, 30);
    
    const { data: events } = await supabase
      .from('calendar_events')
      .select('start_time, end_time')
      .eq('workshop_id', workshopId)
      .eq('user_id', userId)
      .gte('start_time', startDate.toISOString())
      .lte('end_time', endDate.toISOString());

    setCalendarEvents(events || []);

    // Generate slots
    const slots: TimeSlot[] = [];
    const startHour = 9;
    const endHour = 18;

    for (let hour = startHour; hour < endHour; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const slotStart = setMinutes(setHours(date, hour), minute);
        const slotEnd = setMinutes(setHours(date, hour), minute + duration);

        if (isBefore(slotStart, new Date())) continue;

        const hasConflict = (events || []).some(event => {
          const eventStart = new Date(event.start_time);
          const eventEnd = new Date(event.end_time);
          return (
            (isAfter(slotStart, eventStart) && isBefore(slotStart, eventEnd)) ||
            (isAfter(slotEnd, eventStart) && isBefore(slotEnd, eventEnd)) ||
            (isBefore(slotStart, eventStart) && isAfter(slotEnd, eventEnd)) ||
            (isSameDay(slotStart, eventStart) && slotStart.getTime() === eventStart.getTime())
          );
        });

        slots.push({ start: slotStart, end: slotEnd, available: !hasConflict });
      }
    }

    setAvailableSlots(slots);
    setLoadingSlots(false);
  };

  const handleReschedule = async () => {
    if (!selectedAppointment || !selectedTime) return;

    setRescheduling(true);
    try {
      if (!selectedAppointment.cancel_token) {
        throw new Error('No se encontró el token de autorización');
      }
      const { error } = await supabase.functions.invoke('public-booking-create', {
        body: {
          action: 'reschedule',
          appointment_id: selectedAppointment.id,
          cancel_token: selectedAppointment.cancel_token,
          new_start_datetime: selectedTime.start.toISOString(),
          new_end_datetime: selectedTime.end.toISOString()
        }
      });

      if (error) throw error;

      toast({
        title: 'Cita reprogramada',
        description: `Tu nueva cita es el ${format(selectedTime.start, "EEEE d 'de' MMMM 'a las' HH:mm", { locale: es })}`
      });

      setRescheduleDialogOpen(false);
      searchAppointments();
    } catch (error) {
      console.error('Error rescheduling:', error);
      toast({
        title: 'Error',
        description: 'No se pudo reprogramar la cita',
        variant: 'destructive'
      });
    } finally {
      setRescheduling(false);
    }
  };

  const handleCancel = async () => {
    if (!selectedAppointment) return;

    setCanceling(true);
    try {
      if (!selectedAppointment.cancel_token) {
        throw new Error('No se encontró el token de autorización');
      }
      const { error } = await supabase.functions.invoke('public-booking-create', {
        body: {
          action: 'cancel',
          appointment_id: selectedAppointment.id,
          cancel_token: selectedAppointment.cancel_token
        }
      });

      if (error) throw error;

      toast({
        title: 'Cita cancelada',
        description: 'Tu cita ha sido cancelada correctamente'
      });

      setCancelDialogOpen(false);
      searchAppointments();
    } catch (error) {
      console.error('Error canceling:', error);
      toast({
        title: 'Error',
        description: 'No se pudo cancelar la cita',
        variant: 'destructive'
      });
    } finally {
      setCanceling(false);
    }
  };

  const openRescheduleDialog = (apt: Appointment) => {
    setSelectedAppointment(apt);
    setSelectedDate(undefined);
    setSelectedTime(null);
    setAvailableSlots([]);
    setRescheduleDialogOpen(true);
  };

  const openCancelDialog = (apt: Appointment) => {
    setSelectedAppointment(apt);
    setCancelDialogOpen(true);
  };

  const statusLabels: Record<string, string> = {
    scheduled: 'Programada',
    confirmed: 'Confirmada',
    completed: 'Completada',
    canceled: 'Cancelada',
    no_show: 'No asistió'
  };

  return (
    <div className="space-y-4">
      {/* Search */}
      <Card className="bg-background/80">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Search className="h-5 w-5" />
            Buscar mis citas
          </CardTitle>
          <CardDescription>
            Ingresa tu número de teléfono para ver y gestionar tus citas
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="phone" className="sr-only">Teléfono</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+56 9 1234 5678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchAppointments()}
              />
            </div>
            <Button onClick={searchAppointments} disabled={searching}>
              {searching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {hasSearched && (
        <div className="space-y-3">
          {appointments.length === 0 ? (
            <Card className="bg-background/80">
              <CardContent className="py-8 text-center">
                <CalendarIcon className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">No se encontraron citas pendientes</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Verifica tu número de teléfono o agenda una nueva cita
                </p>
              </CardContent>
            </Card>
          ) : (
            appointments.map((apt) => (
              <Card key={apt.id} className="bg-background/80">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-2">
                        <Wrench className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{apt.service_type}</span>
                        <Badge variant="outline">{statusLabels[apt.status]}</Badge>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CalendarIcon className="h-4 w-4" />
                        <span>
                          {format(new Date(apt.start_datetime), "EEEE d 'de' MMMM", { locale: es })}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        <span>{format(new Date(apt.start_datetime), 'HH:mm')} hrs</span>
                      </div>
                      {apt.assigned_user && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <User className="h-4 w-4" />
                          <span>{apt.assigned_user.full_name}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openRescheduleDialog(apt)}
                      >
                        <RefreshCw className="h-4 w-4 mr-1" />
                        Reprogramar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => openCancelDialog(apt)}
                      >
                        <XCircle className="h-4 w-4 mr-1" />
                        Cancelar
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Reschedule Dialog */}
      <Dialog open={rescheduleDialogOpen} onOpenChange={setRescheduleDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reprogramar cita</DialogTitle>
            <DialogDescription>
              Selecciona una nueva fecha y hora para tu cita
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => {
                setSelectedDate(date);
                setSelectedTime(null);
                if (date && selectedAppointment?.assigned_user) {
                  const duration = Math.round(
                    (new Date(selectedAppointment.end_datetime).getTime() - 
                     new Date(selectedAppointment.start_datetime).getTime()) / 60000
                  );
                  loadAvailableSlots(date, selectedAppointment.assigned_user.id, duration);
                }
              }}
              disabled={(date) => date < new Date() || date > addDays(new Date(), 30)}
              locale={es}
              className="mx-auto"
            />

            {selectedDate && (
              <div>
                <Label className="text-sm font-medium">Horarios disponibles</Label>
                {loadingSlots ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : (
                  <ScrollArea className="h-[150px] mt-2">
                    <div className="grid grid-cols-3 gap-2">
                      {availableSlots.filter(s => s.available).length === 0 ? (
                        <p className="col-span-3 text-center text-muted-foreground py-4">
                          No hay horarios disponibles
                        </p>
                      ) : (
                        availableSlots
                          .filter((slot) => slot.available)
                          .map((slot, index) => (
                            <Button
                              key={index}
                              variant={selectedTime?.start.getTime() === slot.start.getTime() ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => setSelectedTime(slot)}
                            >
                              {format(slot.start, 'HH:mm')}
                            </Button>
                          ))
                      )}
                    </div>
                  </ScrollArea>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRescheduleDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleReschedule} disabled={!selectedTime || rescheduling}>
              {rescheduling ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Confirmar nueva hora
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Cancelar cita
            </DialogTitle>
            <DialogDescription>
              ¿Estás seguro que deseas cancelar esta cita? Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          {selectedAppointment && (
            <div className="bg-muted rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{selectedAppointment.service_type}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarIcon className="h-4 w-4" />
                <span>
                  {format(new Date(selectedAppointment.start_datetime), "EEEE d 'de' MMMM 'a las' HH:mm", { locale: es })}
                </span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelDialogOpen(false)}>
              Volver
            </Button>
            <Button variant="destructive" onClick={handleCancel} disabled={canceling}>
              {canceling ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Sí, cancelar cita
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
