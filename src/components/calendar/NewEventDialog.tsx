import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format, setHours, setMinutes } from 'date-fns';
import { es } from 'date-fns/locale';
import { CalendarIcon, Plus, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NewEventDialogProps {
  onCreateEvent: (event: {
    title: string;
    description?: string;
    event_type: string;
    start_time: string;
    end_time: string;
    is_all_day: boolean;
  }) => Promise<unknown>;
  isCreating?: boolean;
  trigger?: React.ReactNode;
  defaultStartDate?: Date;
  defaultEndDate?: Date;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const eventTypes = [
  { value: 'appointment', label: 'Cita' },
  { value: 'blocked', label: 'Bloqueo' },
  { value: 'personal', label: 'Personal' },
];

const timeOptions = Array.from({ length: 24 * 2 }, (_, i) => {
  const hours = Math.floor(i / 2);
  const minutes = (i % 2) * 30;
  return {
    value: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`,
    label: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
  };
});

export function NewEventDialog({ 
  onCreateEvent, 
  isCreating, 
  trigger,
  defaultStartDate,
  defaultEndDate,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange
}: NewEventDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [eventType, setEventType] = useState('appointment');
  const [date, setDate] = useState<Date>(new Date());
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [isAllDay, setIsAllDay] = useState(false);

  // Update form when defaults change (from calendar selection)
  useEffect(() => {
    if (defaultStartDate) {
      setDate(defaultStartDate);
      setStartTime(format(defaultStartDate, 'HH:mm'));
    }
    if (defaultEndDate) {
      setEndTime(format(defaultEndDate, 'HH:mm'));
    }
  }, [defaultStartDate, defaultEndDate]);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setEventType('appointment');
    setDate(new Date());
    setStartTime('09:00');
    setEndTime('10:00');
    setIsAllDay(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const [startHour, startMin] = startTime.split(':').map(Number);
    const [endHour, endMin] = endTime.split(':').map(Number);

    let startDateTime = setMinutes(setHours(date, startHour), startMin);
    let endDateTime = setMinutes(setHours(date, endHour), endMin);

    if (isAllDay) {
      startDateTime = setMinutes(setHours(date, 0), 0);
      endDateTime = setMinutes(setHours(date, 23), 59);
    }

    await onCreateEvent({
      title: title.trim(),
      description: description.trim() || undefined,
      event_type: eventType,
      start_time: startDateTime.toISOString(),
      end_time: endDateTime.toISOString(),
      is_all_day: isAllDay,
    });

    resetForm();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Nuevo evento
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Crear nuevo evento</DialogTitle>
            <DialogDescription>Agrega un nuevo evento a tu calendario</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="title">Título</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nombre del evento" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="type">Tipo de evento</Label>
              <Select value={eventType} onValueChange={setEventType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {eventTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Fecha</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('justify-start text-left font-normal', !date && 'text-muted-foreground')}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, "PPP", { locale: es }) : 'Seleccionar fecha'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={date} onSelect={(d) => d && setDate(d)} locale={es} initialFocus />
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="all-day">Todo el día</Label>
              <Switch id="all-day" checked={isAllDay} onCheckedChange={setIsAllDay} />
            </div>
            {!isAllDay && (
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="start-time">Hora inicio</Label>
                  <Select value={startTime} onValueChange={setStartTime}>
                    <SelectTrigger><Clock className="h-4 w-4 mr-2" /><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-[200px]">
                      {timeOptions.map((time) => (<SelectItem key={time.value} value={time.value}>{time.label}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="end-time">Hora fin</Label>
                  <Select value={endTime} onValueChange={setEndTime}>
                    <SelectTrigger><Clock className="h-4 w-4 mr-2" /><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-[200px]">
                      {timeOptions.map((time) => (<SelectItem key={time.value} value={time.value}>{time.label}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="description">Descripción (opcional)</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Notas o detalles adicionales" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={isCreating || !title.trim()}>{isCreating ? 'Creando...' : 'Crear evento'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
