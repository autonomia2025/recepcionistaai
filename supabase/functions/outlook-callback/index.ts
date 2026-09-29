import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { exchangeCode, graph } from "../_shared/microsoftGraph.ts";
import { normalizeAddress } from "../_shared/mail.ts";
import { safeReturnUrl, verifyState } from "../_shared/oauthState.ts";

// Microsoft sends the person back here after "Conectar Outlook" (F4). We keep
// the tokens (only edge functions can read them) and return to the app with
// ?mail=connected or ?mail=error.

const APP_URL = Deno.env.get('APP_URL') || 'https://recepcionistaai.lovable.app';
const back = (url: string, result: string, reason?: string) => {
  const target = new URL(url);
  target.searchParams.set('mail', result);
  if (reason) target.searchParams.set('reason', reason);
  return new Response(null, { status: 302, headers: { Location: target.toString() } });
};

serve(async (req) => {
  const url = new URL(req.url);
  const payload = await verifyState(url.searchParams.get('state'), Deno.env.get('OAUTH_STATE_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
  const returnTo = payload?.returnTo ?? safeReturnUrl(null, APP_URL);
  if (!payload) return back(returnTo, 'error', 'invalid_state');

  const providerError = url.searchParams.get('error');
  if (providerError) return back(returnTo, 'error', providerError === 'access_denied' ? 'denied' : providerError.slice(0, 60));
  const code = url.searchParams.get('code');
  if (!code) return back(returnTo, 'error', 'missing_code');

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    const { tokens, error } = await exchangeCode(code);
    if (!tokens?.refresh_token) {
      console.error('Token exchange failed:', error);
      return back(returnTo, 'error', 'token');
    }
    const me = await graph<{ mail?: string | null; userPrincipalName?: string | null; displayName?: string | null }>(
      tokens.access_token, '/me?$select=mail,userPrincipalName,displayName',
    );
    const email = normalizeAddress(me.mail) ?? normalizeAddress(me.userPrincipalName);
    if (!email) return back(returnTo, 'error', 'no_email');

    // The person must still belong to the same business.
    const { data: profile } = await supabase.from('profiles').select('workshop_id').eq('id', payload.userId).maybeSingle();
    if (profile?.workshop_id !== payload.workshopId) return back(returnTo, 'error', 'profile');

    const { data: previous } = await supabase.from('staff_mailboxes').select('email').eq('user_id', payload.userId).maybeSingle();
    const sameMailbox = previous?.email === email;
    const { error: saveError } = await supabase.from('staff_mailboxes').upsert({
      user_id: payload.userId,
      workshop_id: payload.workshopId,
      provider: 'microsoft',
      email,
      display_name: me.displayName ?? null,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      status: 'active',
      last_error: null,
      connected_at: new Date().toISOString(),
      // Reconnecting the same mailbox continues where it was; a new one starts over.
      ...(sameMailbox ? {} : { inbox_synced_until: null, sent_synced_until: null, last_sync_at: null }),
    }, { onConflict: 'user_id' });
    if (saveError) throw saveError;

    return back(returnTo, 'connected');
  } catch (err) {
    console.error('outlook-callback error:', err);
    return back(returnTo, 'error', 'server');
  }
});
