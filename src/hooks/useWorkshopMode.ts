import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type BookingMode = 'with_scheduling' | 'chatbot_only';

interface WorkshopModeData {
  booking_mode: BookingMode;
  category: string | null;
  name: string | null;
}

export function useWorkshopMode() {
  const { profile } = useAuth();
  
  return useQuery({
    queryKey: ['workshop-mode', profile?.workshop_id],
    queryFn: async (): Promise<WorkshopModeData> => {
      if (!profile?.workshop_id) {
        return { booking_mode: 'with_scheduling', category: null, name: null };
      }
      
      const { data, error } = await supabase
        .from('workshops')
        .select('booking_mode, category, name')
        .eq('id', profile.workshop_id)
        .single();
      
      if (error) throw error;
      
      return {
        booking_mode: (data?.booking_mode as BookingMode) || 'with_scheduling',
        category: data?.category || null,
        name: data?.name || null,
      };
    },
    enabled: !!profile?.workshop_id && profile?.role !== 'SUPERADMIN',
  });
}
