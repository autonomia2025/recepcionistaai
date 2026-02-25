import { GmailConnect } from '@/components/settings/GmailConnect';
import { PageHeader } from '@/components/layout/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Mail, Bell } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWorkshop } from '@/hooks/useWorkshopData';
import { useWorkshopMode } from '@/hooks/useWorkshopMode';
import { supabase } from '@/integrations/supabase/client';
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

export default function EmailSettingsPage() {
  const { data: workshop, refetch } = useWorkshop();
  const { data: workshopMode } = useWorkshopMode();
  const { toast } = useToast();

  // Notification toggles
  const [notifyHandoff, setNotifyHandoff] = useState(false);
  const [notifyHotLead, setNotifyHotLead] = useState(false);
  const [notifyAppointment, setNotifyAppointment] = useState(false);
  const [notifyQuotation, setNotifyQuotation] = useState(false);
  const [notificationEmail, setNotificationEmail] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const isChatbotOnly = workshopMode?.booking_mode === 'chatbot_only';
  const isWithScheduling = workshopMode?.booking_mode === 'with_scheduling';

  useEffect(() => {
    if (workshop) {
      setNotifyHandoff(workshop.email_notifications_handoff ?? false);
      setNotifyHotLead(workshop.email_notifications_hot_lead ?? false);
      setNotifyAppointment(workshop.email_notifications_appointment ?? false);
      setNotifyQuotation((workshop as { email_notifications_quotation?: boolean }).email_notifications_quotation ?? false);
      setNotificationEmail((workshop as { admin_notification_email?: string }).admin_notification_email ?? workshop.gmail_email ?? '');
    }
  }, [workshop]);

  const handleSaveNotifications = async () => {
    if (!workshop?.id) return;
    
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('workshops')
        .update({
          email_notifications_handoff: notifyHandoff,
          email_notifications_hot_lead: notifyHotLead,
          email_notifications_appointment: notifyAppointment,
          email_notifications_quotation: notifyQuotation,
          admin_notification_email: notificationEmail || null
        })
        .eq('id', workshop.id);

      if (error) throw error;

      await refetch();
      toast({
        title: 'Guardado',
        description: 'Preferencias de notificaciones actualizadas'
      });
    } catch (error) {
      console.error('Error saving notification settings:', error);
      toast({
        title: 'Error',
        description: 'No se pudo guardar la configuración',
        variant: 'destructive'
      });
    } finally {
      setIsSaving(false);
    }
  };

  const gmailConnected = workshop?.gmail_connected ?? false;

  return (
    <div className="page-shell page-stack">
      <PageHeader
        title="Correo y Notificaciones"
        description="Configura el envío de emails y alertas internas"
      />

      <Tabs defaultValue="gmail" className="w-full">
        <TabsList className="grid w-full grid-cols-2 lg:w-[400px]">
          <TabsTrigger value="gmail" className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Gmail
          </TabsTrigger>
          <TabsTrigger value="notifications" className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Alertas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="gmail" className="mt-6 space-y-4">
          <GmailConnect />
        </TabsContent>

        <TabsContent value="notifications" className="mt-6 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notificaciones internas por email</CardTitle>
              <CardDescription>
                Recibe alertas cuando ocurran eventos importantes en tu negocio
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!gmailConnected && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-200">
                  Conecta Gmail primero para activar las notificaciones por email
                </div>
              )}

              {/* Recipient email */}
              <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
                <Label htmlFor="notificationEmail">📬 Email donde recibirás las alertas</Label>
                <Input
                  id="notificationEmail"
                  type="email"
                  value={notificationEmail}
                  onChange={(e) => setNotificationEmail(e.target.value)}
                  placeholder={workshop?.gmail_email || 'tu@email.com'}
                  disabled={!gmailConnected}
                />
                <p className="text-xs text-muted-foreground">
                  Si lo dejas vacío, se usará el Gmail conectado ({workshop?.gmail_email || '—'})
                </p>
              </div>

              <div className="space-y-4">
                {/* Handoff - available for ALL workshops */}
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="space-y-0.5">
                    <Label>🙋 Bot necesita humano (handoff)</Label>
                    <p className="text-xs text-muted-foreground">
                      Notificar cuando el bot no pueda resolver una consulta
                    </p>
                  </div>
                  <Switch
                    checked={notifyHandoff}
                    onCheckedChange={setNotifyHandoff}
                    disabled={!gmailConnected}
                  />
                </div>

                {/* Hot Lead - available for ALL workshops */}
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="space-y-0.5">
                    <Label>🔥 Lead caliente detectado</Label>
                    <p className="text-xs text-muted-foreground">
                      Notificar cuando se detecte intención de compra/urgencia
                    </p>
                  </div>
                  <Switch
                    checked={notifyHotLead}
                    onCheckedChange={setNotifyHotLead}
                    disabled={!gmailConnected}
                  />
                </div>

                {/* Appointment - ONLY for with_scheduling */}
                {isWithScheduling && (
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div className="space-y-0.5">
                      <Label>📅 Cita agendada</Label>
                      <p className="text-xs text-muted-foreground">
                        Notificar cuando un cliente agende una cita
                      </p>
                    </div>
                    <Switch
                      checked={notifyAppointment}
                      onCheckedChange={setNotifyAppointment}
                      disabled={!gmailConnected}
                    />
                  </div>
                )}

                {/* Quotation - ONLY for chatbot_only */}
                {isChatbotOnly && (
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div className="space-y-0.5">
                      <Label>📋 Nueva solicitud de cotización</Label>
                      <p className="text-xs text-muted-foreground">
                        Notificar cuando un cliente solicite una cotización
                      </p>
                    </div>
                    <Switch
                      checked={notifyQuotation}
                      onCheckedChange={setNotifyQuotation}
                      disabled={!gmailConnected}
                    />
                  </div>
                )}
              </div>

              <Button
                onClick={handleSaveNotifications}
                disabled={isSaving || !gmailConnected}
                className="mt-4"
              >
                {isSaving ? 'Guardando...' : 'Guardar preferencias'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
