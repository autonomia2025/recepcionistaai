import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useEffect } from 'react';

export interface Conversation {
  id: string;
  workshop_id: string;
  contact_id: string;
  status: 'new' | 'in_progress' | 'booked' | 'closed' | 'lost';
  assigned_to_user_id: string | null;
  last_message_at: string | null;
  created_at: string;
  ai_summary: string | null;
  last_message_text?: string | null;
  sentiment: string | null;
  bot_paused: boolean;
  contacts: {
    id: string;
    name: string;
    phone: string | null;
    whatsapp_id: string | null;
    email: string | null;
    lead_score: number;
    detected_intent: string | null;
    intent_confidence: number | null;
    should_recontact: boolean;
    recontact_at: string | null;
    recontact_reason: string | null;
    did_schedule: boolean | null;
    schedule_confidence: number | null;
    lead_score_reasoning: string | null;
    last_analyzed_at: string | null;
    vehicle_brand: string | null;
    vehicle_model: string | null;
    vehicle_year: number | null;
    tags: string[] | null;
    notes: string | null;
    created_at: string;
  };
  assigned_to: {
    id: string;
    full_name: string;
  } | null;
}

export function useConversations() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const isAdmin = profile?.role === 'ADMIN' || profile?.role === 'SUPERADMIN';

  const query = useQuery({
    queryKey: ['conversations', profile?.workshop_id, profile?.id, isAdmin],
    queryFn: async () => {
      if (!profile?.workshop_id) return [];

      let queryBuilder = supabase
        .from('conversations')
        .select(`
          id,
          workshop_id,
          contact_id,
          status,
          assigned_to_user_id,
          last_message_at,
          last_message_text,
          created_at,
          ai_summary,
          sentiment,
          bot_paused,
          contacts!inner(
            id,
            name,
            phone,
            whatsapp_id,
            email,
            lead_score,
            detected_intent,
            intent_confidence,
            should_recontact,
            recontact_at,
            recontact_reason,
            did_schedule,
            schedule_confidence,
            lead_score_reasoning,
            last_analyzed_at,
            vehicle_brand,
            vehicle_model,
            vehicle_year,
            tags,
            notes,
            created_at
          ),
          assigned_to:profiles!conversations_assigned_to_user_id_fkey(
            id,
            full_name
          )
        `)
        .eq('workshop_id', profile.workshop_id)
        .order('last_message_at', { ascending: false, nullsFirst: false });

      // Staff only sees conversations assigned to them
      if (!isAdmin && profile?.id) {
        queryBuilder = queryBuilder.eq('assigned_to_user_id', profile.id);
      }

      const { data, error } = await queryBuilder;

      if (error) throw error;
      return data as unknown as Conversation[];
    },
    enabled: !!profile?.workshop_id,
  });

  // Real-time subscription for conversations AND contacts (for AI analysis updates)
  useEffect(() => {
    if (!profile?.workshop_id) return;

    const conversationsChannel = supabase
      .channel('conversations-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `workshop_id=eq.${profile.workshop_id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['conversations', profile.workshop_id] });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'contacts',
          filter: `workshop_id=eq.${profile.workshop_id}`,
        },
        () => {
          // Refresh conversations when contacts are updated (AI analysis updates lead_score, intent, etc.)
          queryClient.invalidateQueries({ queryKey: ['conversations', profile.workshop_id] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(conversationsChannel);
    };
  }, [profile?.workshop_id, queryClient]);

  return query;
}
