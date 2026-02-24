import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useEffect, useCallback } from 'react';
import { useBrowserNotifications } from './useBrowserNotifications';

export interface Notification {
  id: string;
  workshop_id: string;
  user_id: string | null;
  appointment_id: string | null;
  type: string;
  title: string;
  message: string | null;
  is_read: boolean;
  read_at: string | null;
  notes: string | null;
  created_at: string;
}

export function useNotifications() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const { notifyHumanRequest, permissionStatus, requestPermission } = useBrowserNotifications();

  const { data: notifications = [], isLoading, refetch } = useQuery({
    queryKey: ['notifications', profile?.workshop_id],
    queryFn: async () => {
      if (!profile?.workshop_id) return [];

      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('workshop_id', profile.workshop_id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Error fetching notifications:', error);
        throw error;
      }

      return data as Notification[];
    },
    enabled: !!profile?.workshop_id
  });

  // Subscribe to realtime updates and show browser notification
  useEffect(() => {
    if (!profile?.workshop_id) return;

    const channel = supabase
      .channel('notifications-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `workshop_id=eq.${profile.workshop_id}`
        },
        (payload) => {
          console.log('New notification:', payload);
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
          
          // Show browser notification for human handoff requests
          const newNotification = payload.new as Notification;
          if (newNotification.type === 'human_handoff') {
            notifyHumanRequest(
              newNotification.title,
              newNotification.message || undefined
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.workshop_id, queryClient, notifyHumanRequest]);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', notificationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }
  });

  const addNoteMutation = useMutation({
    mutationFn: async ({ notificationId, notes }: { notificationId: string; notes: string }) => {
      const { error } = await supabase
        .from('notifications')
        .update({ notes, is_read: true, read_at: new Date().toISOString() })
        .eq('id', notificationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }
  });

  const markAllAsRead = useMutation({
    mutationFn: async () => {
      if (!profile?.workshop_id) return;
      
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('workshop_id', profile.workshop_id)
        .eq('is_read', false);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }
  });

  return {
    notifications,
    unreadCount,
    isLoading,
    refetch,
    markAsRead: markAsReadMutation.mutateAsync,
    addNote: addNoteMutation.mutateAsync,
    markAllAsRead: markAllAsRead.mutateAsync,
    // Browser notification helpers
    browserNotificationPermission: permissionStatus,
    requestBrowserNotificationPermission: requestPermission,
  };
}
