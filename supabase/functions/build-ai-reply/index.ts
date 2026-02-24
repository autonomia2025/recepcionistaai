import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BotSettings {
  business_description: string | null;
  services_json: Array<{ name: string; price?: number; description?: string; stock?: number }>;
  faq_json: Array<{ question: string; answer: string }>;
  tone: string | null;
  system_prompt: string | null;
}

interface Workshop {
  id: string;
  name: string;
  booking_url: string | null;
  slug: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  booking_mode: 'with_scheduling' | 'chatbot_only';
}

interface AIReplyResult {
  replies: string[]; // Array of messages to send
  intent: 'agendar' | 'consulta' | 'humano' | 'saludo' | 'otro';
  confidence: number;
  should_handoff: boolean;
  should_send_booking_link: boolean;
  reasoning?: string; // AI's internal logic for this reply
}

interface KnowledgeMatch {
  id: string;
  content: string;
  file_name: string;
}

// Escape SQL wildcards in user input to prevent pattern injection
function escapeLikePattern(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&');
}

// Simple text-based search for knowledge (no embeddings needed)
// deno-lint-ignore no-explicit-any
async function searchKnowledge(
  supabase: any,
  workshopId: string,
  query: string
): Promise<KnowledgeMatch[]> {
  // Extract keywords from query (remove common words)
  const stopWords = ['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'en', 'con', 'que', 'es', 'y', 'a', 'para', 'por'];
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.includes(word))
    .slice(0, 5) // Take top 5 keywords
    .map(escapeLikePattern); // Escape SQL wildcards to prevent pattern injection

  if (keywords.length === 0) return [];

  // Use ilike for text search with escaped keywords
  const { data, error } = await supabase
    .from('bot_knowledge')
    .select('id, content, file_name')
    .eq('workshop_id', workshopId)
    .or(keywords.map((k: string) => `content.ilike.%${k}%`).join(','))
    .limit(5);

  if (error) {
    console.error('Knowledge search error:', error);
    return [];
  }

  return (data || []) as KnowledgeMatch[];
}

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
    const { conversation_id, workshop_id, message_text, contact_name } = await req.json();

    if (!conversation_id || !workshop_id || !message_text) {
      return new Response(JSON.stringify({
        error: 'Missing required fields: conversation_id, workshop_id, message_text'
      }), {
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

    // Security check: only allow if it's service role or the owner of the workshop
    if (!isServiceRole && authData?.user) {
      const { data: profile, error: profileError } = await authSupabase
        .from('profiles')
        .select('workshop_id, role')
        .eq('id', authData.user.id)
        .single();

      if (profileError || !profile?.workshop_id) {
        return new Response(JSON.stringify({ error: 'Profile not found' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (profile.workshop_id !== workshop_id && profile.role !== 'SUPERADMIN') {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      console.log('Service role or direct internal call detected, bypassing profile check');
    }

    console.log('Building AI reply for:', { conversation_id, workshop_id, message_text: message_text.substring(0, 50) });

    // Get workshop info
    const { data: workshop, error: workshopError } = await supabase
      .from('workshops')
      .select('id, name, booking_url, slug, phone, address, city, booking_mode')
      .eq('id', workshop_id)
      .single();

    if (workshopError || !workshop) {
      console.error('Workshop not found:', workshopError);
      return new Response(JSON.stringify({ error: 'Workshop not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get bot settings for this workshop
    const { data: botSettings, error: botError } = await supabase
      .from('bot_settings')
      .select('business_description, services_json, faq_json, tone, system_prompt')
      .eq('workshop_id', workshop_id)
      .single();

    if (botError) {
      console.log('Bot settings not found, using defaults');
    }

    const settings: BotSettings = {
      business_description: botSettings?.business_description || `${workshop.name} es un negocio.`,
      services_json: (botSettings?.services_json as BotSettings['services_json']) || [],
      faq_json: (botSettings?.faq_json as BotSettings['faq_json']) || [],
      tone: botSettings?.tone || 'professional',
      system_prompt: botSettings?.system_prompt || null,
    };

    // ===== RAG: Search for relevant knowledge using text search =====
    let ragContext = '';
    try {
      const knowledgeMatches = await searchKnowledge(supabase, workshop_id, message_text);

      if (knowledgeMatches && knowledgeMatches.length > 0) {
        console.log('RAG found matches:', knowledgeMatches.length);
        ragContext = `\nDOCUMENTACIÓN DE REFERENCIA (usa esta información para responder):\n${knowledgeMatches
          .map((k, i) => `[${i + 1}] ${k.content}`)
          .join('\n---\n')
          }\n`;
      }
    } catch (ragError) {
      console.error('RAG error (continuing without RAG):', ragError);
    }

    // Validate conversation belongs to workshop if it exists
    const { data: conversation } = await supabase
      .from('conversations')
      .select('workshop_id')
      .eq('id', conversation_id)
      .maybeSingle();

    if (conversation?.workshop_id && conversation.workshop_id !== workshop_id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get conversation history (last 10 messages)
    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('text, direction, created_at')
      .eq('conversation_id', conversation_id)
      .order('created_at', { ascending: false })
      .limit(10);

    if (messagesError) {
      console.error('Error fetching messages:', messagesError);
    }

    // Format conversation history (newest first, then reverse for context)
    const conversationHistory = (messages || [])
      .reverse()
      .map(m => `${m.direction === 'inbound' ? 'Cliente' : 'Negocio'}: ${m.text}`)
      .join('\n');

    // Build booking URL - use configured URL from DB (set at publish time with correct domain)
    let fullBookingUrl: string | null = null;
    if (workshop.booking_url) {
      fullBookingUrl = workshop.booking_url;
    }

    console.log('Booking URL configured:', fullBookingUrl);

    // Format services for prompt
    const clpFormatter = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
    const servicesText = settings.services_json.length > 0
      ? settings.services_json.map(s =>
        `- ${s.name}`
        + `${s.price !== undefined ? ` (${clpFormatter.format(s.price)})` : ''}`
        + `${s.stock !== undefined ? ` (Stock: ${s.stock})` : ''}`
        + `${s.description ? `: ${s.description}` : ''}`
      ).join('\n')
      : 'No hay servicios específicos configurados.';

    // Format FAQ for prompt
    const faqText = settings.faq_json.length > 0
      ? settings.faq_json.map(f => `P: ${f.question}\nR: ${f.answer}`).join('\n\n')
      : '';

    // Build tone instructions
    const toneInstructions = {
      'professional': 'Mantén un tono profesional y formal pero amigable.',
      'friendly': 'Usa un tono cercano, amigable y cálido. Usa emojis ocasionalmente.',
      'casual': 'Sé muy casual y relajado, como hablando con un amigo.',
      'formal': 'Mantén un tono muy formal y respetuoso en todo momento.',
    }[settings.tone || 'professional'] || 'Mantén un tono profesional.';

    // Build context information that is always included
    const contextInfo = `
INFORMACIÓN DEL NEGOCIO:
- Nombre: ${workshop.name}
- Dirección: ${workshop.address || 'Consultar'}
- Ciudad: ${workshop.city || 'Chile'}
- Teléfono: ${workshop.phone || 'Consultar'}
${settings.business_description ? `- Descripción: ${settings.business_description}` : ''}

SERVICIOS DISPONIBLES:
${servicesText}

${faqText ? `PREGUNTAS FRECUENTES:\n${faqText}` : ''}

${fullBookingUrl && workshop.booking_mode === 'with_scheduling' ? `LINK DE AGENDAMIENTO: ${fullBookingUrl}` : ''}
${ragContext}`;

    // Determine if this is a chatbot-only business (no scheduling)
    const isChatbotOnly = workshop.booking_mode === 'chatbot_only';

    // Build system prompt - if custom prompt exists, append context; otherwise use default
    let systemPrompt: string;

    if (settings.system_prompt) {
      systemPrompt = `${settings.system_prompt}

${contextInfo}

FORMATO WHATSAPP - USA ESTO:
- *texto* para negritas (títulos, destacados)
- _texto_ para cursivas
- Usa viñetas con • o - para listas
- Separa ideas con saltos de línea

IMPORTANTE: Responde SOLO con JSON válido, sin texto adicional ni markdown.${isChatbotOnly ? '\nNO menciones agendamiento, citas ni links de booking.' : ''}`;
    } else if (isChatbotOnly) {
      systemPrompt = `Eres el asistente virtual profesional de ${workshop.name}.

${contextInfo}

INSTRUCCIONES DE COMUNICACIÓN:
1. ${toneInstructions}
2. Responde en español chileno, de forma clara y estructurada.
3. Tu rol es atender clientes, resolver dudas y asistir en ventas.
4. NO ofrezcas agendar citas ni menciones links de booking.
5. Si no tienes información sobre algo, di que consultarás con el equipo.
6. Si el cliente pide hablar con una persona, responde que lo derivarás con un asesor.
7. NO inventes precios o productos que no estén en la lista.
8. PRIORIZA usar la información de la DOCUMENTACIÓN DE REFERENCIA si está disponible.

FORMATO WHATSAPP - USA ESTO:
- *texto* para negritas (títulos, nombres de servicios, precios)
- _texto_ para cursivas (énfasis suave)
- Usa viñetas con • o - para listas
- Separa secciones con saltos de línea

CUÁNDO DIVIDIR EN MÚLTIPLES MENSAJES:
- SOLO divide si hay más de 800 caracteres de información
- SOLO divide si hay temas claramente diferentes (ej: info de servicios + link de agenda)
- Para respuestas cortas (saludos, confirmaciones, preguntas simples): USA UN SOLO MENSAJE
- Máximo 2 mensajes, rara vez 3

IMPORTANTE: Responde SOLO con JSON válido, sin texto adicional.`;
    } else {
      systemPrompt = `Eres el asistente virtual profesional de ${workshop.name}.
${settings.business_description ? `\n${settings.business_description}\n` : ''}
${contextInfo}

INSTRUCCIONES DE COMUNICACIÓN:
1. ${toneInstructions}
2. Responde en español chileno, de forma clara y estructurada.
3. Si el cliente quiere agendar, menciona el link de agendamiento.
4. Si no tienes información sobre algo, di que consultarás con el equipo.
5. Si el cliente pide hablar con una persona, responde que lo derivarás con un asesor.
6. NO inventes precios o servicios que no estén en la lista.
7. PRIORIZA usar la información de la DOCUMENTACIÓN DE REFERENCIA si está disponible.

FORMATO WHATSAPP - USA ESTO:
- *texto* para negritas (títulos, nombres de servicios, precios)
- _texto_ para cursivas (énfasis suave)
- Usa viñetas con • o - para listas
- Separa secciones con saltos de línea

CUÁNDO DIVIDIR EN MÚLTIPLES MENSAJES:
- SOLO divide si hay más de 800 caracteres de información
- SOLO divide si hay temas claramente diferentes (ej: info de servicios + link de agenda)
- Para respuestas cortas (saludos, confirmaciones, preguntas simples): USA UN SOLO MENSAJE
- Máximo 2 mensajes, rara vez 3

IMPORTANTE: Responde SOLO con JSON válido, sin texto adicional.`;
    }

    console.log('Using system prompt length:', systemPrompt.length, 'custom:', !!settings.system_prompt, 'hasRAG:', !!ragContext);

    // Call Lovable AI with correct model
    console.log('Calling Lovable AI gateway...');
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-5-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Historial de conversación:
${conversationHistory || '(Primera interacción)'}

Nuevo mensaje del cliente${contact_name ? ` (${contact_name})` : ''}: "${message_text}"

Analiza el mensaje y responde con este JSON exacto:
{
  "replies": ["Mensaje 1 con formato WhatsApp", "Mensaje 2 si es necesario"],
  "intent": "${isChatbotOnly ? 'consulta|humano|saludo|otro' : 'agendar|consulta|humano|saludo|otro'}",
  "confidence": 0.95,
  "should_handoff": false,
  "should_send_booking_link": false,
  "reasoning": "Breve explicación técnica de por qué se eligió esta respuesta y este intent"
}

REGLAS DE FORMATO:
- "reasoning" debe explicar qué detectaste en el mensaje del cliente (ej: 'El cliente pregunta por precios de frenos, se activa intent cotizacion')
- "replies" es un ARRAY (normalmente 1 mensaje, máximo 2-3 solo si es necesario)
- Usa *negritas* para títulos y destacados
- Usa • o - para listas/viñetas  
- Usa emojis apropiados (📍 📞 💰 ⏰ 🔧 ✅)
- PREFIERE un solo mensaje bien formateado
- SOLO divide si supera 800 caracteres O hay temas muy diferentes

Criterios:${isChatbotOnly ? '' : `
- intent "agendar": cliente quiere hora, cita, disponibilidad, reservar`}
- intent "humano": cliente pide hablar con persona, asesor, humano
- intent "consulta": preguntas sobre servicios, precios, información
- intent "saludo": saludos simples (hola, buenos días, etc)
- should_handoff: true solo si pide explícitamente hablar con humano
- should_send_booking_link: ${isChatbotOnly ? 'siempre false (no hay agenda)' : 'true si quiere agendar Y tenemos link disponible'}`
          }
        ],
      }),
    });

    console.log('AI response status:', aiResponse.status);

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        console.error('Rate limit exceeded');
        return new Response(JSON.stringify({
          error: 'Rate limit exceeded, please try again later'
        }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (aiResponse.status === 402) {
        console.error('Payment required');
        return new Response(JSON.stringify({
          error: 'AI credits exhausted'
        }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const errorText = await aiResponse.text();
      console.error('AI API error:', aiResponse.status, errorText);
      throw new Error('AI API error');
    }

    const aiResult = await aiResponse.json();
    const aiContent = aiResult.choices?.[0]?.message?.content;

    console.log('AI raw response:', aiContent);

    if (!aiContent) {
      throw new Error('Empty AI response');
    }

    // Parse AI response
    let result: AIReplyResult;
    try {
      let jsonContent = aiContent.trim();
      if (jsonContent.startsWith('```')) {
        jsonContent = jsonContent.replace(/```json?\n?/g, '').replace(/```\n?$/g, '').trim();
      }
      // Handle both old format (reply) and new format (replies)
      const parsed = JSON.parse(jsonContent);
      if (parsed.reply && !parsed.replies) {
        // Convert old format to new format
        parsed.replies = [parsed.reply];
      }
      result = parsed;
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiContent);
      result = {
        replies: ['Gracias por tu mensaje. Un asesor te contactará pronto.'],
        intent: 'otro',
        confidence: 0.5,
        should_handoff: true,
        should_send_booking_link: false,
      };
    }

    // Append booking link to last message if needed
    const lastReply = result.replies[result.replies.length - 1] || '';
    if (result.should_send_booking_link && fullBookingUrl && !lastReply.includes(fullBookingUrl)) {
      result.replies.push(`📅 *Agenda tu hora aquí:*\n${fullBookingUrl}`);
    }

    console.log('AI reply result:', result);

    return new Response(JSON.stringify({
      success: true,
      ...result,
      booking_url: fullBookingUrl,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Build AI reply error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';

    // Log error to health_logs for monitoring
    try {
      await supabase.from('health_logs').insert({
        workshop_id: null, // Will be null if we couldn't identify the workshop
        event_type: 'error',
        category: 'bot',
        message: `AI reply error: ${message}`,
        metadata: { error: message, timestamp: new Date().toISOString() }
      });
    } catch (logErr) {
      console.error('Failed to log to health_logs:', logErr);
    }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
