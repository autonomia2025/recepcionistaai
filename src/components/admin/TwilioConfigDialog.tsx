import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Check, Copy, Loader2, Phone, Wifi, WifiOff } from 'lucide-react';

interface Workshop {
  id: string;
  name: string;
  whatsapp_provider?: string;
  twilio_phone_number?: string | null;
  twilio_phone_sid?: string | null;
  whatsapp_connected?: boolean;
  whatsapp_connected_at?: string | null;
}

interface TwilioConfigDialogProps {
  workshop: Workshop | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TwilioConfigDialog({ workshop, open, onOpenChange }: TwilioConfigDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [phoneNumber, setPhoneNumber] = useState(workshop?.twilio_phone_number || '');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Twilio Webhook URL
  const twilioWebhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/twilio-webhook`;

  useEffect(() => {
    if (workshop) {
      setPhoneNumber(workshop.twilio_phone_number || '');
    }
  }, [workshop?.id]);

  const verifyMutation = useMutation({
    mutationFn: async () => {
      if (!workshop) throw new Error('No workshop selected');
      const phone = phoneNumber.trim();
      
      if (!phone) throw new Error('Ingresa un número de teléfono');

      const { data, error } = await supabase.functions.invoke('verify-twilio', {
        body: {
          workshop_id: workshop.id,
          phone_number: phone,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Verification failed');
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin-workshops'] });
      toast({ 
        title: '✅ Twilio conectado', 
        description: `Número ${data.phone_number} verificado y conectado` 
      });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: 'Error de verificación', description: error.message, variant: 'destructive' });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      if (!workshop) throw new Error('No workshop selected');
      const { error } = await supabase
        .from('workshops')
        .update({ 
          whatsapp_connected: false, 
          whatsapp_connected_at: null,
          twilio_phone_number: null,
          twilio_phone_sid: null,
        })
        .eq('id', workshop.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-workshops'] });
      toast({ title: 'Desconectado', description: 'Twilio WhatsApp ha sido desconectado' });
      setPhoneNumber('');
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const copyToClipboard = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  if (!workshop) return null;

  const isConnected = workshop.whatsapp_connected && workshop.whatsapp_provider === 'twilio';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isConnected ? (
              <Wifi className="w-5 h-5 text-green-500" />
            ) : (
              <WifiOff className="w-5 h-5 text-muted-foreground" />
            )}
            Configurar Twilio WhatsApp - {workshop.name}
          </DialogTitle>
          <DialogDescription>
            Conecta un número de WhatsApp vía Twilio para este taller
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {isConnected && (
            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="font-medium text-green-600">Conectado vía Twilio</span>
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => disconnectMutation.mutate()} 
                  disabled={disconnectMutation.isPending}
                >
                  Desconectar
                </Button>
              </div>
              {workshop.twilio_phone_number && (
                <p className="text-sm text-muted-foreground mt-2">
                  <Phone className="w-4 h-4 inline mr-1" />
                  {workshop.twilio_phone_number}
                </p>
              )}
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="twilioPhone">Número de WhatsApp Twilio</Label>
              <Input 
                id="twilioPhone" 
                type="tel" 
                value={phoneNumber} 
                onChange={(e) => setPhoneNumber(e.target.value)} 
                placeholder="Ej: +14155238886"
                disabled={isConnected}
              />
              <p className="text-xs text-muted-foreground">
                Ingresa el número de WhatsApp de tu cuenta Twilio en formato E.164 (con +)
              </p>
            </div>
          </div>

          {/* Twilio Webhook Config */}
          <div className="space-y-3 p-4 bg-muted rounded-lg">
            <h4 className="font-medium text-sm">Configuración en Twilio Console</h4>
            <p className="text-xs text-muted-foreground">
              Configura este webhook en tu cuenta de Twilio (console.twilio.com) → WhatsApp Sandbox o Senders:
            </p>
            
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Webhook URL (When a message comes in)</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-background p-2 rounded border truncate">
                  {twilioWebhookUrl}
                </code>
                <Button variant="ghost" size="icon" onClick={() => copyToClipboard(twilioWebhookUrl, 'webhook')}>
                  {copiedField === 'webhook' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            <div className="text-xs text-muted-foreground space-y-1">
              <p><strong>Método:</strong> HTTP POST</p>
              <p><strong>Sandbox:</strong> Si usas sandbox, el número es whatsapp:+14155238886</p>
            </div>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
            <p className="text-xs text-amber-700 dark:text-amber-400">
              <strong>Nota:</strong> Las credenciales de Twilio (Account SID y Auth Token) ya están configuradas 
              globalmente. Solo necesitas asignar el número de WhatsApp a este taller.
            </p>
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            {!isConnected && (
              <Button 
                onClick={() => verifyMutation.mutate()} 
                disabled={verifyMutation.isPending || !phoneNumber.trim()}
              >
                {verifyMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Verificar y Conectar
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}