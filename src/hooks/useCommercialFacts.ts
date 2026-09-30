import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { CommercialFacts, TeamActivity } from '@/lib/insights';
import type { InterestedRow, LeadInbox } from '@/lib/leads';
import type { Database } from '@/integrations/supabase/types';

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

// "Qué hacer ahora" (F5): the active next action of each visible lead.
export type NextAction = Database['public']['Tables']['lead_next_actions']['Row'];

export function useActiveNextActions() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ['next-actions', profile?.workshop_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('lead_next_actions').select('*').eq('active', true);
      if (error) throw error;
      return new Map((data ?? []).map(a => [a.service_request_id, a as NextAction]));
    },
    enabled: !!profile?.workshop_id,
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
  });
}

async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const payload = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(payload?.error ?? error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export function useRefreshNextAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => invokeFn<{ action: NextAction }>('generate-next-action', { service_request_id: requestId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['next-actions'] }),
  });
}

export function useCompleteNextAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note?: string }) => {
      const { error } = await supabase.rpc('complete_next_action', { _id: id, _note: note ?? undefined });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['next-actions'] }),
  });
}

// "Qué hacer hoy" in Mi día: my suggested actions due today or overdue.
export function useMyActionsToday() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['next-actions', 'mine-today', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('lead_next_actions')
        .select('*, contacts(name, company_name)')
        .eq('active', true).eq('staff_id', user!.id).is('done_at', null)
        .order('due_date');
      if (error) throw error;
      const today = new Date().toLocaleDateString('en-CA');
      return ((data ?? []) as unknown as Array<NextAction & { contacts: { name: string; company_name: string | null } | null }>)
        .filter(a => a.due_date <= today);
    },
    enabled: !!user?.id,
    refetchInterval: 120_000,
  });
}
