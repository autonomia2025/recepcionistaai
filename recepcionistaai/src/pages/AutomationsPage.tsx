import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';

import { Separator } from '@/components/ui/separator';
import { useAutomationSettings } from '@/hooks/useAutomationSettings';
import { useWorkshop } from '@/hooks/useWorkshopData';
import { useWorkshopMode } from '@/hooks/useWorkshopMode';
import { Mail, Info, Save, Loader2, Sun, Timer, AlertCircle } from 'lucide-react';

const VARIABLE_DESCRIPTIONS = [
  { variable: '{{nombre}}', description: 'Nombre del cliente' },
  { variable: '{{fecha}}', description: 'Fecha de la cita (ej: "15 de enero")' },
  { variable: '{{hora}}', description: 'Hora de la cita (ej: "10:30")' },
  { variable: '{{servicio}}', description: 'Tipo de servicio' },
  { variable: '{{direccion}}', description: 'Dirección del taller' },
  { variable: '{{telefono}}', description: 'Teléfono del taller' },
  { variable: '{{taller}}', description: 'Nombre del taller' },
];

const DEFAULT_24H_SUBJECT = 'Recordatorio: Tu cita mañana en {{taller}}';
const DEFAULT_24H_BODY = `Hola {{nombre}},

Te recordamos que tienes una cita agendada para mañana:

📆 Fecha: {{fecha}}
🕐 Hora: {{hora}}
🔧 Servicio: {{servicio}}
📍 Dirección: {{direccion}}

Si necesitas cancelar o reprogramar, por favor contáctanos con anticipación.

¡Te esperamos!

{{taller}}
{{telefono}}`;

const DEFAULT_3H_SUBJECT = 'Tu cita es en 3 horas - {{taller}}';
const DEFAULT_3H_BODY = `Hola {{nombre}},

Tu cita es en 3 horas. ¡Te esperamos!

🕐 Hora: {{hora}}
🔧 Servicio: {{servicio}}
📍 Dirección: {{direccion}}

{{taller}}
{{telefono}}`;

