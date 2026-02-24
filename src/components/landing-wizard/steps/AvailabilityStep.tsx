import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Clock, Coffee } from 'lucide-react';
import { LandingConfig } from '@/hooks/useLandingWizard';

export interface AvailabilityStepProps {
  config: LandingConfig | null;
  onUpdate: (data: Partial<LandingConfig>) => void;
}

const DAYS = [
  { key: 'monday', label: 'Lunes' },
  { key: 'tuesday', label: 'Martes' },
  { key: 'wednesday', label: 'Miércoles' },
  { key: 'thursday', label: 'Jueves' },
  { key: 'friday', label: 'Viernes' },
  { key: 'saturday', label: 'Sábado' },
  { key: 'sunday', label: 'Domingo' },
];

const DEFAULT_SCHEDULE = {
  monday: { enabled: true, start: '09:00', end: '18:00' },
  tuesday: { enabled: true, start: '09:00', end: '18:00' },
  wednesday: { enabled: true, start: '09:00', end: '18:00' },
  thursday: { enabled: true, start: '09:00', end: '18:00' },
  friday: { enabled: true, start: '09:00', end: '18:00' },
  saturday: { enabled: false, start: '09:00', end: '14:00' },
  sunday: { enabled: false, start: '09:00', end: '14:00' },
};

export function AvailabilityStep({ config, onUpdate }: AvailabilityStepProps) {
  const [schedule, setSchedule] = useState<Record<string, { enabled: boolean; start: string; end: string }>>(
    (config?.default_schedule as Record<string, { enabled: boolean; start: string; end: string }>) || DEFAULT_SCHEDULE
  );
  const [lunchEnabled, setLunchEnabled] = useState(!!(config?.lunch_break_start && config?.lunch_break_end));
  const [lunchStart, setLunchStart] = useState(config?.lunch_break_start || '13:00');
  const [lunchEnd, setLunchEnd] = useState(config?.lunch_break_end || '14:00');
  const [buffer, setBuffer] = useState(config?.buffer_minutes || 15);

  useEffect(() => {
    if (config) {
      setSchedule((config.default_schedule as Record<string, { enabled: boolean; start: string; end: string }>) || DEFAULT_SCHEDULE);
      setLunchEnabled(!!(config.lunch_break_start && config.lunch_break_end));
      setLunchStart(config.lunch_break_start || '13:00');
      setLunchEnd(config.lunch_break_end || '14:00');
      setBuffer(config.buffer_minutes || 15);
    }
  }, [config]);

  const updateDay = (day: string, field: string, value: string | boolean) => {
    const newSchedule = {
      ...schedule,
      [day]: { ...schedule[day], [field]: value },
    };
    setSchedule(newSchedule);
    onUpdate({ default_schedule: newSchedule });
  };

  const handleLunchToggle = (enabled: boolean) => {
    setLunchEnabled(enabled);
    if (enabled) {
      onUpdate({ lunch_break_start: lunchStart, lunch_break_end: lunchEnd });
    } else {
      onUpdate({ lunch_break_start: null, lunch_break_end: null });
    }
  };

  const handleLunchChange = (field: 'start' | 'end', value: string) => {
    if (field === 'start') {
      setLunchStart(value);
      if (lunchEnabled) onUpdate({ lunch_break_start: value || null });
    } else {
      setLunchEnd(value);
      if (lunchEnabled) onUpdate({ lunch_break_end: value || null });
    }
  };

  const handleBufferChange = (value: number) => {
    setBuffer(value);
    onUpdate({ buffer_minutes: value });
  };

  const enabledDays = DAYS.filter(d => schedule[d.key]?.enabled);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Form */}
      <div className="space-y-6">
        <div className="card-premium p-6">
          <h2 className="text-2xl font-semibold mb-2">Disponibilidad</h2>
          <p className="text-muted-foreground">
            Define los horarios en que tus clientes pueden agendar
          </p>
        </div>

        {/* Weekly schedule */}
        <Card className="p-4 bg-background/80">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-primary" />
            <h3 className="font-medium">Horario Semanal</h3>
          </div>
          
          <div className="space-y-3">
            {DAYS.map((day) => (
              <div key={day.key} className="flex items-center gap-4">
                <div className="w-24">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={schedule[day.key]?.enabled}
                      onCheckedChange={(checked) => updateDay(day.key, 'enabled', checked)}
                    />
                    <Label className="text-sm">{day.label}</Label>
                  </div>
                </div>
                {schedule[day.key]?.enabled && (
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      type="time"
                      value={schedule[day.key]?.start}
                      onChange={(e) => updateDay(day.key, 'start', e.target.value)}
                      className="w-28"
                    />
                    <span className="text-muted-foreground">a</span>
                    <Input
                      type="time"
                      value={schedule[day.key]?.end}
                      onChange={(e) => updateDay(day.key, 'end', e.target.value)}
                      className="w-28"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* Lunch break */}
        <Card className="p-4 bg-background/80">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Coffee className="w-5 h-5 text-primary" />
              <h3 className="font-medium">Pausa / Colación</h3>
            </div>
            <Switch
              checked={lunchEnabled}
              onCheckedChange={handleLunchToggle}
            />
          </div>
          
          {lunchEnabled ? (
            <>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">Inicio</Label>
                  <Input
                    type="time"
                    value={lunchStart}
                    onChange={(e) => handleLunchChange('start', e.target.value)}
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">Fin</Label>
                  <Input
                    type="time"
                    value={lunchEnd}
                    onChange={(e) => handleLunchChange('end', e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Horario de descanso donde no se agendan citas (máximo 2 horas)
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sin pausa configurada — las citas se agendan de corrido
            </p>
          )}
        </Card>

        {/* Buffer */}
        <Card className="p-4 bg-background/80">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">Tiempo entre citas</h3>
              <p className="text-sm text-muted-foreground">
                Minutos de descanso entre cada cita agendada
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={buffer}
                onChange={(e) => handleBufferChange(parseInt(e.target.value) || 0)}
                className="w-20 text-center"
                min={0}
                max={60}
              />
              <span className="text-sm text-muted-foreground">min</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Preview */}
      <div className="lg:sticky lg:top-4">
        <div className="section-title mb-3">Resumen</div>
        <Card className="p-6">
          <h3 className="font-semibold mb-4">Horarios de Atención</h3>
          
          {enabledDays.length === 0 ? (
            <p className="text-muted-foreground">No hay días habilitados</p>
          ) : (
            <div className="space-y-2">
              {enabledDays.map((day) => (
                <div key={day.key} className="flex justify-between text-sm">
                  <span className="font-medium">{day.label}</span>
                  <span className="text-muted-foreground">
                    {schedule[day.key]?.start} - {schedule[day.key]?.end}
                  </span>
                </div>
              ))}
            </div>
          )}

          {(lunchStart && lunchEnd) && (
            <div className="mt-4 pt-4 border-t">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Pausa</span>
                <span>{lunchStart} - {lunchEnd}</span>
              </div>
            </div>
          )}

          {buffer > 0 && (
            <div className="mt-4 pt-4 border-t">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Buffer entre citas</span>
                <span>{buffer} minutos</span>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
