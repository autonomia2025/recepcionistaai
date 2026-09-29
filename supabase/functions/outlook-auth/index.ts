import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWorkshopFeatures } from "../_shared/features.ts";
import { authorizeUrl } from "../_shared/microsoftGraph.ts";
import { safeReturnUrl, signState } from "../_shared/oauthState.ts";

// Starts "Conectar Outlook" for the signed-in person (F4). Returns the
// Microsoft sign-in URL; outlook-callback finishes the connection.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const APP_URL = Deno.env.get('APP_URL') || 'https://recepcionistaai.lovable.app';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json(401, { error: 'Unauthorized' });
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const { data: auth } = await userClient.auth.getUser();
    if (!auth?.user) return json(401, { error: 'Unauthorized' });
    if (!Deno.env.get('MS_CLIENT_ID') || !Deno.env.get('MS_CLIENT_SECRET')) return json(500, { error: 'Falta configurar la app de Microsoft (MS_CLIENT_ID / MS_CLIENT_SECRET)' });
    // Same secret as the existing Google connections (they fall back to the service key too).
    const secret = Deno.env.get('OAUTH_STATE_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const { data: profile } = await supabase.from('profiles').select('workshop_id').eq('id', auth.user.id).maybeSingle();
    if (!profile?.workshop_id) return json(400, { error: 'Sin negocio asociado' });
    if (!(await fetchWorkshopFeatures(supabase, profile.workshop_id)).commercial) return json(403, { error: 'Módulo comercial no activo' });

    const body = await req.json().catch(() => ({}));
    const state = await signState({
      userId: auth.user.id,
      workshopId: profile.workshop_id,
      returnTo: safeReturnUrl(typeof body.origin === 'string' ? body.origin : req.headers.get('origin'), APP_URL),
      issuedAt: Date.now(),
      nonce: crypto.randomUUID(),
    }, secret);

    return json(200, { url: authorizeUrl(state) });
  } catch (error) {
    console.error('outlook-auth error:', error);
    return json(500, { error: error instanceof Error ? error.message : 'Error inesperado' });
  }
});
