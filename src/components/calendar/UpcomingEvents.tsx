import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CalendarEvent } from '@/hooks/useCalendarEvents';
import { EventCard } from './EventCard';
import { format, isToday, isTomorrow, isBefore, startOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { es } from 'date-fns/locale';
import { CalendarDays } from 'lucide-react';

const TIMEZONE = 'America/Santiago';

interface UpcomingEventsProps {
  events: CalendarEvent[];
  onEventClick?: (event: CalendarEvent) => void;
  maxEvents?: number;
}

export function UpcomingEvents({ events, onEventClick, maxEvents = 10 }: UpcomingEventsProps) {
  // Get current time in Santiago timezone
  const nowInTz = toZonedTime(new Date(), TIMEZONE);
  const todayStart = startOfDay(nowInTz);

  // Filter and sort upcoming events
  const upcomingEvents = events
    .filter(event => {
      const eventDate = toZonedTime(new Date(event.start_time), TIMEZONE);
      return !isBefore(eventDate, todayStart);
    })
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    .slice(0, maxEvents);

  // Group events by date in Santiago timezone
  const groupedEvents: { [key: string]: CalendarEvent[] } = {};
  
  upcomingEvents.forEach(event => {
    const eventDate = toZonedTime(new Date(event.start_time), TIMEZONE);
    const dateKey = format(eventDate, 'yyyy-MM-dd');
    if (!groupedEvents[dateKey]) {
      groupedEvents[dateKey] = [];
    }
    groupedEvents[dateKey].push(event);
  });

  const getDateLabel = (dateStr: string) => {
    // Parse the date key and create a date at noon to avoid timezone issues
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day, 12, 0, 0);
    
    if (isToday(date)) return 'Hoy';
    if (isTomorrow(date)) return 'Mañana';
    return format(date, "EEE d 'de' MMM", { locale: es });
  };

  return (
    <Card className="h-full">
      <CardHeader className="pb-3 px-3 sm:px-6">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground flex-shrink-0" />
          <CardTitle className="text-sm sm:text-base">Próximos eventos</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-3 sm:px-6">
        <ScrollArea className="h-[280px] sm:h-[320px] xl:h-[400px]">
          {upcomingEvents.length === 0 ? (
            <div className="text-center py-6 sm:py-8 text-muted-foreground">
              <CalendarDays className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No hay eventos próximos</p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedEvents).map(([dateKey, dayEvents]) => (
                <div key={dateKey}>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 sticky top-0 bg-card py-1">
                    {getDateLabel(dateKey)}
                  </p>
                  <div className="space-y-2">
                    {dayEvents.map(event => (
                      <EventCard
                        key={event.id}
                        event={event}
                        onClick={() => onEventClick?.(event)}
                        compact
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}