import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { es } from 'date-fns/locale';
import { Calendar, Users, CheckCircle2, XCircle } from 'lucide-react';
import { CalendarEvent } from '@/hooks/useCalendarEvents';
import { EventDetailDialog } from './EventDetailDialog';

const TIMEZONE = 'America/Santiago';

interface TeamMember {
  id: string;
  full_name: string;
  email: string;
  google_calendar_connected?: boolean;
}

interface TeamEvent extends CalendarEvent {
  profiles?: TeamMember | null;
}

interface TeamAvailabilityViewProps {
  teamEvents: TeamEvent[];
  teamMembers?: TeamMember[];
}

export function TeamAvailabilityView({ teamEvents, teamMembers = [] }: TeamAvailabilityViewProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(toZonedTime(new Date(), TIMEZONE));
  const [selectedMember, setSelectedMember] = useState<string>('all');
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Get unique team members from events or use provided list
  const uniqueMembers = teamMembers.length > 0 
    ? teamMembers 
    : Array.from(
        new Map(
          teamEvents
            .filter(e => e.profiles)
            .map(e => [e.profiles!.id, e.profiles!])
        ).values()
      );

  // Get week days in Santiago timezone
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  // Filter events by selected member
  const filteredEvents = selectedMember === 'all' 
    ? teamEvents 
    : teamEvents.filter(e => e.user_id === selectedMember);

  // Get events for a specific day and member (using Santiago timezone)
  const getEventsForDayAndMember = (day: Date, memberId: string) => {
    return filteredEvents.filter(e => {
      const eventDate = toZonedTime(new Date(e.start_time), TIMEZONE);
      return isSameDay(eventDate, day) && e.user_id === memberId;
    });
  };

  const handleEventClick = (event: TeamEvent) => {
    setSelectedEvent(event);
    setDialogOpen(true);
  };

  const formatEventTime = (dateStr: string) => {
    const date = toZonedTime(new Date(dateStr), TIMEZONE);
    return format(date, 'HH:mm');
  };

  // Check if member has calendar connected
  const getMemberCalendarStatus = (member: TeamMember) => {
    return member.google_calendar_connected ?? false;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">Disponibilidad del Equipo</CardTitle>
          </div>
          <Select value={selectedMember} onValueChange={setSelectedMember}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="Filtrar por miembro" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los miembros</SelectItem>
              {uniqueMembers.map(member => (
                <SelectItem key={member.id} value={member.id}>
                  {member.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {/* Week Navigation */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setSelectedDate(d => new Date(d.getTime() - 7 * 24 * 60 * 60 * 1000))}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Semana anterior
          </button>
          <span className="font-medium">
            {format(weekStart, "d MMM", { locale: es })} - {format(weekEnd, "d MMM yyyy", { locale: es })}
          </span>
          <button
            onClick={() => setSelectedDate(d => new Date(d.getTime() + 7 * 24 * 60 * 60 * 1000))}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Semana siguiente →
          </button>
        </div>

        <ScrollArea className="h-[400px]">
          <div className="space-y-4">
            {uniqueMembers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">No hay miembros del equipo con calendarios conectados</p>
              </div>
            ) : (
              uniqueMembers
                .filter(m => selectedMember === 'all' || m.id === selectedMember)
                .map(member => (
                  <div key={member.id} className="border rounded-lg p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs">
                          {member.full_name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <p className="font-medium text-sm">{member.full_name}</p>
                        <p className="text-xs text-muted-foreground">{member.email}</p>
                      </div>
                      {getMemberCalendarStatus(member) ? (
                        <Badge variant="outline" className="text-green-600 border-green-200">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Conectado
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          <XCircle className="h-3 w-3 mr-1" />
                          Sin conectar
                        </Badge>
                      )}
                    </div>

                    {/* Week grid for this member */}
                    <div className="grid grid-cols-7 gap-1">
                      {weekDays.map(day => {
                        const dayEvents = getEventsForDayAndMember(day, member.id);
                        const todayInSantiago = toZonedTime(new Date(), TIMEZONE);
                        const isToday = isSameDay(day, todayInSantiago);
                        
                        return (
                          <div 
                            key={day.toISOString()}
                            className={`p-2 rounded text-center ${
                              isToday ? 'bg-primary/10 ring-1 ring-primary' : 'bg-muted/50'
                            }`}
                          >
                            <p className="text-xs font-medium mb-1">
                              {format(day, 'EEE', { locale: es })}
                            </p>
                            <p className="text-xs text-muted-foreground mb-2">
                              {format(day, 'd')}
                            </p>
                            {dayEvents.length > 0 ? (
                              <div className="space-y-1">
                                {dayEvents.slice(0, 3).map(event => (
                                  <div
                                    key={event.id}
                                    onClick={() => handleEventClick(event)}
                                    className="text-[10px] bg-emerald-100 text-emerald-700 rounded px-1 py-0.5 truncate cursor-pointer hover:bg-emerald-200 transition-colors"
                                    title={event.title}
                                  >
                                    {formatEventTime(event.start_time)}
                                  </div>
                                ))}
                                {dayEvents.length > 3 && (
                                  <p className="text-[10px] text-muted-foreground">
                                    +{dayEvents.length - 3} más
                                  </p>
                                )}
                              </div>
                            ) : (
                              <p className="text-[10px] text-green-600">Libre</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
            )}
          </div>
        </ScrollArea>

        {/* Event Detail Dialog */}
        <EventDetailDialog
          event={selectedEvent}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      </CardContent>
    </Card>
  );
}
