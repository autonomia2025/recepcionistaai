import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, CalendarCheck, MessageSquare, AlertTriangle } from 'lucide-react';

const notificationIcons: Record<string, React.ReactNode> = {
  'new_appointment': <CalendarCheck className="h-4 w-4 text-green-500" />,
  'appointment_reminder': <Bell className="h-4 w-4 text-emerald-500" />,
  'new_message': <MessageSquare className="h-4 w-4 text-primary" />,
  'urgent': <AlertTriangle className="h-4 w-4 text-destructive" />,
};

export function NotificationToast() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!profile?.workshop_id) return;

    const channel = supabase
      .channel('notification-toast')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `workshop_id=eq.${profile.workshop_id}`,
        },
        (payload) => {
          const notification = payload.new as {
            id: string;
            title: string;
            message: string | null;
            type: string;
          };

          // Show toast notification
          toast({
            title: notification.title,
            description: notification.message || undefined,
            duration: 5000,
          });

          // Invalidate notifications query to update bell count
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.workshop_id, toast, queryClient]);

  return null;
}
