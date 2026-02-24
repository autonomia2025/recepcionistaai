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
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const authSupabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { conversation_id, contact_id } = await req.json();

    if (!conversation_id || !contact_id) {
      return new Response(JSON.stringify({ error: 'Missing conversation_id or contact_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: authData, error: authError } = await authSupabase.auth.getUser();
    if (authError || !authData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: profile, error: profileError } = await authSupabase
      .from('profiles')
      .select('workshop_id')
      .eq('id', authData.user.id)
      .single();

    if (profileError || !profile?.workshop_id) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Analyzing conversation:', conversation_id);

    // Get conversation to get workshop_id
    const { data: conversation } = await supabase
      .from('conversations')
      .select('workshop_id')
      .eq('id', conversation_id)
      .single();

    const workshop_id = conversation?.workshop_id;

    if (!workshop_id || workshop_id !== profile.workshop_id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get all messages from the conversation
    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('text, direction, created_at')
      .eq('conversation_id', conversation_id)
      .order('created_at', { ascending: true })
      .limit(50);

    if (messagesError || !messages || messages.length === 0) {
      console.log('No messages to analyze');
      return new Response(JSON.stringify({ success: true, skipped: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Format messages for AI analysis
    const formattedMessages = messages.map(m => 
      `${m.direction === 'inbound' ? 'Cliente' : 'Empresa'}: ${m.text}`
    ).join('\n');

    // Call Lovable AI for analysis
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          {
            role: 'system',
            content: `Eres un asistente experto en análisis de conversaciones comerciales. Tu trabajo es analizar conversaciones de WhatsApp y extraer información estructurada de manera PRECISA.

IMPORTANTE: 
- Responde SOLO con el JSON, sin texto adicional ni markdown.
- Analiza CUIDADOSAMENTE el contenido real de la conversación para determinar la intención.`
          },
          {
            role: 'user',
            content: `Analiza esta conversación de WhatsApp:

${formattedMessages}

Responde SOLO con este JSON (sin markdown ni texto adicional):
{
  "intent": "una de las opciones listadas abajo",
  "intent_confidence": 0.95,
  "lead_score": 75,
  "lead_score_reasoning": "Breve razón del score (max 50 palabras)",
  "should_recontact": true,
  "recontact_in_days": 2,
  "recontact_reason": "Razón para recontactar",
  "summary": "Resumen breve de la conversación (max 100 palabras)",
  "sentiment": "positive|neutral|negative",
  "did_schedule": false,
  "schedule_confidence": 0.9,
  "quotation_items": []
}

=== CRITERIOS PARA DETECTAR INTENT (MUY IMPORTANTE) ===

Analiza el CONTENIDO REAL de los mensajes del cliente para determinar su intención:

1. "agendar_cita": El cliente quiere reservar una cita, hora, visita o reunión
   - Ejemplos: "quiero agendar", "tienen hora disponible", "puedo reservar", "necesito una cita"
   
2. "cotizacion": El cliente pregunta por PRECIOS, costos, valores, o quiere un presupuesto
   - Ejemplos: "cuánto cuesta", "precio de", "cotización de", "valor del servicio", "presupuesto"
   
3. "consulta": El cliente hace preguntas generales sobre servicios, productos o información
   - Ejemplos: "qué servicios tienen", "cómo funciona", "información sobre", "me pueden explicar"
   
4. "compra": El cliente quiere comprar directamente o confirma una compra
   - Ejemplos: "quiero comprar", "lo quiero", "me lo llevo", "confirmo la compra"
   
5. "reclamo": El cliente tiene una queja, problema o insatisfacción
   - Ejemplos: "tengo un problema", "no funciona", "estoy insatisfecho", "quiero quejarme"
   
6. "seguimiento": El cliente da seguimiento a algo previo (pedido, servicio, cita anterior)
   - Ejemplos: "vengo por mi pedido", "cómo va mi orden", "estado de mi servicio"
   
7. "soporte": El cliente necesita ayuda técnica o asistencia
   - Ejemplos: "necesito ayuda con", "no puedo", "cómo hago para", "tengo dudas sobre el uso"
   
8. "saludo": Solo un saludo sin intención clara aún
   - Ejemplos: "hola", "buenos días", "buenas tardes" (sin más contexto)
   
9. "otro": Cualquier otra intención que no encaje en las anteriores

=== REGLAS IMPORTANTES ===
- Si el cliente pregunta por PRECIOS o COSTOS → intent = "cotizacion"
- Si el cliente quiere AGENDAR una hora/cita/visita → intent = "agendar_cita"
- Si el cliente solo PREGUNTA información sin mencionar precios → intent = "consulta"
- Si la conversación es solo saludos iniciales sin contexto → intent = "saludo"
- NO asumas "cotizacion" por defecto, analiza lo que el cliente realmente dice

=== QUOTATION_ITEMS ===
Solo incluye quotation_items si el cliente EXPLÍCITAMENTE menciona productos/servicios que quiere cotizar o comprar con detalles específicos. Si solo pregunta información general, deja el array vacío [].

Estructura de cada item:
{
  "product_name": "Nombre del producto/servicio",
  "quantity": 3,
  "unit": "unidades|meses|días|metros|otro",
  "duration": "6 meses",
  "location": "Comuna o ciudad",
  "address": "Dirección si se menciona",
  "use_type": "faena|evento|obra|hogar|comercial|otro",
  "specifications": {},
  "unit_price": null,
  "total_price": null,
  "confidence": 0.9
}

=== CRITERIOS LEAD SCORE ===
- 80-100: Cliente urgente, listo para comprar/agendar, servicio de alto valor
- 60-79: Interesado activo, pidiendo cotización o información específica
- 40-59: Consulta general, comparando opciones
- 20-39: Contacto frío, solo explorando
- 0-19: Spam o contacto no relevante

=== CRITERIOS PARA RECONTACTO ===
- should_recontact: true SOLO si el cliente mostró interés real pero no concretó
- recontact_in_days: número de DÍAS para recontactar (1-30 días máximo)
  * 1-2 días: Cliente muy interesado, esperando respuesta urgente
  * 3-7 días: Cliente interesado pero sin urgencia
  * 7-14 días: Seguimiento general
  * 14-30 días: Recordatorio de largo plazo
- NO marcar recontacto si la conversación ya cerró (compra, reclamo resuelto, etc.)`
          }
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', errorText);
      throw new Error('AI analysis failed');
    }

    const aiResult = await aiResponse.json();
    const aiContent = aiResult.choices?.[0]?.message?.content;
    
    console.log('AI response:', aiContent);

    if (!aiContent) {
      throw new Error('Empty AI response');
    }

    // Parse AI response - handle potential markdown wrapping
    let analysis;
    try {
      let jsonContent = aiContent.trim();
      // Remove markdown code blocks if present
      if (jsonContent.startsWith('```')) {
        jsonContent = jsonContent.replace(/```json?\n?/g, '').replace(/```\n?$/g, '').trim();
      }
      analysis = JSON.parse(jsonContent);
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiContent);
      // Use defaults if parsing fails
      analysis = {
        intent: 'otro',
        intent_confidence: 0.5,
        lead_score: 50,
        lead_score_reasoning: 'No se pudo analizar la conversación',
        should_recontact: false,
        recontact_in_hours: null,
        recontact_reason: null,
        summary: 'No se pudo analizar',
        sentiment: 'neutral',
        did_schedule: false,
        schedule_confidence: 0.5,
        quotation_items: []
      };
    }

    // Update contact with AI analysis
    const contactUpdate: Record<string, unknown> = {
      lead_score: Math.min(100, Math.max(0, analysis.lead_score || 50)),
      lead_score_reasoning: analysis.lead_score_reasoning || null,
      detected_intent: analysis.intent || 'otro',
      intent_confidence: analysis.intent_confidence || 0.5,
      should_recontact: analysis.should_recontact || false,
      did_schedule: analysis.did_schedule || false,
      schedule_confidence: analysis.schedule_confidence || null,
      last_analyzed_at: new Date().toISOString(),
    };

    // Calculate recontact date using DAYS (not hours) for more sensible dates
    if (analysis.should_recontact && (analysis.recontact_in_days || analysis.recontact_in_hours)) {
      const recontactDate = new Date();
      // Use days if provided, otherwise fall back to hours converted to days
      const daysToAdd = analysis.recontact_in_days 
        ? Math.min(30, Math.max(1, analysis.recontact_in_days)) // Cap between 1-30 days
        : Math.min(30, Math.max(1, Math.ceil((analysis.recontact_in_hours || 24) / 24)));
      recontactDate.setDate(recontactDate.getDate() + daysToAdd);
      // Set to 10 AM for a reasonable business hour
      recontactDate.setHours(10, 0, 0, 0);
      contactUpdate.recontact_at = recontactDate.toISOString();
      contactUpdate.recontact_reason = analysis.recontact_reason;
    }

    const { error: contactError } = await supabase
      .from('contacts')
      .update(contactUpdate)
      .eq('id', contact_id);

    if (contactError) {
      console.error('Error updating contact:', contactError);
    }

    // Update conversation with summary and sentiment
    const { error: convError } = await supabase
      .from('conversations')
      .update({
        ai_summary: analysis.summary,
        sentiment: analysis.sentiment,
      })
      .eq('id', conversation_id);

    if (convError) {
      console.error('Error updating conversation:', convError);
    }

    // Process quotation items
    if (workshop_id && analysis.quotation_items && Array.isArray(analysis.quotation_items) && analysis.quotation_items.length > 0) {
      console.log('Processing quotation items:', analysis.quotation_items.length);
      
      // Delete existing quotation items for this conversation to avoid duplicates
      const { error: deleteError } = await supabase
        .from('quotation_items')
        .delete()
        .eq('conversation_id', conversation_id);
      
      if (deleteError) {
        console.error('Error deleting old quotation items:', deleteError);
      }
      
      // Insert new quotation items
      const quotationItems = analysis.quotation_items.map((item: {
        product_name?: string;
        quantity?: number;
        unit?: string;
        duration?: string;
        location?: string;
        address?: string;
        use_type?: string;
        specifications?: Record<string, unknown>;
        unit_price?: number;
        total_price?: number;
        confidence?: number;
      }) => ({
        workshop_id,
        contact_id,
        conversation_id,
        product_name: item.product_name || 'Producto/Servicio',
        quantity: item.quantity || 1,
        unit: item.unit || null,
        duration: item.duration || null,
        location: item.location || null,
        address: item.address || null,
        use_type: item.use_type || null,
        specifications: item.specifications || {},
        unit_price: item.unit_price || null,
        total_price: item.total_price || null,
        confidence: item.confidence || 0.8,
        status: 'pending',
      }));
      
      const { error: insertError } = await supabase
        .from('quotation_items')
        .insert(quotationItems);
      
      if (insertError) {
        console.error('Error inserting quotation items:', insertError);
      } else {
        console.log('Inserted quotation items:', quotationItems.length);
      }
    }

    console.log('Analysis complete:', { 
      lead_score: contactUpdate.lead_score, 
      intent: contactUpdate.detected_intent,
      did_schedule: contactUpdate.did_schedule,
      schedule_confidence: contactUpdate.schedule_confidence,
      quotation_items_count: analysis.quotation_items?.length || 0
    });

    return new Response(JSON.stringify({ 
      success: true, 
      analysis: {
        lead_score: contactUpdate.lead_score,
        lead_score_reasoning: contactUpdate.lead_score_reasoning,
        intent: contactUpdate.detected_intent,
        sentiment: analysis.sentiment,
        did_schedule: contactUpdate.did_schedule,
        schedule_confidence: contactUpdate.schedule_confidence,
        quotation_items_count: analysis.quotation_items?.length || 0,
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Analyze conversation error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
