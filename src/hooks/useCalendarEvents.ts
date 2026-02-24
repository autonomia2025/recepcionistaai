import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface CalendarEvent {
  id: string;
  workshop_id: string;
  user_id: string | null;
  contact_id: string | null;
  appointment_id: string | null;
  title: string;
  description: string | null;
  event_type: string;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  google_event_id: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewCalendarEvent {
  title: string;
  description?: string;
  event_type: string;
  start_time: string;
  end_time: string;
  is_all_day?: boolean;
  contact_id?: string;
  appointment_id?: string;
}

export function useCalendarEvents() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch user's events - by user_id or workshop_id if user has one
  const { data: events = [], isLoading, refetch } = useQuery({
    queryKey: ['calendar-events', user?.id, profile?.workshop_id],
    queryFn: async () => {
      if (!user?.id) return [];

      let query = supabase
        .from('calendar_events')
        .select('*')
        .order('start_time', { ascending: true });

      // If user has a workshop, get all events for that workshop assigned to them
      // Otherwise just get their personal events
      if (profile?.workshop_id) {
        query = query.eq('workshop_id', profile.workshop_id).eq('user_id', user.id);
      } else {
        query = query.eq('user_id', user.id);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching calendar events:', error);
        throw error;
      }

      return data as CalendarEvent[];
    },
    enabled: !!user?.id
  });

  // Fetch team events (for admins)
  const { data: teamEvents = [], isLoading: isLoadingTeam } = useQuery({
    queryKey: ['team-calendar-events', profile?.workshop_id],
    queryFn: async () => {
      if (!profile?.workshop_id || profile.role !== 'ADMIN') return [];

      // First fetch calendar events
      const { data: events, error } = await supabase
        .from('calendar_events')
        .select('*')
        .eq('workshop_id', profile.workshop_id)
        .order('start_time', { ascending: true });

      if (error) {
        console.error('Error fetching team calendar events:', error);
        throw error;
      }

      // Get unique user IDs
      const userIds = [...new Set(events.map(e => e.user_id).filter(Boolean))];

      // Fetch profiles for these users via safe RPC (excludes tokens)
      const { data: profiles } = await supabase
        .rpc('get_workshop_profiles', { _workshop_id: profile.workshop_id! });

      // Map events with their profiles
      return events.map(event => ({
        ...event,
        profiles: profiles?.find(p => p.id === event.user_id) || null
      }));
    },
    enabled: !!profile?.workshop_id && profile.role === 'ADMIN'
  });

  // Create event mutation
  const createEventMutation = useMutation({
    mutationFn: async (newEvent: NewCalendarEvent) => {
      if (!user?.id || !profile?.workshop_id) {
        throw new Error('User or workshop not found');
      }

      const { data, error } = await supabase
        .from('calendar_events')
        .insert({
          ...newEvent,
          workshop_id: profile.workshop_id,
          user_id: user.id
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      // Trigger sync in background
      supabase.functions.invoke('google-calendar-sync');

      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
      toast({
        title: 'Evento creado',
        description: 'Sincronizando con Google Calendar...'
      });
    },
    onError: (error) => {
      console.error('Error creating event:', error);
      toast({
        title: 'Error',
        description: 'No se pudo crear el evento',
        variant: 'destructive'
      });
    }
  });

  // Update event mutation
  const updateEventMutation = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<CalendarEvent> & { id: string }) => {
      const { data, error } = await supabase
        .from('calendar_events')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      // Trigger sync in background
      supabase.functions.invoke('google-calendar-sync');

      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
      toast({
        title: 'Evento actualizado',
        description: 'Sincronizando con Google Calendar...'
      });
    },
    onError: (error) => {
      console.error('Error updating event:', error);
      toast({
        title: 'Error',
        description: 'No se pudo actualizar el evento',
        variant: 'destructive'
      });
    }
  });

  // Delete event mutation
  const deleteEventMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('calendar_events')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      // Trigger sync in background
      supabase.functions.invoke('google-calendar-sync');

      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
      toast({
        title: 'Evento eliminado',
        description: 'El evento ha sido eliminado correctamente'
      });
    },
    onError: (error) => {
      console.error('Error deleting event:', error);
      toast({
        title: 'Error',
        description: 'No se pudo eliminar el evento',
        variant: 'destructive'
      });
    }
  });

  return {
    events,
    teamEvents,
    isLoading,
    isLoadingTeam,
    refetch,
    createEvent: createEventMutation.mutateAsync,
    updateEvent: updateEventMutation.mutateAsync,
    deleteEvent: deleteEventMutation.mutateAsync,
    isCreating: createEventMutation.isPending,
    isUpdating: updateEventMutation.isPending,
    isDeleting: deleteEventMutation.isPending
  };
}
