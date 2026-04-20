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
  replies: string[];
  intent: 'agendar' | 'consulta' | 'humano' | 'saludo' | 'otro';
  confidence: number;
  should_handoff: boolean;
  should_send_booking_link: boolean;
  reasoning?: string;
  detected_zone?: 'talca' | 'puerto_montt' | 'santiago' | null;
}

interface KnowledgeMatch {
  id: string;
  content: string;
  file_name: string;
  similarity?: number;
}

// Sanitize a keyword for safe use in PostgREST ilike filters
function sanitizeKeyword(str: string): string {
  // Remove characters that break PostgREST .or() parsing: commas, parens, dots, percent, underscores
  return str.replace(/[%_\\(),."']/g, '').trim();
}

// Use AI chat model to expand query into better search keywords
async function expandQueryWithAI(
  lovableApiKey: string,
  query: string
): Promise<string[]> {
  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [
          {
            role: 'system',
            content: `Eres un experto en expansión de consultas de búsqueda. Dado un mensaje de usuario, genera una lista de 8-15 PALABRAS INDIVIDUALES (no frases) relevantes para buscar en una base de conocimiento de productos/servicios.
REGLAS ESTRICTAS:
- Responde SOLO con un JSON array de strings
- Cada string debe ser UNA SOLA PALABRA (sin espacios)
- Incluye: el término original, sinónimos, variaciones sin acento, términos técnicos relacionados
- NO incluyas artículos, preposiciones ni palabras menores a 3 caracteres
- Ejemplo correcto: ["hidrolavadora","hidrolavadoras","presion","limpieza","karcher","agua","industrial"]
- Ejemplo INCORRECTO: ["máquina hidrolavadora","equipo de limpieza"]`
          },
          { role: 'user', content: query }
        ],
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      console.error('Query expansion failed:', response.status);
      return [];
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content?.trim();
    if (!content) return [];

    // Robust JSON extraction: find the array in the response
    let parsed = content;
    // Remove markdown code blocks
    if (parsed.includes('```')) {
      parsed = parsed.replace(/```json?\n?/g, '').replace(/```\n?$/g, '').trim();
    }
    // Try to find JSON array in the text
    const arrayMatch = parsed.match(/\[[\s\S]*?\]/);
    if (!arrayMatch) {
      console.warn('No JSON array found in AI response, extracting words manually');
      // Fallback: extract quoted words
      const wordMatches = content.match(/"([^"]+)"/g);
      if (wordMatches) {
        return wordMatches.map((w: string) => w.replace(/"/g, '').toLowerCase().trim()).filter((w: string) => w.length > 2);
      }
      return [];
    }

    try {
      const keywords = JSON.parse(arrayMatch[0]);
      if (Array.isArray(keywords)) {
        // Split any multi-word entries into individual words and flatten
        const singleWords: string[] = [];
        for (const k of keywords) {
          const word = String(k).toLowerCase().trim();
          if (word.includes(' ')) {
            // Split multi-word into individual words
            for (const part of word.split(/\s+/)) {
              if (part.length > 2) singleWords.push(part);
            }
          } else if (word.length > 2) {
            singleWords.push(word);
          }
        }
        console.log('AI expanded keywords:', singleWords);
        return singleWords;
      }
    } catch (parseErr) {
      console.warn('JSON parse failed, using regex fallback:', parseErr);
      const wordMatches = content.match(/"([^"]+)"/g);
      if (wordMatches) {
        return wordMatches.map((w: string) => w.replace(/"/g, '').toLowerCase().trim()).filter((w: string) => w.length > 2 && !w.includes(' '));
      }
    }
    return [];
  } catch (e) {
    console.error('Query expansion error:', e);
    return [];
  }
}

// Remove accents from text for accent-insensitive matching
function removeAccents(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// AI-enhanced keyword search: expand query with AI then use ILIKE
// deno-lint-ignore no-explicit-any
async function searchKnowledge(
  supabase: any,
  lovableApiKey: string,
  workshopId: string,
  query: string
): Promise<KnowledgeMatch[]> {
  // 0. Detect product codes in query (e.g. W186, NPM-GR, HHP4150, SOC200/41EC)
  const productCodes = query.match(/\b[A-Z]{1,5}[-\/]?[A-Z0-9]{2,10}[-\/]?[A-Z0-9]{0,8}\b/gi) || [];
  const cleanCodes = productCodes
    .map(c => sanitizeKeyword(c))
    .filter(c => c.length >= 2);
  if (cleanCodes.length > 0) {
    console.log('Product codes detected:', cleanCodes);
  }

  // 1. Get AI-expanded keywords
  const aiKeywords = await expandQueryWithAI(lovableApiKey, query);

  // 2. Also extract basic keywords from original query as fallback
  const stopWords = ['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'en', 'con', 'que', 'es', 'y', 'a', 'para', 'por', 'me', 'mi', 'te', 'se', 'lo', 'le', 'su', 'nos', 'al', 'hola', 'buenos', 'dias', 'buenas', 'tardes', 'noches', 'quiero', 'saber', 'sobre', 'necesito', 'busco', 'tienen', 'hay'];
  const basicKeywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.includes(word))
    .slice(0, 5);

  // 3. Also add accent-free versions
  const accentFree: string[] = [];
  for (const k of [...aiKeywords, ...basicKeywords]) {
    const noAccent = removeAccents(k);
    if (noAccent !== k) accentFree.push(noAccent);
  }

  // 4. Merge, deduplicate, sanitize - product codes first for priority
  const allKeywords = [...new Set([...cleanCodes, ...aiKeywords, ...basicKeywords, ...accentFree])]
    .map(k => sanitizeKeyword(k))
    .filter(k => k.length > 2 && !k.includes(' '))
    .slice(0, 20);

  if (allKeywords.length === 0) return [];

  console.log('Searching knowledge with sanitized keywords:', allKeywords);

  // Build safe OR filter - each keyword is a single word, no spaces
  const orFilter = allKeywords.map(k => `content.ilike.%${k}%`).join(',');

  try {
    const { data, error } = await supabase
      .from('bot_knowledge')
      .select('id, content, file_name')
      .eq('workshop_id', workshopId)
      .or(orFilter)
      .limit(15);

    if (error) {
      console.error('Knowledge search error:', error);
      // Fallback: try with just the first 3 basic keywords
      if (basicKeywords.length > 0) {
        console.log('Retrying with basic keywords only...');
        const fallbackFilter = basicKeywords.slice(0, 3).map(k => `content.ilike.%${sanitizeKeyword(k)}%`).join(',');
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('bot_knowledge')
          .select('id, content, file_name')
          .eq('workshop_id', workshopId)
          .or(fallbackFilter)
          .limit(15);
        
        if (!fallbackError && fallbackData) {
          console.log('Fallback search returned', fallbackData.length, 'matches');
          return fallbackData as KnowledgeMatch[];
        }
      }
      return [];
    }

    console.log('AI-enhanced search returned', (data || []).length, 'matches');
    return (data || []) as KnowledgeMatch[];
  } catch (searchErr) {
    console.error('Search execution error:', searchErr);
    return [];
  }
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

      if (profileError || !profile) {
        return new Response(JSON.stringify({ error: 'Profile not found' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // SUPERADMIN can simulate any workshop; others must match their own
      if (profile.role !== 'SUPERADMIN' && profile.workshop_id !== workshop_id) {
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
      .select('id, name, booking_url, slug, phone, address, city, booking_mode, zone_detection_enabled')
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

    // ===== RAG: AI-enhanced keyword search =====
    let ragContext = '';
    let ragMatchCount = 0;
    try {
      const knowledgeMatches = await searchKnowledge(supabase, lovableApiKey, workshop_id, message_text);

      if (knowledgeMatches && knowledgeMatches.length > 0) {
        console.log('RAG found matches:', knowledgeMatches.length);
        ragMatchCount = knowledgeMatches.length;
        ragContext = `\nDOCUMENTACIÓN DE REFERENCIA (usa esta información para responder):\n${knowledgeMatches
          .map((k, i) => `[${i + 1}] ${k.content}`)
          .join('\n---\n')
          }\n`;
      }
    } catch (ragError) {
      console.error('RAG error (continuing without RAG):', ragError);
    }

    // ===== Detect product/catalog query for anti-hallucination =====
    const lowerMsg = removeAccents(message_text.toLowerCase());
    const productQueryRe = /\b(producto|productos|categoria|categorias|catalogo|marca|marcas|modelo|modelos|precio|precios|valor|cuanto cuesta|cuanto vale|stock|disponible|tienen|venden|ofrecen|vendes|ofreces|tienes|que ofrecen|que venden|que tienen|cuanto)\b/;
    const isProductQuery = productQueryRe.test(lowerMsg);
    const ragEmpty = ragMatchCount === 0;

    // Validate conversation belongs to workshop if it exists
    const { data: conversation } = await supabase
      .from('conversations')
      .select('workshop_id, contact_id, assigned_to_user_id')
      .eq('id', conversation_id)
      .maybeSingle();

    if (conversation?.workshop_id && conversation.workshop_id !== workshop_id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load contact zone (for zone-detection feature)
    let contactRecord: { id: string; zone: string | null } | null = null;
    if (conversation?.contact_id) {
      const { data: c } = await supabase
        .from('contacts')
        .select('id, zone')
        .eq('id', conversation.contact_id)
        .maybeSingle();
      if (c) contactRecord = c as { id: string; zone: string | null };
    }
    const zoneDetectionEnabled = !!(workshop as any).zone_detection_enabled;
    const needsZone = zoneDetectionEnabled && contactRecord && !contactRecord.zone;

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

    // Build booking URL
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

    // Build context information
    const contextInfo = `
INFORMACIÓN DEL NEGOCIO:
- Nombre: ${workshop.name}
- Dirección: ${workshop.address || 'Consultar'}
- Ciudad: ${workshop.city || 'Chile'}
- Teléfono: ${workshop.phone || 'Consultar'}
${workshop.id === '610fb257-a649-4115-b944-21f31e7952db' ? '- Zonas de operación: Talca, Puerto Montt, Santiago' : ''}
${settings.business_description ? `- Descripción: ${settings.business_description}` : ''}

SERVICIOS DISPONIBLES:
${servicesText}

${faqText ? `PREGUNTAS FRECUENTES:\n${faqText}` : ''}

${fullBookingUrl && workshop.booking_mode === 'with_scheduling' ? `LINK DE AGENDAMIENTO: ${fullBookingUrl}` : ''}

REGLA CRÍTICA ANTI-INVENCIÓN (PRIORIDAD MÁXIMA):
- ESTÁ ESTRICTAMENTE PROHIBIDO inventar, suponer o "deducir" productos, categorías, marcas, modelos, precios, stocks, características técnicas o servicios que NO aparezcan literalmente en el bloque "DOCUMENTACIÓN DE REFERENCIA" o en "SERVICIOS DISPONIBLES".
- NO digas frases como "tenemos varios modelos", "manejamos las principales marcas", "contamos con un amplio catálogo" si no hay datos concretos en el contexto. Eso es ALUCINAR.
- Si el cliente pregunta por un producto/categoría/precio/marca específico y NO está en el contexto, responde EXACTAMENTE algo como: "No tengo esa información específica documentada en este momento, déjame conectarte con un ejecutivo que podrá ayudarte mejor 👤" y marca should_handoff=true e intent="humano".
- Es 100x mejor decir "no tengo esa información, te derivo con un ejecutivo" que inventar un dato falso. La honestidad construye confianza, la invención destruye la marca.
- Si el contexto SÍ tiene la información, úsala literalmente (no la "embellezcas" con datos extra que no aparecen).

${zoneDetectionEnabled ? `ZONA DEL CLIENTE (REGLA CRÍTICA):
${needsZone
  ? `- El contacto AÚN NO tiene zona asignada. ANTES de cotizar, agendar o derivar al equipo, DEBES preguntar de forma natural desde qué ciudad o comuna escribe.
- Zonas válidas: *Talca / Maule*, *Puerto Montt / Los Lagos*, *Santiago / RM*.
- Hazlo en el saludo o apenas el cliente mencione su necesidad. Solo una vez, no insistas si ya la mencionó.
- Si el cliente menciona una ciudad o comuna, asóciala a la zona más cercana.`
  : `- El contacto ya tiene zona asignada: *${contactRecord?.zone}*. NO vuelvas a preguntarla. Personaliza la respuesta según esa zona cuando sea relevante.`}
- Si en este mensaje el cliente menciona explícitamente una ciudad/comuna, devuelve también el campo "detected_zone" en el JSON ("talca" | "puerto_montt" | "santiago" | null). Si no la menciona, usa null.` : ''}
${ragContext}`;

    const isChatbotOnly = workshop.booking_mode === 'chatbot_only';

    // Build system prompt
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

    // Call Lovable AI
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
  "reasoning": "Breve explicación técnica de por qué se eligió esta respuesta y este intent"${zoneDetectionEnabled ? `,
  "detected_zone": ${needsZone ? '"talca" | "puerto_montt" | "santiago" | null' : 'null'}` : ''}
}

REGLAS DE FORMATO:
- "reasoning" debe explicar qué detectaste en el mensaje del cliente
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
        return new Response(JSON.stringify({ error: 'Rate limit exceeded, please try again later' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (aiResponse.status === 402) {
        console.error('Payment required');
        return new Response(JSON.stringify({ error: 'AI credits exhausted' }), {
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
      const parsed = JSON.parse(jsonContent);
      if (parsed.reply && !parsed.replies) {
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

    // ===== Zone detection & auto-assignment =====
    if (zoneDetectionEnabled && contactRecord && !contactRecord.zone) {
      let detectedZone: 'talca' | 'puerto_montt' | 'santiago' | null = null;
      const aiZone = (result as any).detected_zone;
      if (aiZone === 'talca' || aiZone === 'puerto_montt' || aiZone === 'santiago') {
        detectedZone = aiZone;
      } else {
        // Regex fallback on the latest user message
        const txt = removeAccents(message_text.toLowerCase());
        const talcaRe = /\b(talca|maule|curico|linares|san javier|constitucion|cauquenes|molina)\b/;
        const pmRe = /\b(puerto montt|pto\.? montt|los lagos|osorno|puerto varas|llanquihue|castro|chiloe|ancud)\b/;
        const stgoRe = /\b(santiago|stgo|region metropolitana|\brm\b|providencia|las condes|maipu|nunoa|la florida|puente alto|san bernardo|vitacura|la reina|penalolen|quilicura|recoleta|independencia|estacion central|macul|lo barnechea|huechuraba)\b/;
        if (talcaRe.test(txt)) detectedZone = 'talca';
        else if (pmRe.test(txt)) detectedZone = 'puerto_montt';
        else if (stgoRe.test(txt)) detectedZone = 'santiago';
      }

      if (detectedZone) {
        try {
          const { error: updErr } = await supabase
            .from('contacts')
            .update({ zone: detectedZone })
            .eq('id', contactRecord.id);
          if (updErr) {
            console.error('Failed to update contact zone:', updErr);
          } else {
            console.log(`Contact ${contactRecord.id} assigned to zone: ${detectedZone}`);

            // Auto-assign conversation to a STAFF in that zone (if currently unassigned)
            if (!conversation?.assigned_to_user_id) {
              const { data: staffList } = await supabase
                .from('profiles')
                .select('id')
                .eq('workshop_id', workshop_id)
                .eq('status', 'active')
                .eq('zone', detectedZone);

              const staff = (staffList || []) as Array<{ id: string }>;
              let chosen: string | null = null;
              if (staff.length === 1) {
                chosen = staff[0].id;
              } else if (staff.length > 1) {
                // Round-robin: pick STAFF with fewest open conversations
                const counts = await Promise.all(
                  staff.map(async (s) => {
                    const { count } = await supabase
                      .from('conversations')
                      .select('id', { count: 'exact', head: true })
                      .eq('workshop_id', workshop_id)
                      .eq('assigned_to_user_id', s.id)
                      .in('status', ['new', 'in_progress']);
                    return { id: s.id, count: count || 0 };
                  })
                );
                counts.sort((a, b) => a.count - b.count);
                chosen = counts[0].id;
              }

              if (chosen) {
                await supabase
                  .from('conversations')
                  .update({ assigned_to_user_id: chosen })
                  .eq('id', conversation_id);
                console.log(`Conversation ${conversation_id} auto-assigned to staff ${chosen}`);
              }
            }

            // Audit log
            await supabase.from('health_logs').insert({
              workshop_id,
              event_type: 'info',
              category: 'bot',
              message: `Zona asignada automáticamente: ${detectedZone}`,
              metadata: {
                contact_id: contactRecord.id,
                conversation_id,
                zone: detectedZone,
                source: aiZone ? 'ai' : 'regex',
              },
            });
          }
        } catch (zoneErr) {
          console.error('Zone assignment error:', zoneErr);
        }
      }
    }

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
        workshop_id: null,
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
