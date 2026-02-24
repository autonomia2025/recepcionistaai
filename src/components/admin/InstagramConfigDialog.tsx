import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Instagram, Copy, Check, ExternalLink, Unlink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Workshop {
  id: string;
  name: string;
  instagram_connected?: boolean;
  instagram_page_id?: string;
  instagram_access_token?: string;
  instagram_connected_at?: string;
}

interface InstagramConfigDialogProps {
  workshop: Workshop | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InstagramConfigDialog({
  workshop,
  open,
  onOpenChange,
}: InstagramConfigDialogProps) {
  const [pageId, setPageId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const instagramWebhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/instagram-webhook`;
  const verifyToken = 'instagram_webhook_verify';

  useEffect(() => {
    if (workshop) {
      setPageId(workshop.instagram_page_id || '');
      setAccessToken(workshop.instagram_access_token || '');
    }
  }, [workshop]);

  const verifyMutation = useMutation({
    mutationFn: async () => {
      if (!workshop) throw new Error('No workshop selected');
      
      const { data, error } = await supabase.functions.invoke('verify-instagram', {
        body: {
          workshop_id: workshop.id,
          page_id: pageId,
          access_token: accessToken,
        },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Instagram conectado: @${data.username}`);
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast.error(`Error al verificar: ${error.message}`);
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      if (!workshop) throw new Error('No workshop selected');
      
      const { error } = await supabase
        .from('workshops')
        .update({
          instagram_connected: false,
          instagram_page_id: null,
          instagram_access_token: null,
          instagram_connected_at: null,
        })
        .eq('id', workshop.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Instagram desconectado');
      setPageId('');
      setAccessToken('');
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast.error(`Error al desconectar: ${error.message}`);
    },
  });

  const copyToClipboard = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
    toast.success('Copiado al portapapeles');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Instagram className="w-5 h-5" />
            Configurar Instagram
          </DialogTitle>
          <DialogDescription>
            Conecta la cuenta de Instagram Business de {workshop?.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Connection Status */}
          {workshop?.instagram_connected && (
            <div className="p-3 bg-success/10 border border-success/30 rounded-lg">
              <p className="text-sm text-success font-medium">
                ✓ Instagram conectado
              </p>
              <p className="text-xs text-success/80 mt-1">
                Desde: {new Date(workshop.instagram_connected_at!).toLocaleDateString()}
              </p>
            </div>
          )}

          {/* Webhook URL */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Webhook URL</Label>
            <div className="flex gap-2">
              <Input
                value={instagramWebhookUrl}
                readOnly
                className="font-mono text-xs bg-muted"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(instagramWebhookUrl, 'webhook')}
              >
                {copiedField === 'webhook' ? (
                  <Check className="w-4 h-4 text-success" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Configura este URL en la app de Meta Developers
            </p>
          </div>

          {/* Verify Token */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Verify Token</Label>
            <div className="flex gap-2">
              <Input
                value={verifyToken}
                readOnly
                className="font-mono text-xs bg-muted"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(verifyToken, 'token')}
              >
                {copiedField === 'token' ? (
                  <Check className="w-4 h-4 text-success" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Page ID */}
          <div className="space-y-2">
            <Label htmlFor="pageId" className="text-sm font-medium">
              Instagram Page ID
            </Label>
            <Input
              id="pageId"
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
              placeholder="Ej: 17841400000000000"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              ID de la página de Instagram Business
            </p>
          </div>

          {/* Access Token */}
          <div className="space-y-2">
            <Label htmlFor="accessToken" className="text-sm font-medium">
              Access Token
            </Label>
            <Input
              id="accessToken"
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="Token de acceso de la app"
            />
            <p className="text-xs text-muted-foreground">
              Token con permiso instagram_manage_messages
            </p>
          </div>

          {/* Help Link */}
          <a
            href="https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="w-3 h-3" />
            Ver guía de configuración de Meta
          </a>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          {workshop?.instagram_connected && (
            <Button
              variant="destructive"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
            >
              <Unlink className="w-4 h-4 mr-2" />
              Desconectar
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            onClick={() => verifyMutation.mutate()}
            disabled={!pageId || !accessToken || verifyMutation.isPending}
          >
            {verifyMutation.isPending ? 'Verificando...' : 'Conectar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}