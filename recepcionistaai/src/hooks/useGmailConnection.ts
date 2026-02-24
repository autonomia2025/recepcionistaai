import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useWorkshop } from '@/hooks/useWorkshopData';
import { useToast } from '@/hooks/use-toast';

export function useGmailConnection() {
  const { data: workshop, refetch } = useWorkshop();
  const { toast } = useToast();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const isConnected = workshop?.gmail_connected ?? false;
  const gmailEmail = workshop?.gmail_email ?? null;

  const initiateConnection = useCallback(async () => {
    setIsConnecting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        throw new Error('No hay sesión activa. Por favor, inicia sesión primero.');
      }

      const { data, error } = await supabase.functions.invoke('gmail-auth', {
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`
        }
      });

      if (error) {
        throw error;
      }

      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (error: any) {
      console.error('Error initiating Gmail connection:', error);
      toast({
        title: 'Error',
        description: error.message || 'No se pudo iniciar la conexión con Gmail',
        variant: 'destructive'
      });
      setIsConnecting(false);
    }
  }, [toast]);

  const disconnect = useCallback(async () => {
    setIsDisconnecting(true);
    try {
      const { error } = await supabase.functions.invoke('gmail-disconnect');

      if (error) {
        throw error;
      }

      await refetch();
      toast({
        title: 'Desconectado',
        description: 'Gmail ha sido desconectado correctamente'
      });
    } catch (error) {
      console.error('Error disconnecting Gmail:', error);
      toast({
        title: 'Error',
        description: 'No se pudo desconectar Gmail',
        variant: 'destructive'
      });
    } finally {
      setIsDisconnecting(false);
    }
  }, [refetch, toast]);

  return {
    isConnected,
    gmailEmail,
    isConnecting,
    isDisconnecting,
    initiateConnection,
    disconnect,
    refetch
  };
}
