import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface WorkshopFeatures {
  zones: boolean;
  commercial: boolean;
}

const NO_FEATURES: WorkshopFeatures = { zones: false, commercial: false };

export function useWorkshopFeatures(workshopId?: string | null) {
  const { profile } = useAuth();
  const id = workshopId ?? profile?.workshop_id ?? null;

  const { data, isLoading } = useQuery({
    queryKey: ['workshop-features', id],
    queryFn: async (): Promise<WorkshopFeatures> => {
      const { data, error } = await supabase
        .from('workshops_safe')
        .select('features')
        .eq('id', id!)
        .maybeSingle();

      if (error) throw error;
      const raw = (data?.features ?? {}) as Record<string, unknown>;
      return { zones: raw.zones === true, commercial: raw.commercial === true };
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

  return { features: data ?? NO_FEATURES, isLoading: !!id && isLoading };
}
