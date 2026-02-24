import { useState } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CalendarEvent } from '@/hooks/useCalendarEvents';
import { format, isSameDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { es } from 'date-fns/locale';
import { Clock, CalendarDays } from 'lucide-react';

const TIMEZONE = 'America/Santiago';

interface CalendarViewProps {
  events: CalendarEvent[];
  onDateSelect?: (date: Date) => void;
  onEventClick?: (event: CalendarEvent) => void;
}

const eventTypeColors: Record<string, { bg: string; text: string; dot: string }> = {
  appointment: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  external: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  blocked: { bg: 'bg-gray-50', text: 'text-gray-700', dot: 'bg-gray-500' },
  personal: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' }
};

export function CalendarView({ events, onDateSelect, onEventClick }: CalendarViewProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(toZonedTime(new Date(), TIMEZONE));
  const [currentMonth, setCurrentMonth] = useState<Date>(toZonedTime(new Date(), TIMEZONE));

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      setSelectedDate(date);
      onDateSelect?.(date);
    }
  };

  // Get events for selected date (comparing in Santiago timezone)
  const eventsForSelectedDate = events.filter(event => {
    const eventDate = toZonedTime(new Date(event.start_time), TIMEZONE);
    return isSameDay(eventDate, selectedDate);
  });

  // Get dates that have events (for calendar dots) in Santiago timezone
  const datesWithEvents = new Set(
    events.map(event => {
      const eventDate = toZonedTime(new Date(event.start_time), TIMEZONE);
      return format(eventDate, 'yyyy-MM-dd');
    })
  );

  const getEventTypeStyle = (type: string) => {
    return eventTypeColors[type] || eventTypeColors.appointment;
  };

  // Format event time in Santiago timezone
  const formatEventTime = (dateStr: string) => {
    const date = toZonedTime(new Date(dateStr), TIMEZONE);
    return format(date, 'HH:mm');
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 md:gap-6">
      {/* Calendar */}
      <Card className="flex-1 min-w-0">
        <CardContent className="p-2 sm:p-4">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleDateSelect}
            month={currentMonth}
            onMonthChange={setCurrentMonth}
            locale={es}
            className="w-full [&_.rdp-months]:justify-center [&_.rdp-month]:w-full [&_.rdp-table]:w-full [&_.rdp-cell]:w-[14.28%] [&_.rdp-head_cell]:w-[14.28%] [&_.rdp-day]:w-full [&_.rdp-day]:h-10 sm:[&_.rdp-day]:h-12 [&_.rdp-nav]:touch-manipulation"
            modifiers={{
              hasEvent: (date) => datesWithEvents.has(format(date, 'yyyy-MM-dd'))
            }}
            modifiersStyles={{
              hasEvent: {
                fontWeight: 'bold',
                textDecoration: 'underline',
                textDecorationColor: 'hsl(var(--primary))',
                textUnderlineOffset: '4px'
              }
            }}
          />
        </CardContent>
      </Card>

      {/* Events for selected date */}
      <Card className="lg:w-72 xl:w-80 flex-shrink-0">
        <CardHeader className="pb-3 px-3 sm:px-6">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm sm:text-base truncate">
              {format(selectedDate, "EEEE d 'de' MMM", { locale: es })}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-3 sm:px-6">
          <ScrollArea className="h-[200px] sm:h-[280px] lg:h-[320px]">
            {eventsForSelectedDate.length === 0 ? (
              <div className="text-center py-6 sm:py-8 text-muted-foreground">
                <CalendarDays className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No hay eventos</p>
              </div>
            ) : (
              <div className="space-y-2 sm:space-y-3">
                {eventsForSelectedDate.map(event => {
                  const style = getEventTypeStyle(event.event_type);
                  return (
                    <div
                      key={event.id}
                      onClick={() => onEventClick?.(event)}
                      className={`p-2.5 sm:p-3 rounded-lg border cursor-pointer hover:shadow-md transition-shadow touch-manipulation active:scale-[0.98] ${style.bg}`}
                    >
                      <div className="flex items-start gap-2">
                        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${style.dot}`} />
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium text-sm leading-tight truncate ${style.text}`}>
                            {event.title}
                          </p>
                          {!event.is_all_day && (
                            <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3 flex-shrink-0" />
                              <span>
                                {formatEventTime(event.start_time)} - {formatEventTime(event.end_time)}
                              </span>
                            </div>
                          )}
                          {event.is_all_day && (
                            <Badge variant="secondary" className="text-xs mt-1">
                              Todo el día
                            </Badge>
                          )}
                          {event.description && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {event.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
