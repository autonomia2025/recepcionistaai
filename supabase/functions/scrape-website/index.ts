import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
          'User-Agent': 'Mozilla/5.0 (compatible; RecepcionistaAI/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
      });

      if (!fetchResponse.ok) {
        throw new Error(`No se pudo acceder al sitio (HTTP ${fetchResponse.status})`);
      }

      const html = await fetchResponse.text();
      console.log('Fetched HTML length:', html.length);

      // Limit HTML size to avoid token limits
      const maxHtmlLength = 100000;
      const truncatedHtml = html.length > maxHtmlLength ? html.substring(0, maxHtmlLength) : html;

      // 3. Use Gemini to extract structured content
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
              content: `Eres un experto en extraer información de sitios web. Tu tarea es analizar el HTML de un sitio web y extraer TODA la información relevante del negocio en formato texto limpio y bien estructurado.

Debes extraer:
- Nombre del negocio
- Descripción general
- Productos y/o servicios (con nombre, precio si está disponible, descripción)
- Categorías de productos
- Información de contacto (teléfono, email, dirección, horarios)
- Políticas (envío, devoluciones, garantías)
- Cualquier otra información relevante para atención al cliente

Formatea la salida como texto plano bien estructurado con secciones claras. NO uses HTML ni markdown. Solo texto plano con saltos de línea.`
            },
            {
              role: 'user',
              content: `Extrae toda la información relevante del siguiente sitio web (${formattedUrl}):\n\n${truncatedHtml}`
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

      if (!extractedContent || extractedContent.trim().length < 50) {
        throw new Error('No se pudo extraer contenido útil del sitio web');
      }

      console.log('Extracted content length:', extractedContent.length);

      // 4. Process as RAG document (send plain text directly)
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
