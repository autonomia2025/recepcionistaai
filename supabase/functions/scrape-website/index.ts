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

// Extract internal links from HTML
function extractInternalLinks(html: string, baseUrl: URL): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  const regex = /<a[^>]*href="([^"#]*)"[^>]*>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    let href = match[1].trim();
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;

    try {
      const fullUrl = new URL(href, baseUrl.origin);
      // Only same domain
      if (fullUrl.hostname !== baseUrl.hostname) continue;
      // Skip assets
      if (/\.(jpg|jpeg|png|gif|svg|css|js|pdf|zip|mp4|mp3|woff|woff2|ttf|ico)$/i.test(fullUrl.pathname)) continue;
      // Skip anchors, login, cart, account pages
      if (/\/(cart|checkout|mi-cuenta|my-account|login|wp-admin|wp-login|feed|xmlrpc)/i.test(fullUrl.pathname)) continue;

      const clean = fullUrl.origin + fullUrl.pathname;
      if (!seen.has(clean) && clean !== baseUrl.origin + baseUrl.pathname) {
        seen.add(clean);
        links.push(clean);
      }
    } catch { /* skip invalid */ }
  }

  return links;
}

// Prioritize product/service/category pages
function prioritizeLinks(links: string[]): string[] {
  const scored = links.map(link => {
    let score = 0;
    const lower = link.toLowerCase();
    // High priority: product categories, services, about
    if (/\/(categor|product|servic|tienda|shop|store|nosotros|about|quienes-somos)/i.test(lower)) score += 10;
    // Medium: specific product pages
    if (/\/(producto|item|equipo)/i.test(lower)) score += 7;
    // Medium: info pages
    if (/\/(contacto|contact|horario|precio|faq|pregunta)/i.test(lower)) score += 6;
    // Lower priority: blog, news
    if (/\/(blog|noticias|news|tag|page\/\d)/i.test(lower)) score -= 5;
    return { link, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.link);
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
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
    console.log('Scraping URL (multi-page):', formattedUrl);

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
      // 2. Fetch main page
      const mainHtml = await fetchPage(formattedUrl);
      if (!mainHtml) throw new Error('No se pudo acceder al sitio');

      console.log('Main page HTML length:', mainHtml.length);

      // 3. Extract and prioritize internal links
      const allLinks = extractInternalLinks(mainHtml, baseUrl);
      const prioritized = prioritizeLinks(allLinks);
      const maxSubpages = 15; // Crawl up to 15 subpages
      const subpageUrls = prioritized.slice(0, maxSubpages);

      console.log(`Found ${allLinks.length} internal links, crawling top ${subpageUrls.length}`);

      // 4. Fetch subpages in parallel (batches of 5)
      const allPageTexts: { url: string; text: string }[] = [];
      const mainClean = htmlToCleanText(mainHtml);
      allPageTexts.push({ url: formattedUrl, text: mainClean });

      for (let i = 0; i < subpageUrls.length; i += 5) {
        const batch = subpageUrls.slice(i, i + 5);
        const results = await Promise.all(batch.map(async (pageUrl) => {
          const html = await fetchPage(pageUrl);
          if (!html) return null;
          const clean = htmlToCleanText(html);
          // Only include if page has meaningful content
          if (clean.length < 200) return null;
          return { url: pageUrl, text: clean };
        }));
        for (const r of results) {
          if (r) allPageTexts.push(r);
        }
      }

      console.log(`Successfully scraped ${allPageTexts.length} pages`);

      // 5. Combine all page texts with page markers
      let combinedText = '';
      for (const page of allPageTexts) {
        combinedText += `\n\n===== PÁGINA: ${page.url} =====\n\n`;
        combinedText += page.text;
      }

      console.log('Combined text length:', combinedText.length);

      if (combinedText.length < 200) {
        throw new Error('El sitio web no tiene suficiente contenido de texto.');
      }

      // Truncate to fit context window (larger now for multi-page)
      const maxTextLength = 120000;
      const truncatedText = combinedText.length > maxTextLength
        ? combinedText.substring(0, maxTextLength)
        : combinedText;

      // 6. Use AI to structure content - use gemini-2.5-pro for bigger context
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
- Precio (si existe)
- Categoría a la que pertenece
- Usos recomendados
- Accesorios incluidos o compatibles

## SERVICIOS
- Nombre del servicio
- Descripción detallada
- Qué incluye
- Para qué tipo de equipos/situaciones

## CATEGORÍAS
Lista completa de categorías y subcategorías de productos/servicios

## INFORMACIÓN DE LA EMPRESA
- Nombre, descripción, historia, trayectoria
- Misión, visión, valores
- Diferenciadores (¿por qué elegirlos?)

## CONTACTO
- Teléfonos (todos)
- Emails (todos)
- Direcciones de cada sucursal con horarios
- Redes sociales

## POLÍTICAS
- Formas de pago
- Envío y despacho
- Garantías
- Devoluciones

## MARCAS
Lista de todas las marcas que distribuyen/venden

## PREGUNTAS FRECUENTES
Cualquier FAQ encontrada

REGLAS CRÍTICAS:
- NO omitas NINGÚN producto. Si hay 50 productos, lista los 50.
- Incluye TODOS los detalles técnicos disponibles.
- Si un producto aparece sin precio, indica "Precio: Cotizar".
- Organiza por categoría para fácil búsqueda.
- El chatbot usará EXACTAMENTE este texto para responder, así que debe ser completo.
- Escribe en español.`
            },
            {
              role: 'user',
              content: `Extrae TODA la información de las siguientes ${allPageTexts.length} páginas del sitio web ${domain}. Sé EXHAUSTIVO, no omitas ningún producto ni servicio:\n\n${truncatedText}`
            }
          ],
          max_tokens: 32000,
        }),
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        console.error('AI extraction error:', aiResponse.status, errText);
        throw new Error('Error al procesar el contenido con IA');
      }

      const aiResult = await aiResponse.json();
      const extractedContent = aiResult.choices?.[0]?.message?.content || '';
      const finishReason = aiResult.choices?.[0]?.finish_reason;

      console.log('Extracted content length:', extractedContent.length, 'finishReason:', finishReason);

      if (!extractedContent || extractedContent.trim().length < 50) {
        throw new Error('No se pudo extraer contenido útil del sitio web');
      }

      if (finishReason === 'length') {
        console.warn('AI output was truncated due to token limits');
      }

      // Update file_size
      await supabase
        .from('bot_documents')
        .update({ file_size: extractedContent.length })
        .eq('id', documentId);

      // 7. Process as RAG document
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
          plain_text: extractedContent,
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
        content_length: extractedContent.length,
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
