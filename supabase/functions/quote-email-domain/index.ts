import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWorkshopFeatures } from "../_shared/features.ts";
import { isValidSenderLocal, normalizeDomain } from "../_shared/quoteEmail.ts";
import { resendRequest, type ResendDomain, type ResendDomainRecord } from "../_shared/resend.ts";

// Sets up the domain quotes are emailed from (F4). The admin types a
// subdomain of the business (e.g. cotizaciones.soc.cl); we register it in
// Resend for sending and receiving and hand back the DNS records that whoever
// manages the business's domain has to add. Commercial module only.
//
// POST { action: 'get' }                              -> current state (refreshed from Resend)
// POST { action: 'setup', domain, sender_local? }     -> registers the domain
// POST { action: 'verify' }                           -> asks Resend to check the records now

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// Full host name for each record, so it can be copied as is.
function withHost(records: ResendDomainRecord[] | undefined, domain: string) {
  return (records || []).map((r) => {
    const name = (r.name ?? '').trim();
    const host = !name || name === '@' ? domain : name === domain || name.endsWith(`.${domain}`) ? name : `${name}.${domain}`;
    return { record: r.record, type: r.type, host, value: r.value, priority: r.priority ?? null, status: r.status ?? 'not_started' };
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json(401, { error: 'Unauthorized' });
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const { data: auth, error: authError } = await userClient.auth.getUser();
    if (authError || !auth?.user) return json(401, { error: 'Unauthorized' });

    const { data: profile } = await supabase.from('profiles').select('workshop_id, role').eq('id', auth.user.id).maybeSingle();
    if (!profile?.workshop_id) return json(400, { error: 'Sin negocio asociado' });
    if (profile.role !== 'ADMIN' && profile.role !== 'SUPERADMIN') return json(403, { error: 'Solo un administrador puede configurar el correo' });
    const workshopId = profile.workshop_id as string;
    if (!(await fetchWorkshopFeatures(supabase, workshopId)).commercial) return json(403, { error: 'Módulo comercial no activo' });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? 'get');

    const { data: current } = await supabase.from('workshop_email_domains').select('*').eq('workshop_id', workshopId).maybeSingle();

    const save = async (domain: ResendDomain, extra: Record<string, unknown> = {}) => {
      const row = {
        workshop_id: workshopId,
        domain: domain.name,
        provider_domain_id: domain.id,
        status: domain.status ?? 'not_started',
        records: withHost(domain.records, domain.name),
        checked_at: new Date().toISOString(),
        ...extra,
      };
      const { data, error } = await supabase.from('workshop_email_domains').upsert(row, { onConflict: 'workshop_id' }).select('*').single();
      if (error) throw error;
      return data;
    };

    if (action === 'get' || action === 'verify') {
      if (!current?.provider_domain_id) return json(200, { domain: current ?? null });
      if (action === 'verify') {
        const verify = await resendRequest(`/domains/${current.provider_domain_id}/verify`, { method: 'POST' });
        if (!verify.ok) return json(502, { error: `Resend: ${verify.error}` });
      }
      const fresh = await resendRequest<ResendDomain>(`/domains/${current.provider_domain_id}`);
      if (!fresh.ok || !fresh.data) return json(200, { domain: current, warning: `No se pudo consultar Resend: ${fresh.error}` });
      return json(200, { domain: await save(fresh.data) });
    }

    if (action === 'setup') {
      const domain = normalizeDomain(String(body.domain ?? ''));
      if (!domain) return json(400, { error: 'Escribe un dominio válido, por ejemplo cotizaciones.soc.cl' });
      const senderLocal = String(body.sender_local ?? current?.sender_local ?? 'cotizaciones').trim().toLowerCase();
      if (!isValidSenderLocal(senderLocal)) return json(400, { error: 'El nombre antes de la @ solo puede tener letras, números, puntos o guiones' });

      // Same domain already registered: only the sender name may change.
      if (current?.provider_domain_id && current.domain === domain) {
        const { data, error } = await supabase.from('workshop_email_domains').update({ sender_local: senderLocal }).eq('workshop_id', workshopId).select('*').single();
        if (error) throw error;
        return json(200, { domain: data });
      }

      const { data: taken } = await supabase.from('workshop_email_domains').select('workshop_id').eq('domain', domain).maybeSingle();
      if (taken && taken.workshop_id !== workshopId) return json(409, { error: 'Ese dominio ya está en uso por otro negocio' });

      const created = await resendRequest<ResendDomain>('/domains', {
        body: { name: domain, capabilities: { sending: 'enabled', receiving: 'enabled' } },
      });
      if (!created.ok || !created.data) return json(502, { error: `Resend: ${created.error}` });

      // A different domain replaces the previous one; remove the old one from Resend.
      if (current?.provider_domain_id && current.provider_domain_id !== created.data.id) {
        const removed = await resendRequest(`/domains/${current.provider_domain_id}`, { method: 'DELETE' });
        if (!removed.ok) console.error('Could not delete previous Resend domain', current.provider_domain_id, removed.error);
      }

      return json(200, { domain: await save(created.data, { sender_local: senderLocal, created_by: auth.user.id }) });
    }

    return json(400, { error: 'Acción desconocida' });
  } catch (error) {
    console.error('quote-email-domain error:', error);
    return json(500, { error: error instanceof Error ? error.message : 'Error inesperado' });
  }
});
