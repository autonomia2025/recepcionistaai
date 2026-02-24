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
import { Check, Copy, Loader2, Wifi, WifiOff } from 'lucide-react';

interface Workshop {
  id: string;
  name: string;
  whatsapp_phone_number_id?: string | null;
  whatsapp_business_account_id?: string | null;
  whatsapp_access_token?: string | null;
  whatsapp_verify_token?: string | null;
  whatsapp_connected?: boolean;
  whatsapp_connected_at?: string | null;
}

interface WhatsAppConfigDialogProps {
  workshop: Workshop | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WhatsAppConfigDialog({ workshop, open, onOpenChange }: WhatsAppConfigDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [phoneNumberId, setPhoneNumberId] = useState(workshop?.whatsapp_phone_number_id || '');
  const [businessAccountId, setBusinessAccountId] = useState(workshop?.whatsapp_business_account_id || '');
  const [accessToken, setAccessToken] = useState(workshop?.whatsapp_access_token || '');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Meta Webhook URL (único para todos los talleres)
  const metaWebhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-webhook`;

  useEffect(() => {
    if (workshop) {
      setPhoneNumberId(workshop.whatsapp_phone_number_id || '');
      setBusinessAccountId(workshop.whatsapp_business_account_id || '');
      setAccessToken(workshop.whatsapp_access_token || '');
    }
  }, [workshop?.id]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!workshop) throw new Error('No workshop selected');
      const phoneId = phoneNumberId.trim();
      const businessId = businessAccountId.trim();
      const token = accessToken.trim();
      
      const { error } = await supabase
        .from('workshops')
        .update({
          whatsapp_phone_number_id: phoneId || null,
          whatsapp_business_account_id: businessId || null,
          whatsapp_access_token: token || null,
        })
        .eq('id', workshop.id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-workshops'] });
      toast({ title: 'Guardado', description: 'Credenciales guardadas correctamente' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      if (!workshop) throw new Error('No workshop selected');
      const phoneId = phoneNumberId.trim();
      const businessId = businessAccountId.trim();

      const { data, error } = await supabase.functions.invoke('verify-whatsapp', {
        body: {
          workshop_id: workshop.id,
          phone_number_id: phoneId,
          whatsapp_business_account_id: businessId,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Verification failed');
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin-workshops'] });
      toast({ title: '✅ Conexión verificada', description: `Conectado a ${data.verified_name || data.phone_number}` });
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
        .update({ whatsapp_connected: false, whatsapp_connected_at: null })
        .eq('id', workshop.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-workshops'] });
      toast({ title: 'Desconectado', description: 'WhatsApp ha sido desconectado' });
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {workshop.whatsapp_connected ? <Wifi className="w-5 h-5 text-green-500" /> : <WifiOff className="w-5 h-5 text-muted-foreground" />}
            Configurar WhatsApp - {workshop.name}
          </DialogTitle>
          <DialogDescription>Configura la integración con WhatsApp Business API</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {workshop.whatsapp_connected && (
            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="font-medium text-green-600">Conectado</span>
                </div>
                <Button variant="outline" size="sm" onClick={() => disconnectMutation.mutate()} disabled={disconnectMutation.isPending}>
                  Desconectar
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phoneNumberId">Phone Number ID</Label>
              <Input id="phoneNumberId" type="text" inputMode="numeric" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value.replace(/\D/g, ''))} placeholder="Ej: 123456789012345" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="businessAccountId">Business Account ID</Label>
              <Input id="businessAccountId" type="text" inputMode="numeric" value={businessAccountId} onChange={(e) => setBusinessAccountId(e.target.value.replace(/\D/g, ''))} placeholder="Ej: 123456789012345" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="accessToken">Access Token (opcional si usas token global)</Label>
              <Input id="accessToken" type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="Token de acceso permanente" />
            </div>
          </div>

          {/* Meta Webhook Config */}
          <div className="space-y-3 p-4 bg-muted rounded-lg">
            <h4 className="font-medium text-sm">Configuración en Meta</h4>
            <p className="text-xs text-muted-foreground">Configura este webhook en tu App de Meta (developers.facebook.com):</p>
            
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Callback URL</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-background p-2 rounded border truncate">{metaWebhookUrl}</code>
                <Button variant="ghost" size="icon" onClick={() => copyToClipboard(metaWebhookUrl, 'webhook')}>
                  {copiedField === 'webhook' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            <div className="text-xs text-muted-foreground space-y-1">
              <p><strong>Verify Token:</strong> Usa el valor de tu secret WEBHOOK_VERIFY_TOKEN</p>
              <p><strong>Suscribir a:</strong> messages</p>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Guardar
            </Button>
            <Button onClick={() => verifyMutation.mutate()} disabled={verifyMutation.isPending || !phoneNumberId}>
              {verifyMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Verificar Conexión
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
