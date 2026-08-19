import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractProductCodes, normalizeProductCode, resolvePdfDatasheet } from "../_shared/datasheets.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_CHUNKS = 4000;
const MAX_CODES = 400;

interface CoverageItem {
  code: string;
  source_file: string;
  has_pdf: boolean;
  pdf_file_name: string | null;
  ambiguous: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { workshop_id } = await req.json();
    if (!workshop_id) {
      return new Response(JSON.stringify({ error: 'workshop_id requerido' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') || '';

    // --- Authorization: caller must belong to the workshop or be superadmin ---
    const authClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await authClient.auth.getUser();
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: profile } = await supabase
      .from('profiles')
      .select('workshop_id, role')
      .eq('id', user.id)
      .maybeSingle();

    const isSuperadmin = profile?.role === 'SUPERADMIN';
    if (!isSuperadmin && profile?.workshop_id !== workshop_id) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- 1. Collect product codes from the knowledge base ---
    const codeSources = new Map<string, { code: string; source_file: string }>();
    const pageSize = 500;
    let fetched = 0;

    while (fetched < MAX_CHUNKS) {
      const { data: chunks, error } = await supabase
        .from('bot_knowledge')
        .select('content, file_name')
        .eq('workshop_id', workshop_id)
        .range(fetched, fetched + pageSize - 1);

      if (error) throw error;
      if (!chunks || chunks.length === 0) break;

      for (const chunk of chunks) {
        for (const code of extractProductCodes(chunk.content || '')) {
          const key = normalizeProductCode(code);
          if (key.length < 4) continue;
          if (!codeSources.has(key)) codeSources.set(key, { code, source_file: chunk.file_name });
        }
      }

      fetched += chunks.length;
      if (chunks.length < pageSize) break;
    }

    // --- 2. Resolve each code against attachable PDF documents ---
    const allCodes = [...codeSources.values()].sort((a, b) => a.code.localeCompare(b.code));
    const codes = allCodes.slice(0, MAX_CODES);
    const items: CoverageItem[] = [];

    for (const entry of codes) {
      const resolution = await resolvePdfDatasheet(supabase, workshop_id, [entry.code]);
      items.push({
        code: entry.code,
        source_file: entry.source_file,
        has_pdf: Boolean(resolution.document),
        pdf_file_name: resolution.document?.file_name ?? null,
        ambiguous: resolution.ambiguous,
      });
    }

    const withPdf = items.filter(i => i.has_pdf).length;

    return new Response(JSON.stringify({
      total: items.length,
      total_detected: allCodes.length,
      truncated: allCodes.length > codes.length,
      with_pdf: withPdf,
      without_pdf: items.length - withPdf,
      coverage_percent: items.length ? Math.round((withPdf / items.length) * 100) : 0,
      items,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('datasheet-coverage error:', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
