// Brings the emails exchanged with the business's contacts from a seller's
// Outlook mailbox into contact_emails. Only messages that match a contact (or
// a thread the panel already knows) are read and stored; the rest of the
// inbox is never copied.

import {
  type ConversationLink, htmlToText, matchMessage, normalizeAddress, recipientAddresses, safeFileName, splitReply,
  type GraphRecipient,
} from './mail.ts';
import { accessTokenFor, graph, type MailboxRow, MailboxDisconnectedError } from './microsoftGraph.ts';

// deno-lint-ignore no-explicit-any
type Supabase = any;

const FIRST_SYNC_DAYS = 30;
const OVERLAP_MS = 5 * 60 * 1000;
const PAGE_SIZE = 100;
const MAX_PAGES_PER_FOLDER = 10;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

interface ListedMessage {
  id: string;
  conversationId: string | null;
  internetMessageId: string | null;
  subject: string | null;
  from: GraphRecipient | null;
  toRecipients: GraphRecipient[];
  ccRecipients: GraphRecipient[];
  receivedDateTime: string;
  sentDateTime: string | null;
  hasAttachments: boolean;
  isDraft?: boolean;
}

export interface SyncResult {
  mailbox: string;
  scanned: number;
  stored: number;
  error?: string;
}

async function contactIndex(supabase: Supabase, workshopId: string) {
  const byEmail = new Map<string, string>();
  const { data: contacts } = await supabase.from('contacts').select('id, email')
    .eq('workshop_id', workshopId).not('email', 'is', null).order('created_at', { ascending: false });
  for (const c of contacts ?? []) {
    const address = normalizeAddress(c.email);
    if (address && !byEmail.has(address)) byEmail.set(address, c.id);
  }
  // Addresses typed on a quote also count for that quote's contact.
  const { data: quotes } = await supabase.from('quotes').select('contact_id, client_email')
    .eq('workshop_id', workshopId).not('client_email', 'is', null);
  for (const q of quotes ?? []) {
    const address = normalizeAddress(q.client_email);
    if (address && !byEmail.has(address)) byEmail.set(address, q.contact_id);
  }

  // Threads already in the panel keep their contact / quote / request.
  const conversations = new Map<string, ConversationLink>();
  const since = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const { data: threads } = await supabase.from('contact_emails')
    .select('conversation_id, contact_id, quote_id, service_request_id, sent_from_panel')
    .eq('workshop_id', workshopId).not('conversation_id', 'is', null).gte('sent_at', since)
    .order('sent_from_panel', { ascending: true });
  for (const t of threads ?? []) {
    // Panel-sent rows come last, so their quote link wins.
    const previous = conversations.get(t.conversation_id);
    conversations.set(t.conversation_id, {
      contact_id: t.contact_id,
      quote_id: t.quote_id ?? previous?.quote_id ?? null,
      service_request_id: t.service_request_id ?? previous?.service_request_id ?? null,
    });
  }
  return { byEmail, conversations };
}

