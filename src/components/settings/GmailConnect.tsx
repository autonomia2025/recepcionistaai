import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useGmailConnection } from '@/hooks/useGmailConnection';
import { useWorkshop } from '@/hooks/useWorkshopData';
import { supabase } from '@/integrations/supabase/client';
import { Mail, Unlink, ExternalLink, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

export function GmailConnect() {
  const {
    isConnected,
    gmailEmail,
    isConnecting,
    isDisconnecting,
    initiateConnection,
    disconnect,
    refetch
  } = useGmailConnection();

  const { data: workshop } = useWorkshop();
  const { toast } = useToast();

  const [emailRemindersEnabled, setEmailRemindersEnabled] = useState(false);
  const [senderName, setSenderName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (workshop) {
      setEmailRemindersEnabled(workshop.email_reminders_enabled ?? false);
      setSenderName(workshop.email_sender_name ?? workshop.name ?? '');
    }
  }, [workshop]);

  const handleSaveSettings = async () => {
    if (!workshop?.id) return;
    
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('workshops')
        .update({
          email_reminders_enabled: emailRemindersEnabled,
          email_sender_name: senderName
        })
        .eq('id', workshop.id);

      if (error) throw error;

      await refetch();
      toast({
        title: 'Guardado',
        description: 'Configuración de correo actualizada'
      });
    } catch (error) {
      console.error('Error saving email settings:', error);
      toast({
        title: 'Error',
        description: 'No se pudo guardar la configuración',
        variant: 'destructive'
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isConnected) {
    return (
      <Card className="border-green-200 bg-green-50/50 dark:bg-green-950/20 dark:border-green-800">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-lg bg-green-100 dark:bg-green-900 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div className="min-w-0 flex-1">
                <CardTitle className="text-base">Gmail conectado</CardTitle>
                <CardDescription className="truncate">
                  {gmailEmail}
                </CardDescription>
              </div>
            </div>
            <Badge variant="outline" className="bg-green-100 text-green-700 border-green-200 dark:bg-green-900 dark:text-green-300 dark:border-green-700 self-start sm:self-auto flex-shrink-0">
              Conectado
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Sender Name */}
          <div className="space-y-2">
            <Label htmlFor="senderName">Nombre del remitente</Label>
            <Input
              id="senderName"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              placeholder="Nombre que verán los clientes"
            />
            <p className="text-xs text-muted-foreground">
              Aparecerá como: {senderName || 'Tu Empresa'} &lt;{gmailEmail}&gt;
            </p>
          </div>

          {/* Email Reminders Toggle */}
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <div className="space-y-0.5">
              <Label htmlFor="emailReminders">Recordatorios por email</Label>
              <p className="text-xs text-muted-foreground">
                Enviar recordatorios automáticos de citas (24h y 3h antes)
              </p>
            </div>
            <Switch
              id="emailReminders"
              checked={emailRemindersEnabled}
              onCheckedChange={setEmailRemindersEnabled}
            />
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveSettings}
              disabled={isSaving}
              className="w-full sm:w-auto"
            >
              {isSaving ? 'Guardando...' : 'Guardar cambios'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={disconnect}
              disabled={isDisconnecting}
              className="w-full sm:w-auto text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Unlink className="h-4 w-4 mr-2" />
              {isDisconnecting ? 'Desconectando...' : 'Desconectar'}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
            <Mail className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <CardTitle className="text-base">Conectar Gmail</CardTitle>
            <CardDescription>
              Envía correos a tus clientes desde tu cuenta
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg mb-4">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800 dark:text-amber-200">
            <p className="font-medium">Gmail no conectado</p>
            <p className="text-xs mt-1 text-amber-700 dark:text-amber-300">
              Los recordatorios automáticos por email están desactivados
            </p>
          </div>
        </div>
        
        <p className="text-sm text-muted-foreground mb-4">
          Conecta tu cuenta de Gmail para enviar confirmaciones, recordatorios y notificaciones a tus clientes.
        </p>
        
        <Button
          onClick={initiateConnection}
          disabled={isConnecting}
          className="w-full sm:w-auto"
        >
          <ExternalLink className="h-4 w-4 mr-2" />
          {isConnecting ? 'Conectando...' : 'Conectar con Gmail'}
        </Button>
      </CardContent>
    </Card>
  );
}
