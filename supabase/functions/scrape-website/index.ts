import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function htmlToCleanText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '');

  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<h[1-6][^>]*>/gi, '\n### ')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<td[^>]*>/gi, ' | ')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>/gi, '[$1] ')
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, '(imagen: $1) ');

  text = text.replace(/<[^>]+>/g, ' ');

  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec)));

  text = text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .replace(/^\s+/gm, '')
    .trim();

  return text;
}

function extractInternalLinks(html: string, baseUrl: URL): string[] {
  const links: string[] = [];
  const regex = /<a[^>]*href="([^"#]*)"[^>]*>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    let href = match[1].trim();
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;

    try {
      const fullUrl = new URL(href, baseUrl.origin);
      if (fullUrl.hostname !== baseUrl.hostname) continue;
      if (/\.(jpg|jpeg|png|gif|svg|css|js|pdf|zip|mp4|mp3|woff|woff2|ttf|ico)$/i.test(fullUrl.pathname)) continue;
      if (/\/(cart|checkout|mi-cuenta|my-account|login|wp-admin|wp-login|feed|xmlrpc|wp-json|wp-content|wp-includes)/i.test(fullUrl.pathname)) continue;

      const clean = fullUrl.origin + fullUrl.pathname.replace(/\/$/, '');
      links.push(clean);
    } catch { /* skip */ }
  }

  return links;
}

function isHighPriorityUrl(url: string): boolean {
  return /\/(categor|product|servic|tienda|shop|store|nosotros|about|quienes|contacto|equipo|producto|item|precio|faq|arriendo|venta|marca)/i.test(url);
}

function isLowPriorityUrl(url: string): boolean {
  return /\/(blog|noticias|news|tag\/|author\/|comment|attachment|page\/\d|#|replyto|\?replyto)/i.test(url);
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

async function crawlSite(startUrl: string, baseUrl: URL, maxPages: number): Promise<{ url: string; text: string }[]> {
  const visited = new Set<string>();
  const results: { url: string; text: string }[] = [];
  
  const startNormalized = baseUrl.origin + baseUrl.pathname.replace(/\/$/, '');
  const queue: string[] = [startUrl];
  visited.add(startNormalized);

  while (queue.length > 0 && results.length < maxPages) {
    const batchSize = Math.min(10, maxPages - results.length, queue.length);
    const batch = queue.splice(0, batchSize);

    const fetched = await Promise.all(batch.map(async (pageUrl) => {
      const html = await fetchPage(pageUrl);
      if (!html) return null;
      
      const newLinks = extractInternalLinks(html, baseUrl);
      const clean = htmlToCleanText(html);
      if (clean.length < 150) return { links: newLinks, url: pageUrl, text: '' };
      
      return { links: newLinks, url: pageUrl, text: clean };
    }));

    for (const r of fetched) {
      if (!r) continue;
      
      for (const link of r.links) {
        const normalized = link.replace(/\/$/, '');
        if (!visited.has(normalized) && !isLowPriorityUrl(normalized)) {
          visited.add(normalized);
          if (isHighPriorityUrl(normalized)) {
            queue.unshift(normalized);
          } else {
            queue.push(normalized);
          }
        }
      }

      if (r.text && r.text.length >= 150) {
        results.push({ url: r.url, text: r.text });
      }
    }

    console.log(`Crawled batch: ${results.length} pages collected, ${queue.length} in queue`);
  }

  return results;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { url, workshop_id } = await req.json();

    if (!url || !workshop_id) {
      return new Response(JSON.stringify({ error: 'Se requiere url y workshop_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }

    try { new URL(formattedUrl); } catch {
      return new Response(JSON.stringify({ error: 'URL no válida' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const baseUrl = new URL(formattedUrl);
    const domain = baseUrl.hostname;
    console.log('Scraping URL (direct crawl, no AI):', formattedUrl);

    // 1. Create bot_documents record
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

    try {
      // 2. Crawl up to 50 pages (keeps crawl under ~60s)
      const maxPages = 50;
      const allPageTexts = await crawlSite(formattedUrl, baseUrl, maxPages);

      console.log(`Crawl complete: ${allPageTexts.length} pages with content`);

      if (allPageTexts.length === 0) {
        throw new Error('No se pudo extraer contenido del sitio web.');
      }

      // 3. Combine all page texts with URL prefixes, cap at 500K chars
      const MAX_TOTAL_CHARS = 500000;
      let combinedText = '';
      let pagesIncluded = 0;

      for (const page of allPageTexts) {
        const pageBlock = `\n\n===== PÁGINA: ${page.url} =====\n\n${page.text}`;
        if (combinedText.length + pageBlock.length > MAX_TOTAL_CHARS && combinedText.length > 0) {
          console.log(`Text cap reached at ${pagesIncluded} pages (${combinedText.length} chars)`);
          break;
        }
        combinedText += pageBlock;
        pagesIncluded++;
      }

      console.log(`Combined text: ${combinedText.length} chars from ${pagesIncluded} pages`);

      // Update file_size
      await supabase
        .from('bot_documents')
        .update({ file_size: combinedText.length })
        .eq('id', documentId);

      // 4. Send directly to process-rag-document (no AI summarization)
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
          plain_text: combinedText,
        }),
      });

      const processResult = await processResponse.json();

      if (!processResponse.ok || !processResult.success) {
        throw new Error(processResult.error || 'Error al procesar el contenido');
      }

      return new Response(JSON.stringify({
        success: true,
        document_id: documentId,
        domain,
        pages_scraped: pagesIncluded,
        content_length: combinedText.length,
        chunks_created: processResult.chunks_created,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (processingError: unknown) {
      const errorMessage = processingError instanceof Error ? processingError.message : 'Error desconocido';
      console.error('Scrape processing error:', errorMessage);

      await supabase
        .from('bot_documents')
        .update({ status: 'error', error_message: errorMessage })
        .eq('id', documentId);

      return new Response(JSON.stringify({ success: false, error: errorMessage }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

  } catch (error: unknown) {
    console.error('Scrape website error:', error);
    const message = error instanceof Error ? error.message : 'Error desconocido';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
