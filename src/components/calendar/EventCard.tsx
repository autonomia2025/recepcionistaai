import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarEvent } from '@/hooks/useCalendarEvents';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { es } from 'date-fns/locale';
import { Clock, ExternalLink } from 'lucide-react';

const TIMEZONE = 'America/Santiago';

interface EventCardProps {
  event: CalendarEvent;
  onClick?: () => void;
  compact?: boolean;
}

const eventTypeLabels: Record<string, string> = {
  appointment: 'Cita',
  external: 'Google',
  blocked: 'Bloqueo',
  personal: 'Personal'
};

const eventTypeStyles: Record<string, { border: string; badge: string }> = {
  appointment: { border: 'border-l-emerald-500', badge: 'bg-emerald-100 text-emerald-700' },
  external: { border: 'border-l-amber-500', badge: 'bg-amber-100 text-amber-700' },
  blocked: { border: 'border-l-gray-500', badge: 'bg-gray-100 text-gray-700' },
  personal: { border: 'border-l-green-500', badge: 'bg-green-100 text-green-700' }
};

// Format time in Santiago timezone
const formatTime = (dateStr: string) => {
  const date = toZonedTime(new Date(dateStr), TIMEZONE);
  return format(date, 'HH:mm');
};

export function EventCard({ event, onClick, compact = false }: EventCardProps) {
  const style = eventTypeStyles[event.event_type] || eventTypeStyles.appointment;

  if (compact) {
    return (
      <div
        onClick={onClick}
        className={`p-2.5 sm:p-3 rounded-lg border border-l-4 ${style.border} cursor-pointer hover:shadow-sm transition-all touch-manipulation active:scale-[0.98] bg-card`}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-sm truncate flex-1 min-w-0">{event.title}</p>
          {event.google_event_id && (
            <ExternalLink className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
          <Clock className="h-3 w-3 flex-shrink-0" />
          <span className="truncate">
            {event.is_all_day
              ? 'Todo el día'
              : `${formatTime(event.start_time)} - ${formatTime(event.end_time)}`
            }
          </span>
        </div>
      </div>
    );
  }

  return (
    <Card
      onClick={onClick}
      className={`border-l-4 ${style.border} cursor-pointer hover:shadow-md transition-all touch-manipulation active:scale-[0.99]`}
    >
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{event.title}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3 flex-shrink-0" />
                <span>
                  {event.is_all_day
                    ? 'Todo el día'
                    : `${formatTime(event.start_time)} - ${formatTime(event.end_time)}`
                  }
                </span>
              </div>
              {event.google_event_id && (
                <ExternalLink className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              )}
            </div>
            {event.description && (
              <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                {event.description}
              </p>
            )}
          </div>
          <Badge variant="secondary" className={`text-xs flex-shrink-0 whitespace-nowrap ${style.badge}`}>
            {eventTypeLabels[event.event_type] || event.event_type}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
