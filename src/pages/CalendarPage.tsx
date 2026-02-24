import { useState } from 'react';
import { useSearchParams, Navigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GoogleCalendarConnect } from '@/components/calendar/GoogleCalendarConnect';
import { FullCalendarView } from '@/components/calendar/FullCalendarView';
import { TeamAvailabilityView } from '@/components/calendar/TeamAvailabilityView';
import { NewEventDialog } from '@/components/calendar/NewEventDialog';
import { EventDetailDialog } from '@/components/calendar/EventDetailDialog';
import { useCalendarEvents, CalendarEvent } from '@/hooks/useCalendarEvents';
import { useGoogleCalendar } from '@/hooks/useGoogleCalendar';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkshopMode } from '@/hooks/useWorkshopMode';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';

export default function CalendarPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { events, teamEvents, isLoading, createEvent, updateEvent, isCreating, isUpdating, refetch } = useCalendarEvents();
  const { isConnected, syncCalendar } = useGoogleCalendar();
  const { data: workshopMode, isLoading: isModeLoading } = useWorkshopMode();

  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [isNewEventOpen, setIsNewEventOpen] = useState(false);
  const [newEventDateRange, setNewEventDateRange] = useState<{ start: Date; end: Date } | null>(null);

  const isAdmin = profile?.role === 'ADMIN';

  // Handle OAuth callback
  useEffect(() => {
    const success = searchParams.get('success');
    const error = searchParams.get('error');

    if (success === 'true') {
      toast({
        title: '¡Conectado!',
        description: 'Google Calendar se ha conectado correctamente. Sincronizando eventos...',
      });
      syncCalendar().then(() => refetch());
      setSearchParams({});
    } else if (error) {
      toast({
        title: 'Error de conexión',
        description: `No se pudo conectar Google Calendar: ${error}`,
        variant: 'destructive',
      });
      setSearchParams({});
    }
  }, [searchParams, setSearchParams, toast, syncCalendar, refetch]);

  // Redirect chatbot_only businesses away from calendar
  if (!isModeLoading && workshopMode?.booking_mode === 'chatbot_only') {
    return <Navigate to="/dashboard" replace />;
  }

  if (isLoading || isModeLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleEventUpdate = async (update: { id: string; start_time: string; end_time: string }) => {
    await updateEvent(update);
    // Sync with Google Calendar if connected
    if (isConnected) {
      await syncCalendar();
    }
  };

  const handleEventClick = (event: CalendarEvent) => {
    setSelectedEvent(event);
  };

  const handleDateSelect = (start: Date, end: Date) => {
    setNewEventDateRange({ start, end });
    setIsNewEventOpen(true);
  };

  return (
    <div className="page-shell page-stack max-w-full overflow-x-hidden">
      <PageHeader
        title="Agenda"
        description="Gestiona las citas y eventos de tu negocio"
        actions={
          <NewEventDialog 
            onCreateEvent={createEvent} 
            isCreating={isCreating}
            defaultStartDate={newEventDateRange?.start}
            defaultEndDate={newEventDateRange?.end}
            open={isNewEventOpen}
            onOpenChange={(open) => {
              setIsNewEventOpen(open);
              if (!open) setNewEventDateRange(null);
            }}
          />
        }
      />

      <GoogleCalendarConnect />

      <div className="page-panel">
        <div className="section-header">
          <h2 className="section-title">Vista</h2>
        </div>
        <Tabs defaultValue="calendar" className="w-full">
          <TabsList className="w-full sm:w-auto grid grid-cols-2 sm:flex bg-muted/40 p-1 rounded-lg">
            <TabsTrigger value="calendar" className="text-sm">Mi Calendario</TabsTrigger>
            {isAdmin && <TabsTrigger value="team" className="text-sm">Equipo</TabsTrigger>}
          </TabsList>

          <TabsContent value="calendar" className="mt-4 md:mt-6">
            <div className="card-premium p-2 md:p-3 overflow-x-auto">
              <FullCalendarView
                events={events}
                onEventUpdate={handleEventUpdate}
                onEventClick={handleEventClick}
                onDateSelect={handleDateSelect}
                isUpdating={isUpdating}
              />
            </div>
          </TabsContent>

          {isAdmin && (
            <TabsContent value="team" className="mt-4 md:mt-6">
              <div className="card-premium p-2 md:p-3">
                <TeamAvailabilityView teamEvents={teamEvents} />
              </div>
            </TabsContent>
          )}
        </Tabs>
      </div>

      {selectedEvent && (
        <EventDetailDialog
          event={selectedEvent}
          open={!!selectedEvent}
          onOpenChange={(open) => !open && setSelectedEvent(null)}
        />
      )}
    </div>
  );
}
