import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Strip HTML to clean text, removing scripts/styles/nav/footer noise
function htmlToCleanText(html: string): string {
  // Remove script, style, svg, noscript tags and their content
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, ' [HEADER] ');

  // Convert common elements to readable text
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

  // Remove remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec)));

  // Clean whitespace
  text = text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .replace(/^\s+/gm, '')
    .trim();

  return text;
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

    // Validate URL
    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }

    try {
      new URL(formattedUrl);
    } catch {
      return new Response(JSON.stringify({ error: 'URL no válida' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const domain = new URL(formattedUrl).hostname;
    console.log('Scraping URL:', formattedUrl);

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
      // 2. Fetch the website HTML
      const fetchResponse = await fetch(formattedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
        },
        redirect: 'follow',
      });

      if (!fetchResponse.ok) {
        throw new Error(`No se pudo acceder al sitio (HTTP ${fetchResponse.status})`);
      }

      const html = await fetchResponse.text();
      console.log('Fetched HTML length:', html.length);

      // 3. Strip HTML to clean text first (much more efficient for AI)
      const cleanText = htmlToCleanText(html);
      console.log('Clean text length:', cleanText.length);

      if (cleanText.length < 100) {
        throw new Error('El sitio web no tiene suficiente contenido de texto. Puede ser una página con contenido dinámico (JavaScript).');
      }

      // Truncate clean text to fit in context window
      const maxTextLength = 60000;
      const truncatedText = cleanText.length > maxTextLength ? cleanText.substring(0, maxTextLength) : cleanText;

      // 4. Use Gemini to structure and organize the extracted content
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
              content: `Eres un experto en extraer y organizar información de sitios web para un chatbot de atención al cliente.

Tu tarea es analizar el texto extraído de un sitio web y reorganizarlo de forma COMPLETA y DETALLADA.

EXTRAE TODO lo siguiente que encuentres:
1. NOMBRE DEL NEGOCIO y descripción general
2. TODOS los productos y servicios mencionados - incluye nombre, modelo, descripción, precio, especificaciones técnicas
3. CATEGORÍAS de productos o servicios
4. INFORMACIÓN DE CONTACTO: teléfono, email, dirección, horarios, redes sociales
5. POLÍTICAS: envío, devoluciones, garantías, formas de pago
6. INFORMACIÓN SOBRE LA EMPRESA: historia, misión, valores, equipo
7. PREGUNTAS FRECUENTES si las hay
8. Cualquier dato relevante para atención al cliente

REGLAS:
- Sé EXHAUSTIVO. Incluye TODOS los productos/servicios que veas, con todos sus detalles.
- Usa texto plano bien formateado con secciones claras.
- NO omitas información. Más contenido es mejor.
- Si hay precios, inclúyelos.
- Si hay especificaciones técnicas, inclúyelas.
- Organiza por categorías cuando sea posible.`
            },
            {
              role: 'user',
              content: `Extrae y organiza TODA la información del sitio web ${formattedUrl}. Sé exhaustivo:\n\n${truncatedText}`
            }
          ],
          max_tokens: 16000,
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

      // Update file_size with actual content size
      await supabase
        .from('bot_documents')
        .update({ file_size: extractedContent.length })
        .eq('id', documentId);

      // 5. Process as RAG document (send plain text directly)
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
