import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { CommercialFacts } from '@/lib/insights';

// Facts are computed by the database when the screen opens (and on refresh),
// so the sentences are always current.
export function useCommercialFacts(scope: 'team' | 'me') {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ['commercial-facts', scope, profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('commercial_facts', { _scope: scope });
      if (error) throw error;
      return data as unknown as CommercialFacts;
    },
    enabled: !!profile?.id,
    refetchOnWindowFocus: true,
  });
}
