import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Database } from '@/integrations/supabase/types';

// Quotes sent by email from the panel (F4): the sending domain, the emails of
// each quote and the customer's replies.

export type QuoteEmail = Database['public']['Tables']['quote_emails']['Row'];
export type QuoteEmailReply = Omit<Database['public']['Tables']['quote_email_replies']['Row'], 'attachments'> & {
  attachments: Array<{ filename: string; content_type: string; size: number; path: string }>;
};

export interface DomainRecord {
  record: string;
  type: string;
  host: string;
  value: string;
  priority: number | null;
  status: string;
}

export type EmailDomain = Omit<Database['public']['Tables']['workshop_email_domains']['Row'], 'records'> & {
  records: DomainRecord[];
};

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    // Surface the function's own message instead of the generic HTTP one.
    const payload = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(payload?.error ?? error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export function useEmailDomain() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ['email-domain', profile?.workshop_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('workshop_email_domains').select('*').eq('workshop_id', profile!.workshop_id!).maybeSingle();
      if (error) throw error;
      return data as unknown as EmailDomain | null;
    },
    enabled: !!profile?.workshop_id,
  });
}

export function useEmailReady() {
  const { data } = useEmailDomain();
  return data?.status === 'verified' ? data : null;
}

export function useEmailDomainAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { action: 'get' | 'setup' | 'verify'; domain?: string; sender_local?: string }) =>
      invoke<{ domain: EmailDomain | null; warning?: string }>('quote-email-domain', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['email-domain'] }),
  });
}

export function useQuoteEmails(quoteId: string | null) {
  return useQuery({
    queryKey: ['quote-emails', quoteId],
    queryFn: async () => {
      const [sent, replies] = await Promise.all([
        supabase.from('quote_emails').select('*').eq('quote_id', quoteId!).order('created_at'),
        supabase.from('quote_email_replies').select('*').eq('quote_id', quoteId!).order('received_at'),
      ]);
      if (sent.error) throw sent.error;
      if (replies.error) throw replies.error;
      return { sent: (sent.data ?? []) as QuoteEmail[], replies: (replies.data ?? []) as unknown as QuoteEmailReply[] };
    },
    enabled: !!quoteId,
    refetchInterval: 60_000,
  });
}

// Unread customer replies, for badges and "Mi día". Row-level security already
// limits them to what the person may see.
export function useUnreadQuoteReplies() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ['quote-replies-unread', profile?.workshop_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quote_email_replies')
        .select('id, quote_id, service_request_id, from_address, from_name, body_text, received_at')
        .is('read_at', null)
        .order('received_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!profile?.workshop_id,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useMarkRepliesRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (quoteId: string) => {
      const { data, error } = await supabase.rpc('mark_quote_replies_read', { _quote_id: quoteId });
      if (error) throw error;
      return data;
    },
    onSuccess: (count, quoteId) => {
      if (!count) return;
      queryClient.invalidateQueries({ queryKey: ['quote-emails', quoteId] });
      queryClient.invalidateQueries({ queryKey: ['quote-replies-unread'] });
    },
  });
}

export interface SendQuoteEmailInput {
  quoteId: string;
  requestId: string | null;
  kind: 'quote' | 'answer';
  to: string[];
  cc: string[];
  subject: string;
  message: string;
  copyToMe: boolean;
}

export function useSendQuoteEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SendQuoteEmailInput) =>
      invoke<{ ok: true; marked_sent: boolean; warning: string | null }>('send-quote-email', {
        quote_id: input.quoteId,
        kind: input.kind,
        to: input.to,
        cc: input.cc,
        subject: input.subject,
        message: input.message,
        copy_to_me: input.copyToMe,
      }),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ['quote-emails', input.quoteId] });
      queryClient.invalidateQueries({ queryKey: ['quote', input.quoteId] });
      queryClient.invalidateQueries({ queryKey: ['request-quotes', input.requestId] });
      queryClient.invalidateQueries({ queryKey: ['service-requests'] });
      queryClient.invalidateQueries({ queryKey: ['client-service-requests'] });
    },
  });
}

export const EMAIL_STATUS_LABELS: Record<string, string> = {
  sending: 'Enviando',
  sent: 'Enviado',
  delivered: 'Entregado',
  delayed: 'Demorado',
  bounced: 'Rebotó',
  complained: 'Marcado como spam',
  failed: 'No salió',
};

// "a@b.cl, c@d.cl; e@f.cl" -> ["a@b.cl", "c@d.cl", "e@f.cl"]
export function splitAddresses(value: string): string[] {
  return value.split(/[,;\s]+/).map(part => part.trim()).filter(Boolean);
}

export const looksLikeEmail = (value: string) => /^[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[a-z]{2,}$/i.test(value);
