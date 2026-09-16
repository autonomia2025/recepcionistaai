import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Database } from '@/integrations/supabase/types';

export type CommercialSettings = Database['public']['Tables']['commercial_settings']['Row'];
export type CommercialSettingsUpdate = Database['public']['Tables']['commercial_settings']['Update'];

export function useCommercialSettings() {
  const { profile } = useAuth();
  const workshopId = profile?.workshop_id ?? null;
  const queryClient = useQueryClient();
  const queryKey = ['commercial-settings', workshopId];

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<CommercialSettings> => {
      // The RPC creates the row with defaults the first time and returns it afterwards.
      const { data, error } = await supabase.rpc('ensure_commercial_settings', { _workshop_id: workshopId! });
      if (error) throw error;
      return data as CommercialSettings;
    },
    enabled: !!workshopId,
  });

  const update = useMutation({
    mutationFn: async (changes: CommercialSettingsUpdate) => {
      const { data, error } = await supabase
        .from('commercial_settings')
        .update(changes)
        .eq('workshop_id', workshopId!)
        .select()
        .single();
      if (error) throw error;
      return data as CommercialSettings;
    },
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
  });

  return { settings: query.data, isLoading: query.isLoading, error: query.error, update, workshopId };
}
