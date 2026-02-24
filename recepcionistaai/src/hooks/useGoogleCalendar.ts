import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export function useGoogleCalendar() {
  const { profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const isConnected = profile?.google_calendar_connected ?? false;
  const calendarEmail = profile?.google_calendar_email;
  const connectedAt = profile?.google_connected_at;

  const initiateConnection = useCallback(async () => {
    setIsConnecting(true);
    try {
      // Get current session to ensure we have a valid token
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        throw new Error('No hay sesión activa. Por favor, inicia sesión primero.');
      }

      const { data, error } = await supabase.functions.invoke('google-calendar-auth', {
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`
        }
      });

      if (error) {
        throw error;
      }

      if (data?.url) {
        // Redirect to Google OAuth
        window.location.href = data.url;
      }
    } catch (error: any) {
      console.error('Error initiating Google Calendar connection:', error);
      toast({
        title: 'Error',
        description: error.message || 'No se pudo iniciar la conexión con Google Calendar',
        variant: 'destructive'
      });
      setIsConnecting(false);
    }
  }, [toast]);

  const disconnect = useCallback(async () => {
    setIsDisconnecting(true);
    try {
      const { error } = await supabase.functions.invoke('google-calendar-disconnect');

      if (error) {
        throw error;
      }

      await refreshProfile();
      toast({
        title: 'Desconectado',
        description: 'Google Calendar ha sido desconectado correctamente'
      });
    } catch (error) {
      console.error('Error disconnecting Google Calendar:', error);
      toast({
        title: 'Error',
        description: 'No se pudo desconectar Google Calendar',
        variant: 'destructive'
      });
    } finally {
      setIsDisconnecting(false);
    }
  }, [refreshProfile, toast]);

  const syncCalendar = useCallback(async (eventToSync?: any) => {
    setIsSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('google-calendar-sync', {
        body: {
          direction: eventToSync ? 'to_google' : 'both',
          eventToSync
        }
      });

      if (error) {
        throw error;
      }

      toast({
        title: 'Sincronización completada',
        description: eventToSync 
          ? 'Evento sincronizado con Google Calendar'
          : `${data.syncedFromGoogle || 0} eventos sincronizados`
      });

      return data;
    } catch (error) {
      console.error('Error syncing Google Calendar:', error);
      toast({
        title: 'Error',
        description: 'No se pudo sincronizar con Google Calendar',
        variant: 'destructive'
      });
      return null;
    } finally {
      setIsSyncing(false);
    }
  }, [toast]);

  return {
    isConnected,
    calendarEmail,
    connectedAt,
    isConnecting,
    isDisconnecting,
    isSyncing,
    initiateConnection,
    disconnect,
    syncCalendar
  };
}
