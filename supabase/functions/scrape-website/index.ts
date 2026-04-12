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
  const lower = url.toLowerCase();
  return /\/(categor|product|servic|tienda|shop|store|nosotros|about|quienes|contacto|equipo|producto|item|precio|faq|arriendo|venta|marca)/i.test(lower);
}

function isLowPriorityUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return /\/(blog|noticias|news|tag\/|author\/|comment|attachment|page\/\d|#|replyto|\?replyto)/i.test(lower);
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

// BFS crawl: discover links from each page we visit
async function crawlSite(startUrl: string, baseUrl: URL, maxPages: number): Promise<{ url: string; text: string }[]> {
  const visited = new Set<string>();
  const results: { url: string; text: string }[] = [];
  
  // Normalize start URL
  const startNormalized = baseUrl.origin + baseUrl.pathname.replace(/\/$/, '');
  const queue: string[] = [startUrl];
  visited.add(startNormalized);

  while (queue.length > 0 && results.length < maxPages) {
    // Take a batch from queue
    const batchSize = Math.min(10, maxPages - results.length, queue.length);
    const batch = queue.splice(0, batchSize);

    const fetched = await Promise.all(batch.map(async (pageUrl) => {
      const html = await fetchPage(pageUrl);
      if (!html) return null;
      
      // Extract new links from this page
      const newLinks = extractInternalLinks(html, baseUrl);
      
      const clean = htmlToCleanText(html);
      if (clean.length < 150) return { html: null, links: newLinks, url: pageUrl, text: '' };
      
      return { html, links: newLinks, url: pageUrl, text: clean };
    }));

    for (const r of fetched) {
      if (!r) continue;
      
      // Add discovered links to queue
      for (const link of r.links) {
        const normalized = link.replace(/\/$/, '');
        if (!visited.has(normalized) && !isLowPriorityUrl(normalized)) {
          visited.add(normalized);
          // High priority pages go to front of queue
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
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
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
    console.log('Scraping URL (full crawl):', formattedUrl);

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
      // 2. Full BFS crawl - up to 200 pages
      const maxPages = 200;
      const allPageTexts = await crawlSite(formattedUrl, baseUrl, maxPages);

      console.log(`Full crawl complete: ${allPageTexts.length} pages with content`);

      if (allPageTexts.length === 0) {
        throw new Error('No se pudo extraer contenido del sitio web.');
      }

      // 3. Combine all page texts
      let combinedText = '';
      for (const page of allPageTexts) {
        combinedText += `\n\n===== PÁGINA: ${page.url} =====\n\n`;
        combinedText += page.text;
      }

      console.log('Combined text length:', combinedText.length);

      // 4. For very large sites, process in chunks with multiple AI calls
      const maxChunkSize = 120000;
      const textChunks: string[] = [];
      
      if (combinedText.length <= maxChunkSize) {
        textChunks.push(combinedText);
      } else {
        // Split by page boundaries to avoid cutting mid-content
        let currentChunk = '';
        for (const page of allPageTexts) {
          const pageBlock = `\n\n===== PÁGINA: ${page.url} =====\n\n${page.text}`;
          if (currentChunk.length + pageBlock.length > maxChunkSize && currentChunk.length > 0) {
            textChunks.push(currentChunk);
            currentChunk = pageBlock;
          } else {
            currentChunk += pageBlock;
          }
        }
        if (currentChunk.length > 0) textChunks.push(currentChunk);
      }

      console.log(`Processing ${textChunks.length} text chunk(s) with AI`);

      // 5. Process each chunk with AI
      const allExtracted: string[] = [];

      for (let i = 0; i < textChunks.length; i++) {
        const chunk = textChunks[i];
        const isFirst = i === 0;
        
        console.log(`Processing AI chunk ${i + 1}/${textChunks.length} (${chunk.length} chars)`);

        const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${lovableApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              {
                role: 'system',
                content: `Eres un experto en extraer información COMPLETA de sitios web para un chatbot de atención al cliente.

Se te entrega el texto de MÚLTIPLES PÁGINAS de un mismo sitio web. Tu tarea es crear un documento EXHAUSTIVO con toda la información.

EXTRAE ABSOLUTAMENTE TODO:

## PRODUCTOS
Para CADA producto encontrado incluye:
- Nombre completo y modelo
- Marca
- Descripción detallada
- Especificaciones técnicas (presión, caudal, potencia, dimensiones, peso, etc.)
- Precio (si existe, sino "Cotizar")
- Categoría a la que pertenece
- Usos recomendados
- Accesorios incluidos o compatibles

## SERVICIOS
- Nombre del servicio
- Descripción detallada
- Qué incluye
- Para qué tipo de equipos/situaciones

## CATEGORÍAS
Lista completa de categorías y subcategorías

## INFORMACIÓN DE LA EMPRESA
- Nombre, descripción, historia, trayectoria
- Misión, visión, valores
- Diferenciadores

## CONTACTO
- Teléfonos, emails, direcciones con horarios
- Redes sociales

## POLÍTICAS
- Formas de pago, envío, garantías, devoluciones

## MARCAS
Todas las marcas que distribuyen/venden

## PREGUNTAS FRECUENTES

REGLAS:
- NO omitas NINGÚN producto. Lista TODOS con TODOS sus detalles.
- Si hay especificaciones técnicas, inclúyelas TODAS.
- Si un producto no tiene precio, indica "Precio: Cotizar".
- Organiza por categoría.
- Escribe en español.
${!isFirst ? '\nEsta es una CONTINUACIÓN del mismo sitio web. Agrega solo la información NUEVA que no se haya cubierto antes.' : ''}`
              },
              {
                role: 'user',
                content: `${isFirst ? `Extrae TODA la información del sitio web ${domain}` : `CONTINUACIÓN - extrae información adicional del sitio ${domain}`}. Sé EXHAUSTIVO:\n\n${chunk}`
              }
            ],
            max_tokens: 32000,
          }),
        });

        if (!aiResponse.ok) {
          const errText = await aiResponse.text();
          console.error(`AI extraction error chunk ${i + 1}:`, aiResponse.status, errText);
          if (i === 0) throw new Error('Error al procesar el contenido con IA');
          continue; // Skip non-critical chunks
        }

        const aiResult = await aiResponse.json();
        const content = aiResult.choices?.[0]?.message?.content || '';
        if (content.trim().length > 50) {
          allExtracted.push(content);
        }

        const finishReason = aiResult.choices?.[0]?.finish_reason;
        console.log(`Chunk ${i + 1} extracted: ${content.length} chars, finishReason: ${finishReason}`);
      }

      const finalContent = allExtracted.join('\n\n---\n\n');

      if (!finalContent || finalContent.trim().length < 50) {
        throw new Error('No se pudo extraer contenido útil del sitio web');
      }

      console.log('Final content length:', finalContent.length);

      // Update file_size
      await supabase
        .from('bot_documents')
        .update({ file_size: finalContent.length })
        .eq('id', documentId);

      // 6. Process as RAG document
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
          plain_text: finalContent,
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
        pages_scraped: allPageTexts.length,
        content_length: finalContent.length,
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