export default function AutomationsPage() {
  const { settings, isLoading, updateSettings, isUpdating } = useAutomationSettings();
  const { data: workshop } = useWorkshop();
  
  const [confirm24h, setConfirm24h] = useState(true);
  const [remind3h, setRemind3h] = useState(true);
  const [reminder24hSubject, setReminder24hSubject] = useState(DEFAULT_24H_SUBJECT);
  const [reminder24hBody, setReminder24hBody] = useState(DEFAULT_24H_BODY);
  const [reminder3hSubject, setReminder3hSubject] = useState(DEFAULT_3H_SUBJECT);
  const [reminder3hBody, setReminder3hBody] = useState(DEFAULT_3H_BODY);

  const gmailConnected = workshop?.gmail_connected ?? false;
  const emailRemindersEnabled = workshop?.email_reminders_enabled ?? false;

  // Load settings into state when data arrives
  useEffect(() => {
    if (settings) {
      setConfirm24h(settings.confirm_24h);
      setRemind3h(settings.remind_3h);
      setReminder24hSubject(settings.reminder_24h_subject || DEFAULT_24H_SUBJECT);
      setReminder24hBody(settings.reminder_24h_body || DEFAULT_24H_BODY);
      setReminder3hSubject(settings.reminder_3h_subject || DEFAULT_3H_SUBJECT);
      setReminder3hBody(settings.reminder_3h_body || DEFAULT_3H_BODY);
    }
  }, [settings]);

  const handleSave = async () => {
    await updateSettings({
      confirm_24h: confirm24h,
      remind_3h: remind3h,
      reminder_24h_subject: reminder24hSubject,
      reminder_24h_body: reminder24hBody,
      reminder_3h_subject: reminder3hSubject,
      reminder_3h_body: reminder3hBody
    });
  };

  const hasChanges = settings && (
    confirm24h !== settings.confirm_24h ||
    remind3h !== settings.remind_3h ||
    reminder24hSubject !== (settings.reminder_24h_subject || DEFAULT_24H_SUBJECT) ||
    reminder24hBody !== (settings.reminder_24h_body || DEFAULT_24H_BODY) ||
    reminder3hSubject !== (settings.reminder_3h_subject || DEFAULT_3H_SUBJECT) ||
    reminder3hBody !== (settings.reminder_3h_body || DEFAULT_3H_BODY)
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="page-shell page-stack max-w-4xl">
      <PageHeader 
        title="Recordatorios por Email" 
        description="Configura los emails automáticos que se envían antes de cada cita" 
        actions={
          <Button onClick={handleSave} disabled={isUpdating || !hasChanges}>
            {isUpdating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Guardar cambios
          </Button>
        }
      />

      {/* Warning if Gmail not connected */}
      {(!gmailConnected || !emailRemindersEnabled) && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertCircle className="h-5 w-5 text-amber-600" />
            <div className="text-sm text-amber-800 dark:text-amber-200">
              {!gmailConnected 
                ? 'Conecta Gmail en Correo y Notificaciones para activar los recordatorios automáticos.'
                : 'Activa "Recordatorios por email" en Correo y Notificaciones para que se envíen automáticamente.'}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 24h Reminder Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <Sun className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  Recordatorio 24 horas antes
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                    <Mail className="h-3 w-3" />
                    Email
                  </span>
                </CardTitle>
                <CardDescription>Envía un email un día antes de la cita</CardDescription>
              </div>
            </div>
            <Switch checked={confirm24h} onCheckedChange={setConfirm24h} />
          </div>
        </CardHeader>
        {confirm24h && (
          <CardContent className="space-y-4 pt-0">
            <Separator />
            
            <div className="space-y-2">
              <Label>Asunto del email</Label>
              <Input
                value={reminder24hSubject}
                onChange={(e) => setReminder24hSubject(e.target.value)}
                placeholder="Recordatorio: Tu cita mañana en {{taller}}"
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label>Contenido del email</Label>
              <Textarea
                value={reminder24hBody}
                onChange={(e) => setReminder24hBody(e.target.value)}
                placeholder="Escribe el mensaje de recordatorio..."
                className="min-h-[200px] font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Usa las variables de abajo para personalizar el mensaje.
              </p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* 3h Reminder Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
                <Timer className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  Recordatorio 3 horas antes
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                    <Mail className="h-3 w-3" />
                    Email
                  </span>
                </CardTitle>
                <CardDescription>Envía un email de última hora antes de la cita</CardDescription>
              </div>
            </div>
            <Switch checked={remind3h} onCheckedChange={setRemind3h} />
          </div>
        </CardHeader>
        {remind3h && (
          <CardContent className="space-y-4 pt-0">
            <Separator />
            
            <div className="space-y-2">
              <Label>Asunto del email</Label>
              <Input
                value={reminder3hSubject}
                onChange={(e) => setReminder3hSubject(e.target.value)}
                placeholder="Tu cita es en 3 horas - {{taller}}"
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label>Contenido del email</Label>
              <Textarea
                value={reminder3hBody}
                onChange={(e) => setReminder3hBody(e.target.value)}
                placeholder="Escribe el mensaje de recordatorio..."
                className="min-h-[200px] font-mono text-sm"
              />
            </div>
          </CardContent>
        )}
      </Card>

      {/* Variables Reference Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-4 w-4" />
            Variables disponibles
          </CardTitle>
          <CardDescription>
            Usa estas variables en tus mensajes y serán reemplazadas automáticamente
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {VARIABLE_DESCRIPTIONS.map(({ variable, description }) => (
              <div 
                key={variable} 
                className="flex items-center gap-2 p-2 rounded-lg bg-muted/50"
              >
                <code className="text-xs font-mono bg-primary/10 text-primary px-2 py-0.5 rounded">
                  {variable}
                </code>
                <span className="text-xs text-muted-foreground">{description}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
