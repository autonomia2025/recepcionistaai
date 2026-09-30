import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { CommercialFacts, TeamActivity } from '@/lib/insights';
import type { InterestedRow, LeadInbox } from '@/lib/leads';

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

// How each seller works (admins only), last `days` days.
export function useTeamActivity(days = 30) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ['team-activity', days, profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('commercial_team_activity', { _days: days });
      if (error) throw error;
      return data as unknown as TeamActivity;
    },
    enabled: !!profile?.id,
    refetchOnWindowFocus: true,
  });
}

// "Mis leads" (scope 'me') or the team's leads for admins (scope 'team').
export function useLeadInbox(scope: 'me' | 'team', staffId: string | null = null) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ['lead-inbox', scope, staffId, profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('commercial_lead_inbox', { _scope: scope, _staff: staffId ?? undefined, _days: 60 });
      if (error) throw error;
      return data as unknown as LeadInbox;
    },
    enabled: !!profile?.id,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export interface EmailThreadRow {
  contact_id: string;
  client: string;
  company: string | null;
  request_id: string | null;
  sellers: string[] | null;
  seller_ids: string[] | null;
  email_count: number;
  sent: number;
  received: number;
  from_panel: number;
  last_email_at: string;
  last_direction: 'in' | 'out';
  last_preview: string | null;
  last_subject: string | null;
}

// "Correos del equipo" (admins).
export function useEmailThreads(staffId: string | null, days = 30) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ['email-threads', staffId, days, profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('commercial_email_threads', { _staff: staffId ?? undefined, _days: days });
      if (error) throw error;
      return data as unknown as { days: number; threads: EmailThreadRow[] };
    },
    enabled: !!profile?.id,
    refetchInterval: 60_000,
  });
}

// "Interesados": clients with questions or asking prices, not yet a lead.
export function useInterested() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ['interested', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('commercial_interested');
      if (error) throw error;
      return (data ?? []) as unknown as InterestedRow[];
    },
    enabled: !!profile?.id,
    refetchInterval: 120_000,
  });
}

export function useTakeInterested() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contactId: string) => {
      const { data, error } = await supabase.rpc('take_interested_lead', { _contact_id: contactId });
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['interested'] });
      queryClient.invalidateQueries({ queryKey: ['lead-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['service-requests'] });
    },
  });
}
