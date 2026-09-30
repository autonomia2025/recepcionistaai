// Scheduled task "email-review": reviews with AI the emails sellers sent to
// clients (commercial module). A few per run, oldest first, within a time
// budget. Stops when the AI has no credits or is throttled.

import { askJson } from './aiGateway.ts';
import { buildReviewPrompt, type QuoteFacts, sanitizeReview, type ThreadEmail } from './emailReview.ts';

// deno-lint-ignore no-explicit-any
type Supabase = any;

export const REVIEW_MODEL = 'google/gemini-3-flash-preview';
const MAX_PER_RUN = 8;

async function reviewOne(supabase: Supabase, id: string): Promise<'done' | 'failed' | 'stop'> {
  const { data: email } = await supabase.from('contact_emails')
    .select('id, workshop_id, contact_id, mailbox_user_id, quote_id, direction, sent_at, subject, body_text')
    .eq('id', id).maybeSingle();
  if (!email || email.direction !== 'out') return 'failed';

  const since = new Date(new Date(email.sent_at).getTime() - 30 * 86_400_000).toISOString();
  const [{ data: previous }, { data: contact }, { data: seller }, { data: settings }, { data: workshop }] = await Promise.all([
    supabase.from('contact_emails').select('direction, sent_at, subject, body_text, internet_message_id, provider_message_id')
      .eq('contact_id', email.contact_id).lt('sent_at', email.sent_at).gte('sent_at', since)
      .order('sent_at', { ascending: false }).limit(8),
    supabase.from('contacts').select('name, company_name').eq('id', email.contact_id).maybeSingle(),
    email.mailbox_user_id ? supabase.from('profiles').select('full_name').eq('id', email.mailbox_user_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('commercial_settings').select('legal_name').eq('workshop_id', email.workshop_id).maybeSingle(),
    supabase.from('workshops').select('name').eq('id', email.workshop_id).maybeSingle(),
  ]);

  // Same email in two mailboxes (copy) shows once.
  const seen = new Set<string>();
  const thread: ThreadEmail[] = (previous ?? []).filter((e: Record<string, string>) => {
    const key = e.internet_message_id || e.provider_message_id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).reverse();

  // What this email should answer: the client's emails after the seller's previous one.
  const lastOut = thread.map(e => e.direction).lastIndexOf('out');
  const clientTexts = thread.slice(lastOut + 1).filter(e => e.direction === 'in').map(e => e.body_text);

  let quote: QuoteFacts | null = null;
  if (email.quote_id) {
    const [{ data: q }, { data: lines }] = await Promise.all([
      supabase.from('quotes').select('quote_number, net_total, total, validity_days, payment_terms, delivery_terms').eq('id', email.quote_id).maybeSingle(),
      supabase.from('quote_lines').select('description, quantity, unit_price, discount_pct').eq('quote_id', email.quote_id).order('position'),
    ]);
    if (q) quote = { number: q.quote_number, lines: lines ?? [], net_total: q.net_total, total: q.total, validity_days: q.validity_days, payment_terms: q.payment_terms, delivery_terms: q.delivery_terms };
  }

  const prompt = buildReviewPrompt({
    companyName: settings?.legal_name || workshop?.name || null,
    sellerName: seller?.full_name ?? null,
    clientName: contact?.company_name || contact?.name || null,
    thread,
    email: { direction: 'out', sent_at: email.sent_at, subject: email.subject, body_text: email.body_text ?? '' },
    quote,
  });

  const ai = await askJson({
    model: REVIEW_MODEL,
    system: 'Eres un jefe de ventas exigente pero justo. Evalúas correos de vendedores a clientes. Respondes solo JSON válido.',
    prompt,
  });
  if (!ai.ok) {
    if (ai.status === 402 || ai.status === 429) return 'stop';
    return 'failed';
  }
  const review = sanitizeReview(ai.data, clientTexts);
  const row = {
    contact_email_id: email.id,
    workshop_id: email.workshop_id,
    contact_id: email.contact_id,
    seller_id: email.mailbox_user_id,
    status: review ? 'done' : 'failed',
    model: REVIEW_MODEL,
    ...(review ?? {}),
  };
  const { error } = await supabase.from('email_reviews').upsert(row, { onConflict: 'contact_email_id' });
  if (error) throw new Error(`email_reviews: ${error.message}`);
  return review ? 'done' : 'failed';
}

export async function reviewPendingEmails(supabase: Supabase, budgetMs = 100_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + budgetMs;
  const { data: pending, error } = await supabase.rpc('pending_email_reviews', { _limit: MAX_PER_RUN });
  if (error) throw new Error(`pending_email_reviews: ${error.message}`);
  const result = { pending: (pending ?? []).length, done: 0, failed: 0, stopped: false };
  for (const row of (pending ?? []) as Array<{ id: string }>) {
    if (Date.now() > deadline) break;
    const outcome = await reviewOne(supabase, row.id);
    if (outcome === 'stop') { result.stopped = true; break; }
    result[outcome]++;
  }
  return result;
}
