import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v2';
const MAX_PAGES = 50;
const MAX_TOTAL_CHARS = 500_000;
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_DURATION_MS = 5 * 60 * 1000; // 5 minutes

interface FirecrawlPage {
  markdown?: string;
  metadata?: {
    sourceURL?: string;
    url?: string;
    title?: string;
  };
}

async function startCrawl(firecrawlApiKey: string, url: string): Promise<string> {
  const resp = await fetch(`${FIRECRAWL_BASE}/crawl`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      limit: MAX_PAGES,
      excludePaths: [
        '/cart', '/checkout', '/mi-cuenta', '/my-account',
        '/wp-admin', '/wp-login', '/feed', '/xmlrpc',
        '/wp-json', '/wp-content', '/wp-includes',
      ],
      scrapeOptions: {
        formats: ['markdown'],
        onlyMainContent: true,
      },
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Firecrawl /crawl failed [${resp.status}]: ${JSON.stringify(data)}`);
  }

  const id = data?.id || data?.jobId;
  if (!id) {
    throw new Error(`Firecrawl /crawl returned no job id: ${JSON.stringify(data)}`);
  }
  return id as string;
}

async function pollCrawl(firecrawlApiKey: string, jobId: string): Promise<FirecrawlPage[]> {
  const startedAt = Date.now();
  let allPages: FirecrawlPage[] = [];
  let nextUrl: string | null = `${FIRECRAWL_BASE}/crawl/${jobId}`;

  while (Date.now() - startedAt < MAX_POLL_DURATION_MS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    const resp = await fetch(nextUrl!, {
      headers: { 'Authorization': `Bearer ${firecrawlApiKey}` },
    });
    const json = await resp.json();
    if (!resp.ok) {
      throw new Error(`Firecrawl status poll failed [${resp.status}]: ${JSON.stringify(json)}`);
    }

    const status = json?.status;
    const completed = json?.completed ?? 0;
    const total = json?.total ?? 0;
    console.log(`Firecrawl poll: status=${status}, ${completed}/${total} pages`);

    if (Array.isArray(json?.data)) {
      allPages = allPages.concat(json.data as FirecrawlPage[]);
    }

    if (status === 'completed') {
      // Walk pagination if present
      let next = json?.next as string | null | undefined;
      while (next) {
        const nResp = await fetch(next, {
          headers: { 'Authorization': `Bearer ${firecrawlApiKey}` },
        });
        const nJson = await nResp.json();
        if (!nResp.ok) break;
        if (Array.isArray(nJson?.data)) {
          allPages = allPages.concat(nJson.data as FirecrawlPage[]);
        }
        next = nJson?.next as string | null | undefined;
      }
      return allPages;
    }

    if (status === 'failed' || status === 'cancelled') {
      throw new Error(`Firecrawl crawl ${status}: ${JSON.stringify(json)}`);
    }

    // status === 'scraping' | 'queued' | etc → keep polling
  }

  throw new Error(`Firecrawl crawl timeout after ${MAX_POLL_DURATION_MS / 1000}s`);
}

function buildCombinedText(pages: FirecrawlPage[]): { combined: string; included: number } {
  let combined = '';
  let included = 0;

  for (const page of pages) {
    const md = (page.markdown || '').trim();
    if (md.length < 80) continue;
    const url = page.metadata?.sourceURL || page.metadata?.url || '';
    const block = `\n\n===== PÁGINA: ${url} =====\n\n${md}`;
    if (combined.length + block.length > MAX_TOTAL_CHARS && combined.length > 0) {
      console.log(`Text cap reached at ${included} pages (${combined.length} chars)`);
      break;
    }
    combined += block;
    included++;
  }

  return { combined, included };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  if (!firecrawlApiKey) {
    return new Response(JSON.stringify({
      error: 'FIRECRAWL_API_KEY no está configurado. Conecta Firecrawl en Connectors.',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { url, workshop_id } = await req.json();

    if (!url || !workshop_id) {
      return new Response(JSON.stringify({ error: 'Se requiere url y workshop_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let formattedUrl = String(url).trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }

    let baseUrl: URL;
    try { baseUrl = new URL(formattedUrl); } catch {
      return new Response(JSON.stringify({ error: 'URL no válida' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const domain = baseUrl.hostname;

    // 1. Create bot_documents record immediately
    const { data: doc, error: docError } = await supabase
      .from('bot_documents')
      .insert({
        workshop_id,
        file_name: `🌐 ${domain}`,
        file_type: 'text/html',
        file_size: 0,
        status: 'processing',
      })
      .select('id')
      .single();

    if (docError) {
      console.error('Error creating document:', docError);
      throw new Error('Error al crear registro del documento');
    }

    const documentId = doc.id;

    // 2. Background work: Firecrawl crawl + polling + process-rag
    const backgroundWork = (async () => {
      try {
        console.log(`Background: starting Firecrawl crawl for ${formattedUrl}`);
        const jobId = await startCrawl(firecrawlApiKey!, formattedUrl);
        console.log(`Background: Firecrawl job started: ${jobId}`);

        const pages = await pollCrawl(firecrawlApiKey!, jobId);
        console.log(`Background: crawl complete, ${pages.length} pages received`);

        if (pages.length === 0) {
          throw new Error('Firecrawl no devolvió ninguna página. El sitio puede estar bloqueado o no tener contenido accesible.');
        }

        const { combined, included } = buildCombinedText(pages);
        console.log(`Background: combined ${combined.length} chars from ${included} pages`);

        if (combined.length < 200) {
          throw new Error('No se pudo extraer suficiente contenido legible del sitio web.');
        }

        // Update file_size
        await supabase
          .from('bot_documents')
          .update({ file_size: combined.length })
          .eq('id', documentId);

        // Send to process-rag-document
        const processResponse = await fetch(`${supabaseUrl}/functions/v1/process-rag-document`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            document_id: documentId,
            workshop_id,
            file_name: `🌐 ${domain}`,
            plain_text: combined,
          }),
        });

        const processResult = await processResponse.json();
        if (!processResponse.ok || !processResult.success) {
          throw new Error(processResult.error || 'Error al procesar el contenido');
        }

        await supabase
          .from('bot_documents')
          .update({
            status: 'ready',
            chunk_count: processResult.chunks_created || 0,
          })
          .eq('id', documentId);

        console.log(`Background: done. ${processResult.chunks_created} chunks created for ${domain}`);
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : 'Error desconocido';
        console.error('Background scrape error:', errorMessage);
        await supabase
          .from('bot_documents')
          .update({ status: 'error', error_message: errorMessage })
          .eq('id', documentId);
      }
    })();

    // 3. Keep background alive but return immediately
    // @ts-ignore: EdgeRuntime is available in Supabase Edge Functions
    if (typeof EdgeRuntime !== 'undefined') {
      // @ts-ignore
      EdgeRuntime.waitUntil(backgroundWork);
    }

    return new Response(JSON.stringify({
      success: true,
      document_id: documentId,
      domain,
      status: 'processing',
      engine: 'firecrawl',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Scrape website error:', error);
    const message = error instanceof Error ? error.message : 'Error desconocido';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});