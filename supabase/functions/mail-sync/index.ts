import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { syncOneMailbox } from "../_shared/mailSync.ts";

// "Actualizar" for the signed-in person's own mailbox (F4). The scheduled
// task "mail-sync" does the same for everyone every 5 minutes.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

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
    const result = await syncOneMailbox(supabase, auth.user.id);
    if (!result) return json(404, { error: 'No tienes un correo conectado' });
    if (result.error === 'disconnected') return json(409, { error: 'La conexión con Outlook expiró. Vuelve a conectar tu correo.' });
    return json(200, result);
  } catch (error) {
    console.error('mail-sync error:', error);
    return json(500, { error: error instanceof Error ? error.message : 'Error inesperado' });
  }
});
