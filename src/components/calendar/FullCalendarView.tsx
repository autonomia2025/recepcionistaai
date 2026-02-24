import { useCallback, useMemo } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { EventDropArg, DateSelectArg, EventClickArg } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import esLocale from '@fullcalendar/core/locales/es';
import { CalendarEvent } from '@/hooks/useCalendarEvents';
import { Card } from '@/components/ui/card';
import './fullcalendar-custom.css';

interface FullCalendarViewProps {
  events: CalendarEvent[];
  onEventUpdate: (event: { id: string; start_time: string; end_time: string }) => Promise<void>;
  onEventClick?: (event: CalendarEvent) => void;
  onDateSelect?: (start: Date, end: Date) => void;
  isUpdating?: boolean;
}

const EVENT_TYPE_COLORS: Record<string, { backgroundColor: string; borderColor: string; textColor: string }> = {
  appointment: { backgroundColor: '#3B82F6', borderColor: '#2563EB', textColor: '#FFFFFF' },
  external: { backgroundColor: '#8B5CF6', borderColor: '#7C3AED', textColor: '#FFFFFF' },
  blocked: { backgroundColor: '#6B7280', borderColor: '#4B5563', textColor: '#FFFFFF' },
  personal: { backgroundColor: '#22C55E', borderColor: '#16A34A', textColor: '#FFFFFF' }
};

export function FullCalendarView({
  events,
  onEventUpdate,
  onEventClick,
  onDateSelect,
  isUpdating
}: FullCalendarViewProps) {
  // Transform CalendarEvent[] to FullCalendar format
  const calendarEvents = useMemo(() => {
    return events.map(event => {
      const colors = EVENT_TYPE_COLORS[event.event_type] || EVENT_TYPE_COLORS.appointment;
      return {
        id: event.id,
        title: event.title,
        start: event.start_time,
        end: event.end_time,
        allDay: event.is_all_day,
        extendedProps: {
          description: event.description,
          event_type: event.event_type,
          contact_id: event.contact_id,
          appointment_id: event.appointment_id,
          google_event_id: event.google_event_id,
          originalEvent: event
        },
        ...colors
      };
    });
  }, [events]);

  const handleEventDrop = useCallback(async (info: EventDropArg) => {
    const { event, revert } = info;
    
    if (!event.start || !event.end) {
      revert();
      return;
    }

    try {
      await onEventUpdate({
        id: event.id,
        start_time: event.start.toISOString(),
        end_time: event.end.toISOString()
      });
    } catch (error) {
      console.error('Error updating event:', error);
      revert();
    }
  }, [onEventUpdate]);

  const handleEventResize = useCallback(async (info: EventResizeDoneArg) => {
    const { event, revert } = info;
    
    if (!event.start || !event.end) {
      revert();
      return;
    }

    try {
      await onEventUpdate({
        id: event.id,
        start_time: event.start.toISOString(),
        end_time: event.end.toISOString()
      });
    } catch (error) {
      console.error('Error resizing event:', error);
      revert();
    }
  }, [onEventUpdate]);

  const handleEventClick = useCallback((info: EventClickArg) => {
    const originalEvent = info.event.extendedProps.originalEvent as CalendarEvent;
    onEventClick?.(originalEvent);
  }, [onEventClick]);

  const handleDateSelect = useCallback((info: DateSelectArg) => {
    onDateSelect?.(info.start, info.end);
  }, [onDateSelect]);

  return (
    <Card className={`p-2 sm:p-4 ${isUpdating ? 'opacity-70 pointer-events-none' : ''}`}>
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        locale={esLocale}
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
          right: 'dayGridMonth,timeGridWeek,timeGridDay'
        }}
        events={calendarEvents}
        editable={true}
        droppable={true}
        selectable={true}
        selectMirror={true}
        dayMaxEvents={true}
        weekends={true}
        nowIndicator={true}
        eventDrop={handleEventDrop}
        eventResize={handleEventResize}
        eventClick={handleEventClick}
        select={handleDateSelect}
        slotMinTime="07:00:00"
        slotMaxTime="21:00:00"
        slotDuration="00:30:00"
        height="auto"
        contentHeight="auto"
        aspectRatio={1.8}
        allDaySlot={true}
        allDayText="Todo el día"
        buttonText={{
          today: 'Hoy',
          month: 'Mes',
          week: 'Semana',
          day: 'Día'
        }}
        eventTimeFormat={{
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }}
        slotLabelFormat={{
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }}
        eventDisplay="block"
        eventClassNames={(arg) => {
          return [`fc-event-${arg.event.extendedProps.event_type || 'appointment'}`];
        }}
      />
    </Card>
  );
}
