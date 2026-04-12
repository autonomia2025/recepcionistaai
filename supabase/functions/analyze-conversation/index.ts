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

    const isServiceRole = authHeader === `Bearer ${supabaseServiceKey}`;
    let authData = null;

    if (!isServiceRole) {
      const { data, error: authError } = await authSupabase.auth.getUser();
      if (authError || !data?.user) {
        console.error('Auth error:', authError);
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      authData = data;
    }

    // Get conversation to get workshop_id
    const { data: conversation } = await supabase
      .from('conversations')
      .select('workshop_id')
      .eq('id', conversation_id)
      .single();

    const workshop_id = conversation?.workshop_id;

    if (!workshop_id) {
      return new Response(JSON.stringify({ error: 'Conversation workshop not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Security check
    if (!isServiceRole && authData?.user) {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('workshop_id, role')
        .eq('id', authData.user.id)
        .maybeSingle();

      if (profileError || !profile) {
        return new Response(JSON.stringify({ error: 'Profile not found' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (profile.role !== 'SUPERADMIN' && workshop_id !== profile.workshop_id) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    console.log('Analyzing conversation:', conversation_id, 'workshop:', workshop_id);
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

    console.log(`Analyzing conversation ${conversation_id}: found ${messages.length} messages`);

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
        model: 'openai/gpt-5-mini',
        messages: [
          {
            role: 'system',
            content: `Eres un asistente experto en análisis de conversaciones comerciales. Tu trabajo es analizar conversaciones de WhatsApp/Web y extraer información estructurada de manera PRECISA.

IMPORTANTE: 
- Responde SOLO con el JSON, sin texto adicional ni markdown.
- Analiza CUIDADOSAMENTE el contenido real de la conversación para determinar la intención.
- Extrae TODOS los datos personales que el cliente mencione explícitamente.`
          },
          {
            role: 'user',
            content: `Analiza esta conversación:

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
  "quotation_items": [],
  "extracted_data": {
    "name": "Juan Pérez o null si no se menciona",
    "phone": "+56912345678 o null si no se menciona",
    "email": "email@ejemplo.com o null si no se menciona",
    "vehicle_brand": "Toyota o null",
    "vehicle_model": "Corolla o null",
    "vehicle_year": 2020,
    "zone": "talca|puerto_montt|santiago o null"
  }
}

=== EXTRACCIÓN DE DATOS PERSONALES (MUY IMPORTANTE) ===

Busca en la conversación si el cliente menciona EXPLÍCITAMENTE:

1. NOMBRE: Detecta cuando el cliente dice su nombre
   - "Hola, soy Juan Pérez"
   - "Mi nombre es María González"
   - "Habla Pedro"
   - "Juan aquí"
   
2. TELÉFONO: Detecta números de teléfono chilenos
   - "+56 9 1234 5678"
   - "912345678"
   - "mi número es 9 8765 4321"
   - Formato válido: +569XXXXXXXX o 9XXXXXXXX (9 dígitos empezando con 9)
   
3. EMAIL: Detecta direcciones de correo
   - "mi correo es juan@gmail.com"
   - "escríbeme a maria@empresa.cl"
   
4. VEHÍCULO: Detecta información del vehículo
   - "Tengo un Toyota Corolla 2020"
   - "Es un Hyundai Accent año 2018"
   - "Mi auto es un Kia Sportage"

5. ZONA: Detecta la zona del cliente. Las zonas válidas son: talca, puerto_montt, santiago
   - Si menciona Talca, Maule, Curicó, Linares → zone = "talca"
   - Si menciona Puerto Montt, Osorno, Llanquihue, Los Lagos → zone = "puerto_montt"
   - Si menciona Santiago, Providencia, Las Condes, Maipú, La Florida, o cualquier comuna de la RM → zone = "santiago"
   - Si no menciona ubicación → zone = null

REGLAS:
- Solo incluir datos que el cliente mencione EXPLÍCITAMENTE
- NO inventar ni asumir datos
- Dejar null si no se menciona
- El nombre debe ser un nombre real, no "Visitante Web" ni "Cliente"

=== CRITERIOS PARA DETECTAR INTENT ===

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
        quotation_items: [],
        extracted_data: {}
      };
    }

    // Validation helpers
    function isValidChileanPhone(phone: string | null | undefined): boolean {
      if (!phone) return false;
      const cleaned = phone.replace(/[\s\-\(\)]/g, '');
      // Match +569XXXXXXXX or 9XXXXXXXX
      return /^(\+?56)?9\d{8}$/.test(cleaned);
    }

    function isValidEmail(email: string | null | undefined): boolean {
      if (!email) return false;
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function normalizePhone(phone: string): string {
      const cleaned = phone.replace(/[\s\-\(\)]/g, '');
      if (cleaned.startsWith('+56')) return cleaned;
      if (cleaned.startsWith('56')) return '+' + cleaned;
      if (cleaned.startsWith('9')) return '+56' + cleaned;
      return cleaned;
    }

    // Get current contact data to avoid overwriting with nulls
    const { data: currentContact } = await supabase
      .from('contacts')
      .select('name, phone, email, vehicle_brand, vehicle_model, vehicle_year, zone')
      .eq('id', contact_id)
      .single();

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

    // Process extracted personal data
    const extracted = analysis.extracted_data || {};

    // Update name if extracted and not a placeholder
    const extractedName = extracted.name;
    if (extractedName &&
      typeof extractedName === 'string' &&
      extractedName.toLowerCase() !== 'visitante web' &&
      extractedName.toLowerCase() !== 'cliente' &&
      extractedName.toLowerCase() !== 'null' &&
      extractedName.trim().length > 1) {
      const isPlaceholder = !currentContact?.name ||
        currentContact.name === 'Visitante Web' ||
        currentContact.name.startsWith('Web_') ||
        currentContact.name.startsWith('+');

      const currentNameWords = currentContact?.name?.trim().split(/\s+/).length || 0;
      const extractedNameWords = extractedName.trim().split(/\s+/).length || 0;
      const isMoreComplete = extractedNameWords > currentNameWords;

      if (isPlaceholder || isMoreComplete) {
        console.log(`Updating name from "${currentContact?.name}" to "${extractedName.trim()}"`);
        contactUpdate.name = extractedName.trim();
      }
    }

    // Update phone if extracted and valid
    const extractedPhone = extracted.phone;
    if (extractedPhone && isValidChileanPhone(extractedPhone)) {
      // Only update if no phone exists
      if (!currentContact?.phone) {
        contactUpdate.phone = normalizePhone(extractedPhone);
      }
    }

    // Update email if extracted and valid
    const extractedEmail = extracted.email;
    if (extractedEmail && isValidEmail(extractedEmail)) {
      // Only update if no email exists
      if (!currentContact?.email) {
        contactUpdate.email = extractedEmail.toLowerCase().trim();
      }
    }

    // Update vehicle info if extracted
    if (extracted.vehicle_brand && !currentContact?.vehicle_brand) {
      contactUpdate.vehicle_brand = extracted.vehicle_brand;
    }
    if (extracted.vehicle_model && !currentContact?.vehicle_model) {
      contactUpdate.vehicle_model = extracted.vehicle_model;
    }
    if (extracted.vehicle_year && !currentContact?.vehicle_year) {
      const year = parseInt(extracted.vehicle_year, 10);
      if (!isNaN(year) && year >= 1990 && year <= new Date().getFullYear() + 1) {
        contactUpdate.vehicle_year = year;
      }
    }

    // Update zone if extracted and not already set
    if (extracted.zone && ['talca', 'puerto_montt', 'santiago'].includes(extracted.zone) && !currentContact?.zone) {
      contactUpdate.zone = extracted.zone;
    }

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

    console.log('Contact update with extracted data:', {
      ...contactUpdate,
      extracted_name: extracted.name,
      extracted_phone: extracted.phone,
      extracted_email: extracted.email,
    });

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
