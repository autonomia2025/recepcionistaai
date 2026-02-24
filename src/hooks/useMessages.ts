import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export interface Message {
  id: string;
  conversation_id: string;
  workshop_id: string;
  text: string;
  direction: 'inbound' | 'outbound';
  channel: string;
  created_at: string;
  metadata?: {
    intent?: string;
    confidence?: number;
    reasoning?: string;
    is_last_in_batch?: boolean;
    [key: string]: any;
  } | null;
}

export function useMessages(conversationId: string | null) {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const analysisTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastAnalyzedMessageIdRef = useRef<string | null>(null);

  // Function to trigger AI analysis
  const triggerAnalysis = useCallback(async (contactId: string) => {
    if (!conversationId) return;

    console.log('Triggering AI analysis for conversation:', conversationId);

    try {
      const { data, error } = await supabase.functions.invoke('analyze-conversation', {
        body: {
          conversation_id: conversationId,
          contact_id: contactId,
        },
      });

      if (error) {
        console.error('Analysis error:', error);
        return;
      }

      if (data?.success && !data?.skipped) {
        console.log('Analysis completed:', data.analysis);
        // Invalidate queries to refresh data
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
        queryClient.invalidateQueries({ queryKey: ['clients'] });
      }
    } catch (err) {
      console.error('Failed to analyze conversation:', err);
    }
  }, [conversationId, queryClient]);

  const query = useQuery({
    queryKey: ['messages', conversationId],
    queryFn: async () => {
      if (!conversationId) return [];

      // Use RPC to guarantee visibility of all messages (inbound + outbound)
      // for both SUPERADMIN (impersonating) and ADMIN/STAFF
      const { data, error } = await supabase
        .rpc('get_conversation_messages', { _conversation_id: conversationId });

      if (error) throw error;
      return (data || []) as Message[];
    },
    enabled: !!conversationId,
  });

  // Real-time subscription for messages with auto-analysis
  useEffect(() => {
    if (!conversationId || !profile?.workshop_id) return;

    const channel = supabase
      .channel(`messages-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload) => {
          console.log('New message received:', payload);

          // Immediately refresh messages
          queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
          queryClient.invalidateQueries({ queryKey: ['conversations'] });

          // If it's an inbound message, schedule analysis (debounced)
          const newMessage = payload.new as Message;
          if (newMessage.direction === 'inbound' && newMessage.id !== lastAnalyzedMessageIdRef.current) {
            // Clear any pending analysis
            if (analysisTimeoutRef.current) {
              clearTimeout(analysisTimeoutRef.current);
            }

            // Schedule analysis after 3 seconds (to batch multiple quick messages)
            analysisTimeoutRef.current = setTimeout(async () => {
              lastAnalyzedMessageIdRef.current = newMessage.id;

              // Get contact_id from conversation
              const { data: conv } = await supabase
                .from('conversations')
                .select('contact_id')
                .eq('id', conversationId)
                .single();

              if (conv?.contact_id) {
                triggerAnalysis(conv.contact_id);
              }
            }, 3000);
          }
        }
      )
      .subscribe();

    return () => {
      if (analysisTimeoutRef.current) {
        clearTimeout(analysisTimeoutRef.current);
      }
      supabase.removeChannel(channel);
    };
  }, [conversationId, profile?.workshop_id, queryClient, triggerAnalysis]);

  return query;
}

export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ conversationId, text }: { conversationId: string; text: string }) => {
      const { data, error } = await supabase.functions.invoke('send-whatsapp', {
        body: { conversation_id: conversationId, text },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (_, { conversationId }) => {
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}
