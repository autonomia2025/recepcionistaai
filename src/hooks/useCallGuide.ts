import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface CallGuideContent {
  opening: string | null;
  known: Array<{ fact: string; evidence: string }>;
  missing: string[];
  profile: { label: string; evidence: string } | null;
  objections: Array<{ objection: string; answer: string; source: string | null }>;
}

export interface CallGuide {
  id: string;
  service_request_id: string;
  content: CallGuideContent;
  last_message_at: string | null;
  generated_at: string;
}

export function useCallGuide(requestId: string, conversationId: string | null) {
  const guide = useQuery({
    queryKey: ['call-guide', requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lead_call_guides')
        .select('id, service_request_id, content, last_message_at, generated_at')
        .eq('service_request_id', requestId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as CallGuide | null;
    },
  });

  // New messages since the guide was written → offer to refresh it.
  const latest = useQuery({
    queryKey: ['call-guide-latest-message', conversationId],
    queryFn: async () => {
      const { data } = await supabase.from('conversations').select('last_message_at').eq('id', conversationId!).maybeSingle();
      return data?.last_message_at ?? null;
    },
    enabled: !!conversationId,
  });

  const stale = !!guide.data?.last_message_at && !!latest.data && new Date(latest.data) > new Date(guide.data.last_message_at);
  return { guide, stale };
}

export function useGenerateCallGuide(requestId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (force: boolean) => {
      const { data, error } = await supabase.functions.invoke('generate-call-guide', {
        body: { service_request_id: requestId, force },
      });
      if (error) {
        // Surface the function's own message instead of the generic HTTP one.
        const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
        throw new Error(body?.error ?? error.message);
      }
      return data as { guide: CallGuide | null; reason?: string };
    },
    onSuccess: data => {
      queryClient.setQueryData(['call-guide', requestId], data.guide);
      queryClient.invalidateQueries({ queryKey: ['call-guide-feedback'] });
    },
  });
}

export function useCallGuideFeedback(guideId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const mine = useQuery({
    queryKey: ['call-guide-feedback', guideId, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('lead_call_guide_feedback')
        .select('useful, comment')
        .eq('guide_id', guideId!)
        .eq('user_id', user!.id)
        .maybeSingle();
      return data;
    },
    enabled: !!guideId && !!user,
  });

  const save = useMutation({
    mutationFn: async ({ useful, comment }: { useful: boolean; comment?: string | null }) => {
      const { error } = await supabase
        .from('lead_call_guide_feedback')
        .upsert({ guide_id: guideId!, useful, comment: comment?.trim() || null, updated_at: new Date().toISOString() }, { onConflict: 'guide_id,user_id' });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['call-guide-feedback', guideId] }),
  });

  return { mine, save };
}