async function latestRequestFor(supabase: Supabase, contactId: string): Promise<string | null> {
  const { data } = await supabase.from('service_requests').select('id').eq('contact_id', contactId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return data?.id ?? null;
}

async function readBody(token: string, id: string): Promise<string> {
  const message = await graph<{ uniqueBody?: { contentType?: string; content?: string }; body?: { contentType?: string; content?: string } }>(
    token, `/me/messages/${encodeURIComponent(id)}?$select=uniqueBody,body`,
    { headers: { Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"' } },
  );
  const part = message.uniqueBody?.content?.trim() ? message.uniqueBody : message.body;
  const raw = part?.content ?? '';
  const text = part?.contentType?.toLowerCase() === 'html' ? htmlToText(raw) : raw.replace(/\r\n/g, '\n').trim();
  return splitReply(text).fresh || text;
}

async function storeAttachments(supabase: Supabase, token: string, messageId: string, workshopId: string, rowId: string) {
  const stored: Array<{ filename: string; content_type: string; size: number; path: string }> = [];
  const list = await graph<{ value: Array<{ id: string; name: string; contentType: string; size: number; isInline: boolean; '@odata.type'?: string }> }>(
    token, `/me/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size,isInline`,
  );
  for (const file of list.value ?? []) {
    if (file.isInline || file['@odata.type'] !== '#microsoft.graph.fileAttachment' || file.size > MAX_ATTACHMENT_BYTES) continue;
    try {
      const bytes = await graph<Uint8Array>(token, `/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(file.id)}/$value`, { raw: true });
      const path = `${workshopId}/mail/${rowId}/${stored.length + 1}-${safeFileName(file.name)}`;
      const { error } = await supabase.storage.from('quotations').upload(path, bytes, { contentType: file.contentType || 'application/octet-stream', upsert: true });
      if (error) { console.error('Attachment upload failed:', error.message); continue; }
      stored.push({ filename: file.name, content_type: file.contentType, size: bytes.length, path });
    } catch (err) {
      console.error('Attachment download failed:', err instanceof Error ? err.message : err);
    }
  }
  return stored;
}

export async function syncMailbox(supabase: Supabase, mailbox: MailboxRow, deadline: number): Promise<SyncResult> {
  const result: SyncResult = { mailbox: mailbox.email, scanned: 0, stored: 0 };
  let token: string;
  try {
    token = await accessTokenFor(supabase, mailbox);
  } catch (err) {
    result.error = err instanceof MailboxDisconnectedError ? 'disconnected' : String(err);
    return result;
  }

  const { byEmail, conversations } = await contactIndex(supabase, mailbox.workshop_id);
  const own = mailbox.email.toLowerCase();
  const firstSync = new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000).toISOString();
  const watermarks: Record<string, string> = {};

  for (const folder of ['inbox', 'sentitems'] as const) {
    const column = folder === 'inbox' ? 'inbox_synced_until' : 'sent_synced_until';
    const from = mailbox[column] ? new Date(new Date(mailbox[column]!).getTime() - OVERLAP_MS).toISOString() : firstSync;
    let latest = mailbox[column] ?? firstSync;
    let next: string | null =
      `/me/mailFolders/${folder}/messages?$filter=receivedDateTime ge ${from}&$orderby=receivedDateTime asc&$top=${PAGE_SIZE}` +
      '&$select=id,conversationId,internetMessageId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,hasAttachments,isDraft';
    let pages = 0;

    while (next && pages < MAX_PAGES_PER_FOLDER && Date.now() < deadline) {
      const page: { value: ListedMessage[]; '@odata.nextLink'?: string } = await graph(token, next);
      pages++;
      for (const msg of page.value ?? []) {
        if (Date.now() >= deadline) break;
        result.scanned++;
        if (!msg.isDraft) {
          const direction = folder === 'inbox' ? 'in' : 'out';
          const fromAddress = normalizeAddress(msg.from?.emailAddress?.address);
          const to = recipientAddresses(msg.toRecipients);
          const cc = recipientAddresses(msg.ccRecipients);
          const link = matchMessage({ direction, conversationId: msg.conversationId, from: fromAddress, to, cc }, own, byEmail, conversations);
          if (link) {
            const { data: existing } = await supabase.from('contact_emails').select('id')
              .eq('workshop_id', mailbox.workshop_id).eq('mailbox_email', own).eq('provider_message_id', msg.id).maybeSingle();
            if (!existing) {
              const rowId = crypto.randomUUID();
              const body = await readBody(token, msg.id);
              const attachments = msg.hasAttachments ? await storeAttachments(supabase, token, msg.id, mailbox.workshop_id, rowId) : [];
              const requestId = link.service_request_id ?? await latestRequestFor(supabase, link.contact_id);
              const { error } = await supabase.from('contact_emails').insert({
                id: rowId,
                workshop_id: mailbox.workshop_id,
                contact_id: link.contact_id,
                mailbox_user_id: mailbox.user_id,
                mailbox_email: own,
                service_request_id: requestId,
                quote_id: link.quote_id,
                provider_message_id: msg.id,
                internet_message_id: msg.internetMessageId,
                conversation_id: msg.conversationId,
                direction,
                from_address: fromAddress ?? own,
                from_name: msg.from?.emailAddress?.name ?? null,
                to_addresses: to,
                cc_addresses: cc,
                subject: msg.subject,
                body_text: body,
                attachments,
                sent_at: msg.sentDateTime ?? msg.receivedDateTime,
              });
              if (error && error.code !== '23505') throw new Error(`contact_emails insert: ${error.message}`);
              if (!error) {
                result.stored++;
                if (msg.conversationId && !conversations.has(msg.conversationId)) {
                  conversations.set(msg.conversationId, { ...link, service_request_id: requestId });
                }
                // A client answered a quote sent from the panel: tell the seller.
                if (direction === 'in' && link.quote_id) {
                  const { data: quote } = await supabase.from('quotes').select('quote_number, client_name, client_company').eq('id', link.quote_id).maybeSingle();
                  const who = quote?.client_company || quote?.client_name || msg.from?.emailAddress?.name || fromAddress;
                  await supabase.from('notifications').insert({
                    workshop_id: mailbox.workshop_id,
                    user_id: mailbox.user_id,
                    type: 'quote_reply',
                    title: `${who} respondió la ${quote?.quote_number ?? 'cotización'}`,
                    message: 'Llegó una respuesta por correo. Está en la solicitud.',
                  });
                }
              }
            }
          }
        }
        if (msg.receivedDateTime > latest) latest = msg.receivedDateTime;
      }
      next = page['@odata.nextLink'] ?? null;
    }
    watermarks[column] = latest;
  }

  await supabase.from('staff_mailboxes').update({
    ...watermarks,
    last_sync_at: new Date().toISOString(),
    status: 'active',
    last_error: null,
  }).eq('user_id', mailbox.user_id);
  return result;
}

const MAILBOX_COLUMNS = 'user_id, workshop_id, email, access_token, refresh_token, token_expires_at, inbox_synced_until, sent_synced_until';

export async function syncOneMailbox(supabase: Supabase, userId: string, budgetMs = 40_000): Promise<SyncResult | null> {
  const { data } = await supabase.from('staff_mailboxes').select(MAILBOX_COLUMNS).eq('user_id', userId).maybeSingle();
  if (!data) return null;
  return syncMailbox(supabase, data as MailboxRow, Date.now() + budgetMs);
}

// Scheduled task: every active mailbox, sharing one time budget.
export async function syncAllMailboxes(supabase: Supabase, budgetMs = 110_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + budgetMs;
  const { data } = await supabase.from('staff_mailboxes').select(MAILBOX_COLUMNS).eq('status', 'active')
    .order('last_sync_at', { ascending: true, nullsFirst: true });
  const results: SyncResult[] = [];
  for (const mailbox of (data ?? []) as MailboxRow[]) {
    if (Date.now() >= deadline) break;
    try {
      results.push(await syncMailbox(supabase, mailbox, Math.min(deadline, Date.now() + 40_000)));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Mailbox sync failed:', mailbox.email, message);
      await supabase.from('staff_mailboxes').update({ last_error: `Error al sincronizar: ${message.slice(0, 200)}` }).eq('user_id', mailbox.user_id);
      results.push({ mailbox: mailbox.email, scanned: 0, stored: 0, error: message });
    }
  }
  return { mailboxes: results.length, stored: results.reduce((s, r) => s + r.stored, 0), results };
}
