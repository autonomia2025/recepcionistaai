import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Database } from '@/integrations/supabase/types';

// Email with clients from each seller's own Outlook (F4): the connection,
// the emails of a contact and sending from the panel.

type ContactEmailRow = Database['public']['Tables']['contact_emails']['Row'];
export type ContactEmail = Omit<ContactEmailRow, 'attachments'> & {
  attachments: Array<{ filename: string; content_type: string; size: number; path: string }>;
};

export interface Mailbox {
  email: string;
  display_name: string | null;
  status: string;
  last_error: string | null;
  connected_at: string;
  last_sync_at: string | null;
}

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

export function useMailbox() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['mailbox', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_mailboxes')
        .select('email, display_name, status, last_error, connected_at, last_sync_at')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as Mailbox | null;
    },
    enabled: !!user?.id,
  });
}

export function useConnectOutlook() {
  return useMutation({
    mutationFn: async () => {
      const { url } = await invoke<{ url: string }>('outlook-auth', { origin: window.location.origin });
      window.location.href = url;
    },
  });
}

export function useDisconnectMailbox() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('disconnect_my_mailbox');
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mailbox'] }),
  });
}

export function useSyncMailbox() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invoke<{ scanned: number; stored: number }>('mail-sync', {}),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['mailbox'] });
      queryClient.invalidateQueries({ queryKey: ['contact-emails'] });
      queryClient.invalidateQueries({ queryKey: ['quote-replies-unread'] });
    },
  });
}

// The same email can be in two sellers' mailboxes (e.g. in copy): show it once.
export function dedupeEmails(rows: ContactEmail[]): ContactEmail[] {
  const seen = new Set<string>();
  return rows.filter(row => {
    const key = row.internet_message_id || `${row.mailbox_email}:${row.provider_message_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function useContactEmails(contactId: string | null) {
  return useQuery({
    queryKey: ['contact-emails', contactId],
    queryFn: async () => {
      const { data, error } = await supabase.from('contact_emails').select('*').eq('contact_id', contactId!).order('sent_at');
      if (error) throw error;
      return dedupeEmails((data ?? []) as unknown as ContactEmail[]);
    },
    enabled: !!contactId,
    refetchInterval: 60_000,
  });
}

// Clients who answered a quote sent from the panel and nobody has looked yet.
export function useUnreadQuoteReplies() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ['quote-replies-unread', profile?.workshop_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contact_emails')
        .select('id, contact_id, quote_id, service_request_id, from_address, from_name, body_text, sent_at')
        .eq('direction', 'in')
        .not('quote_id', 'is', null)
        .is('read_at', null)
        .order('sent_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!profile?.workshop_id,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useMarkContactEmailsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contactId: string) => {
      const { data, error } = await supabase.rpc('mark_contact_emails_read', { _contact_id: contactId });
      if (error) throw error;
      return data;
    },
    onSuccess: (count, contactId) => {
      if (!count) return;
      queryClient.invalidateQueries({ queryKey: ['contact-emails', contactId] });
      queryClient.invalidateQueries({ queryKey: ['quote-replies-unread'] });
    },
  });
}

export interface SendClientEmailInput {
  kind: 'quote' | 'answer';
  quoteId?: string | null;
  replyToEmailId?: string | null;
  contactId: string;
  requestId: string | null;
  to: string[];
  cc: string[];
  subject: string;
  message: string;
}

export function useSendClientEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SendClientEmailInput) =>
      invoke<{ ok: true; marked_sent: boolean; warning: string | null; from: string }>('send-client-email', {
        kind: input.kind,
        quote_id: input.quoteId ?? undefined,
        reply_to_email_id: input.replyToEmailId ?? undefined,
        to: input.to,
        cc: input.cc,
        subject: input.subject,
        message: input.message,
      }),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ['contact-emails', input.contactId] });
      queryClient.invalidateQueries({ queryKey: ['quote-replies-unread'] });
      if (input.quoteId) queryClient.invalidateQueries({ queryKey: ['quote', input.quoteId] });
      queryClient.invalidateQueries({ queryKey: ['request-quotes', input.requestId] });
      queryClient.invalidateQueries({ queryKey: ['service-requests'] });
      queryClient.invalidateQueries({ queryKey: ['client-service-requests'] });
    },
  });
}

// "a@b.cl, c@d.cl; e@f.cl" -> ["a@b.cl", "c@d.cl", "e@f.cl"]
export function splitAddresses(value: string): string[] {
  return value.split(/[,;\s]+/).map(part => part.trim()).filter(Boolean);
}

export const looksLikeEmail = (value: string) => /^[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[a-z]{2,}$/i.test(value);
