import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWorkshopFeatures } from "../_shared/features.ts";
import { generateNextAction } from "../_shared/nextActionTask.ts";

// "Actualizar" on the "Qué hacer ahora" card (F5): a fresh next action for
// one lead, now. The scheduled task "next-actions" does it on its own when
// the lead changes.
//
// POST { service_request_id }

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
    const { service_request_id: requestId } = await req.json().catch(() => ({}));
    if (!requestId) return json(400, { error: 'Falta la solicitud' });

    // Read the request as the caller: row-level security decides.
    const { data: request } = await userClient.from('service_requests').select('id, workshop_id, contact_id').eq('id', requestId).maybeSingle();
    if (!request) return json(404, { error: 'Solicitud no encontrada' });
    const { data: allowed } = await userClient.rpc('can_work_quote', { _workshop_id: request.workshop_id, _contact_id: request.contact_id });
    if (allowed !== true) return json(403, { error: 'Acceso denegado' });
    if (!(await fetchWorkshopFeatures(supabase, request.workshop_id)).commercial) return json(403, { error: 'Módulo comercial no activo' });

    const outcome = await generateNextAction(supabase, request.id);
    if (!outcome.ok) return json(outcome.status, { error: outcome.error });
    const { data: action } = await supabase.from('lead_next_actions').select('*').eq('id', outcome.id).maybeSingle();
    return json(200, { action });
  } catch (error) {
    console.error('generate-next-action error:', error);
    return json(500, { error: error instanceof Error ? error.message : 'Error inesperado' });
  }
});
