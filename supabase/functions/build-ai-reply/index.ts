import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type DatasheetDocument,
  extractProductCodes,
  normalizeProductCode,
  resolvePdfDatasheets,

} from "../_shared/datasheets.ts";

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
  document_id?: string | null;
  similarity?: number;
  score?: number;
  codeHit?: boolean;
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

function compactText(str: string): string {
  return (str || '').replace(/\s+/g, ' ').trim();
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return compactText(value).replace(/[|#]+$/g, '').trim();
  }
  return null;
}

function buildDocumentedProductReply(match: KnowledgeMatch): string {
  const text = compactText(match.content || '');
  const code = firstMatch(text, [
    /(?:SKU|C[ÓO]DIGO)\s*[:|]?\s*([A-Z0-9][A-Z0-9\/\-.]{3,40})/i,
    /\b(SOC\d+[A-Z0-9\/-]*)\b/i,
  ]);
  const name = firstMatch(text, [
    /Nombre del Producto:\s*([^|]{8,140})/i,
    /(Hidrolavadora[^|.]{8,140})/i,
    /\*?SKU:\s*[A-Z0-9\/\-.]+\s+([^|.]{8,120})/i,
  ]);

  const bullets: string[] = [];
  const tableSpecs = text.match(/\b(SOC\d+[A-Z0-9\/-]*)\s*-\s*(\d+\/\d+)\s+(\d+)\s+-\s+(\d+)/i);
  if (tableSpecs) {
    if (!code) bullets.push(`Código: ${tableSpecs[1]}`);
    bullets.push(`Presión: ${tableSpecs[2]} bar/PSI`);
    bullets.push(`Caudal: ${tableSpecs[3]} L/min`);
    bullets.push(`Potencia: ${tableSpecs[4]} HP`);
  }

  const model = firstMatch(text, [/MODELO:\s*([^:]{2,80})(?=\s+[A-ZÁÉÍÓÚÑ ]{3,}:|$)/i]);
  const power = firstMatch(text, [/ALIMENTACI[ÓO]N:\s*([^:]{2,80})(?=\s+[A-ZÁÉÍÓÚÑ ]{3,}:|$)/i]);
  const fuel = firstMatch(text, [/CONSUMO COMBUSTIBLE:\s*([^:]{2,80})(?=\s+[A-ZÁÉÍÓÚÑ ]{3,}:|$)/i]);
  const description = firstMatch(text, [/Descripci[óo]n:\s*([^|]{40,280})/i]);

  if (model) bullets.unshift(`Modelo: ${model}`);
  if (power) bullets.push(`Alimentación: ${power}`);
  if (fuel) bullets.push(`Consumo combustible: ${fuel}`);
  if (description && bullets.length < 5) bullets.push(description);

  const uniqueBullets = [...new Set(bullets)].slice(0, 5);
  const header = code || name ? `Encontré información para *${code || name}*:` : `Encontré información documentada en *${match.file_name}*:`;

  return `*Sí, ese modelo está documentado ✅*\n\n${header}\n${name && code ? `• Producto: ${name}\n` : ''}${uniqueBullets.map(b => `• ${b}`).join('\n')}\n\n¿Quieres que te ayude con la cotización o disponibilidad según tu zona?`;
}

// AI-enhanced keyword search: expand query with AI then use ILIKE
// deno-lint-ignore no-explicit-any
async function keywordSearchKnowledge(
  supabase: any,
  lovableApiKey: string,
  workshopId: string,
  query: string
): Promise<KnowledgeMatch[]> {
  // 0a. Skip RAG entirely on low-signal messages (greetings, thanks, "ok", etc.)
  //     RAG on "hola" only pollutes the prompt with random product chunks and
  //     pushes the AI to a generic answer.
  const GREETING_RE = /^(hola+|holi|buenas?(\s+(dias|tardes|noches))?|buen\s+dia|hey+|que\s+tal|qtal|saludos|gracias|muchas\s+gracias|ok|okay|listo|si+|no+|👍|👋|🙏)[\s!¡?¿.,]*$/i;
  const normalizedQuery = (query || '').trim();
  if (!normalizedQuery || normalizedQuery.length < 4 || GREETING_RE.test(normalizedQuery)) {
    console.log('RAG skipped: low-signal/greeting message');
    return [];
  }

  // 0. Detect product codes in query (e.g. W186, NPM-GR, HHP4150, SOC200/41EC)
  // Must mix letters AND digits to avoid matching common Spanish words like "necesito".
  const productCodeRe = /\b[A-Za-z][A-Za-z0-9\-\/]{2,20}\b/g;
  const rawCodes = query.match(productCodeRe) || [];
  const cleanCodes = rawCodes
    .filter(c => /[A-Za-z]/.test(c) && /[0-9]/.test(c)) // must contain at least one letter AND one digit
    .map(c => sanitizeKeyword(c))
    .filter(c => c.length >= 3);
  if (cleanCodes.length > 0) {
    console.log('Product codes detected:', cleanCodes);
  }

  // 1. Get AI-expanded keywords.
  //    Skip the expansion call when the query already carries product codes or is
  //    long enough to have its own keywords: it saves ~1-2s of latency per reply.
  const t0 = Date.now();
  const skipExpansion = cleanCodes.length > 0 || query.trim().split(/\s+/).length >= 6;
  const aiKeywords = skipExpansion ? [] : await expandQueryWithAI(lovableApiKey, query);
  if (!skipExpansion) console.log('Query expansion took', Date.now() - t0, 'ms');

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
      .select('id, content, file_name, document_id')
      .eq('workshop_id', workshopId)
      .or(orFilter)
      .limit(40);

    if (error) {
      console.error('Knowledge search error:', error);
      // Fallback: try with just the first 3 basic keywords
      if (basicKeywords.length > 0) {
        console.log('Retrying with basic keywords only...');
        const fallbackFilter = basicKeywords.slice(0, 3).map(k => `content.ilike.%${sanitizeKeyword(k)}%`).join(',');
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('bot_knowledge')
          .select('id, content, file_name, document_id')
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

    const rawMatches = (data || []) as KnowledgeMatch[];
    if (rawMatches.length === 0) return [];

    // Score each chunk by how many distinct keywords/codes it contains.
    // Product codes count 3x because they are the strongest relevance signal.
    const codeSet = new Set(cleanCodes.map(c => c.toLowerCase()));
    const kwSet = new Set(allKeywords.map(k => k.toLowerCase()).filter(k => !codeSet.has(k)));

    const scored = rawMatches.map(m => {
      const lower = removeAccents((m.content || '').toLowerCase());
      let score = 0;
      let codeHit = false;
      for (const code of codeSet) {
        if (lower.includes(code)) { score += 3; codeHit = true; }
      }
      for (const kw of kwSet) {
        if (lower.includes(kw)) score += 1;
      }
      return { match: m, score, codeHit };
    });

    // If query had product codes, keep only chunks that mention at least one code.
    const filtered = codeSet.size > 0 && scored.some(s => s.codeHit)
      ? scored.filter(s => s.codeHit)
      : scored.filter(s => s.score >= 2); // need ≥2 keyword hits to be considered relevant

    const final = (filtered.length > 0 ? filtered : scored)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map(s => ({ ...s.match, score: s.score, codeHit: s.codeHit }));

    console.log(
      `AI-enhanced search: ${rawMatches.length} raw → ${final.length} ranked (codes:${codeSet.size}, kws:${kwSet.size})`
    );
    console.log('Top RAG matches:', final.map(m => ({ file: m.file_name, score: m.score, codeHit: m.codeHit, preview: (m.content || '').slice(0, 140) })));
    return final;
  } catch (searchErr) {
    console.error('Search execution error:', searchErr);
    return [];
  }
}

// ---- Semantic (vector) search ------------------------------------------------
// bot_knowledge.embedding is vector(768); we ask the gateway for 768 dims so the
// query vector matches the stored ones and the HNSW index is used.
const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const EMBEDDING_DIMS = 768;

async function embedQuery(lovableApiKey: string, text: string): Promise<number[] | null> {
  try {
    const res = await fetch('https://ai.gateway.lovable.dev/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${lovableApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: text.slice(0, 8000), dimensions: EMBEDDING_DIMS }),
    });
    if (!res.ok) {
      console.error('Query embedding failed:', res.status, await res.text());
      return null;
    }
    const json = await res.json();
    const vec = json?.data?.[0]?.embedding;
    return Array.isArray(vec) && vec.length === EMBEDDING_DIMS ? vec : null;
  } catch (err) {
    console.error('Query embedding error:', err);
    return null;
  }
}

// deno-lint-ignore no-explicit-any
async function semanticSearchKnowledge(
  supabase: any,
  lovableApiKey: string,
  workshopId: string,
  query: string,
  limit = 5
): Promise<KnowledgeMatch[]> {
  const t0 = Date.now();
  const vector = await embedQuery(lovableApiKey, query);
  if (!vector) return [];
  try {
    const { data, error } = await supabase.rpc('match_bot_knowledge', {
      query_embedding: `[${vector.join(',')}]`,
      p_workshop_id: workshopId,
      match_threshold: 0.35,
      match_count: limit,
    });
    if (error) {
      console.error('Semantic search error:', error);
      return [];
    }
    const matches = (data || []) as Array<{ id: string; content: string; file_name: string; similarity: number }>;
    console.log(
      `Semantic search: ${matches.length} matches in ${Date.now() - t0}ms`,
      matches.map(m => ({ file: m.file_name, sim: Number(m.similarity?.toFixed?.(3) ?? m.similarity) }))
    );
    return matches.map(m => ({
      id: m.id,
      content: m.content,
      file_name: m.file_name,
      document_id: undefined,
      score: 0,
      codeHit: false,
      semantic: true,
      similarity: m.similarity,
      // deno-lint-ignore no-explicit-any
    })) as any as KnowledgeMatch[];
  } catch (err) {
    console.error('Semantic search execution error:', err);
    return [];
  }
}

// Hybrid search: keyword/ILIKE first (exact SKUs win), semantic as complement
// so that a client wording that does not literally match the documents still
// retrieves context instead of leaving the model to improvise.
// deno-lint-ignore no-explicit-any
async function searchKnowledge(
  supabase: any,
  lovableApiKey: string,
  workshopId: string,
  query: string
): Promise<KnowledgeMatch[]> {
  const keywordMatches = await keywordSearchKnowledge(supabase, lovableApiKey, workshopId, query);

  // Exact product-code hits are authoritative; don't dilute them.
  const hasCodeHit = keywordMatches.some((m) => (m as { codeHit?: boolean }).codeHit);
  if (hasCodeHit && keywordMatches.length >= 3) return keywordMatches;

  const normalized = (query || '').trim();
  if (normalized.length < 4) return keywordMatches;

  const semanticMatches = await semanticSearchKnowledge(
    supabase,
    lovableApiKey,
    workshopId,
    normalized,
    keywordMatches.length === 0 ? 6 : 4
  );
  if (semanticMatches.length === 0) return keywordMatches;

  const seen = new Set(keywordMatches.map((m) => m.id));
  const merged = [...keywordMatches];
  for (const m of semanticMatches) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      merged.push(m);
    }
  }
  console.log(`Hybrid RAG: ${keywordMatches.length} keyword + ${semanticMatches.length} semantic → ${merged.length} total`);
  return merged.slice(0, 8);
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
      .select('business_description, services_json, faq_json, tone, system_prompt, send_pdf_datasheets')
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
    let directCodeMatch: KnowledgeMatch | null = null;
    try {
      const knowledgeMatches = await searchKnowledge(supabase, lovableApiKey, workshop_id, message_text);

      if (knowledgeMatches && knowledgeMatches.length > 0) {
        console.log('RAG found matches:', knowledgeMatches.length);
        ragMatchCount = knowledgeMatches.length;
        const hasExactCodeMatch = knowledgeMatches.some(k => k.codeHit);
        directCodeMatch = knowledgeMatches.find(k => k.codeHit) || null;
        ragContext = `\nDOCUMENTACIÓN DE REFERENCIA (usa esta información para responder):\n${hasExactCodeMatch ? 'IMPORTANTE: Hay coincidencia directa con el código/modelo consultado. Si el código aparece abajo, SÍ está documentado; no respondas que no hay información.\n' : ''}${knowledgeMatches
          .map((k, i) => `[${i + 1}] Archivo: ${k.file_name}${k.codeHit ? ' | COINCIDENCIA DIRECTA DE CÓDIGO' : ''}\n${k.content}`)
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

REGLA SOBRE ARCHIVOS ADJUNTOS:
- NO afirmes que estás enviando un PDF, ficha, catálogo o archivo. El sistema es quien adjunta los archivos automáticamente cuando corresponde.
- Si el cliente pide un PDF o ficha, entrega el resumen técnico con la información documentada y di que si el archivo está disponible se enviará en este mismo chat. Nunca digas "te envié el PDF" ni "ya te lo mandé".

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

    // Guardrails that always win over any business-authored prompt: they fix
    // menu-before-answer behaviour, redundant code requests and invented data.
    const conversationAlreadyStarted = (messages || []).length > 0;

    const replyGuardrails = `
REGLAS OPERATIVAS OBLIGATORIAS (tienen prioridad sobre cualquier instrucción anterior):
1. Si el cliente ya escribió un código, modelo o consulta concreta (aunque sea su PRIMER mensaje), RESPONDE ESA CONSULTA. NO muestres el menú de opciones antes de responder.
2. El menú de opciones solo se usa cuando el mensaje es un saludo genérico o el cliente no indica qué necesita.
3. NUNCA pidas un código que el cliente ya entregó en este mensaje o en el historial reciente.
4. NUNCA digas "escríbeme el código para enviarte la ficha" si el cliente ya especificó el producto.
5. Si el producto/modelo NO aparece en la DOCUMENTACIÓN DE REFERENCIA: dilo explícitamente ("no lo tengo en mi documentación"), NO inventes datos, y deriva con un especialista (should_handoff: true). Nunca digas "tengo la información" si no está documentada.
6. Si el cliente pide varias fichas o modelos en un mismo mensaje, respóndelos todos, no solo el primero.
7. Nunca prometas enviar un archivo: el sistema adjunta los PDF automáticamente cuando existen.
8. Si el cliente hace una pregunta puntual (presión, caudal, potencia, precio, horario, disponibilidad), RESPÓNDELA en texto con el dato documentado. El PDF es un complemento, nunca reemplaza la respuesta.
${conversationAlreadyStarted ? '9. Esta conversación YA ESTÁ INICIADA: NO repitas el saludo de bienvenida ni el menú de opciones. Ve directo a la respuesta.' : '9. Puedes saludar brevemente una sola vez al inicio.'}
10. PRECIOS: cuando la documentación traiga "Rango mínimo (CLP neto)" y "Rango máximo (CLP neto)", entrega SIEMPRE un *rango referencial* (ej: "entre $3.116.000 y $3.666.000 neto"), nunca un precio único cerrado. Si solo existe "Precio (CLP)", preséntalo como "valor referencial aprox. $X neto" e indica que el precio final se confirma con un ejecutivo. Si no hay ningún precio documentado, dilo y deriva; no inventes cifras.`;


    if (settings.system_prompt) {
      systemPrompt = `${settings.system_prompt}

${contextInfo}
${replyGuardrails}

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

${replyGuardrails}

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

${replyGuardrails}

IMPORTANTE: Responde SOLO con JSON válido, sin texto adicional.`;
    }

    console.log('Using system prompt length:', systemPrompt.length, 'custom:', !!settings.system_prompt, 'hasRAG:', !!ragContext);

    // ===== Short-circuit: product/catalog query with empty RAG → force handoff =====
    // Avoids the AI inventing products/prices when there's zero documented info.
    if (isProductQuery && ragEmpty) {
      console.log('Product query detected with empty RAG → forcing handoff');

      // Audit log (best-effort, non-blocking)
      try {
        await supabase.from('health_logs').insert({
          workshop_id,
          event_type: 'info',
          category: 'bot',
          message: `Handoff por falta de conocimiento: ${message_text.substring(0, 200)}`,
          metadata: {
            conversation_id,
            query: message_text.substring(0, 500),
            reason: 'rag_empty_on_product_query',
          },
        });
      } catch (logErr) {
        console.error('Failed to log handoff to health_logs:', logErr);
      }

      const handoffReply = `Esa información específica no la tengo documentada por aquí 🙏\n\nTe voy a conectar con un ejecutivo del equipo para que pueda ayudarte mejor con tu consulta. En breve te responderá. ✅`;

      return new Response(JSON.stringify({
        success: true,
        replies: [handoffReply],
        intent: 'humano',
        confidence: 0.9,
        should_handoff: true,
        should_send_booking_link: false,
        reasoning: 'Consulta sobre producto/categoría/precio sin información en RAG. Handoff forzado para evitar alucinación.',
        booking_url: fullBookingUrl,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Call Lovable AI
    console.log('Calling Lovable AI gateway...');
    const aiStartedAt = Date.now();
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Fast non-reasoning model: same quality for this task, ~5-8s faster than gpt-5-mini
        model: 'google/gemini-3-flash-preview',
        max_tokens: 900,
        response_format: { type: 'json_object' },
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

    console.log('AI response status:', aiResponse.status, 'latency:', Date.now() - aiStartedAt, 'ms');

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
      // Some responses wrap the JSON in prose; keep only the JSON object.
      if (!jsonContent.startsWith('{')) {
        const first = jsonContent.indexOf('{');
        const last = jsonContent.lastIndexOf('}');
        if (first !== -1 && last > first) jsonContent = jsonContent.slice(first, last + 1);
      }
      const parsed = JSON.parse(jsonContent);
      if (parsed.reply && !parsed.replies) {
        parsed.replies = [parsed.reply];
      }
      if (!Array.isArray(parsed.replies) || parsed.replies.length === 0) {
        throw new Error('Missing replies array');
      }
      result = parsed;
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiContent);
      // Prefer the model's own prose over a generic handoff message.
      const prose = compactText(String(aiContent || '').replace(/```[a-z]*|```/g, '')).trim();
      const usableProse = prose && !prose.startsWith('{') && prose.length > 8 ? prose.slice(0, 900) : null;
      result = {
        replies: [usableProse || 'Gracias por tu mensaje. Un asesor te contactará pronto.'],
        intent: 'otro',
        confidence: 0.5,
        should_handoff: !usableProse,
        should_send_booking_link: false,
      };
    }

    const replyText = compactText((result.replies || []).join(' ')).toLowerCase();
    const falseNegativeRag = directCodeMatch && (
      result.should_handoff ||
      /no tengo (esa )?informaci[oó]n|no tengo.*documentad|no aparece en la documentaci[oó]n|no est[aá] documentad/.test(replyText)
    );

    if (falseNegativeRag) {
      console.log('Correcting AI false-negative handoff because an exact RAG code match exists:', {
        file: directCodeMatch.file_name,
        score: directCodeMatch.score,
      });
      result = {
        replies: [buildDocumentedProductReply(directCodeMatch)],
        intent: 'consulta',
        confidence: 0.93,
        should_handoff: false,
        should_send_booking_link: false,
        reasoning: 'La IA intentó derivar, pero el RAG encontró coincidencia directa del código/modelo consultado. Se corrigió la respuesta usando solo información documentada.',
        detected_zone: result.detected_zone,
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

    // ===== PDF datasheet attachment (opt-in per business) =====
    // When the RAG found an exact product-code match and that chunk came from a
    // PDF document, expose a signed URL so the channel can attach the original file.
    let attachment: { document_id: string; file_name: string; url: string } | null = null;
    const attachments: Array<{ document_id: string; file_name: string; url: string }> = [];


    let resolvedDatasheets: DatasheetDocument[] = [];
    let pdfRequested = false;
    let datasheetAmbiguous = false;

    if (botSettings?.send_pdf_datasheets) {
      try {
        const lowerCurrent = removeAccents((message_text || '').toLowerCase());
        const pdfRequestRe = /\b(pdf|ficha|fichas|archivo|adjunto|documento|catalogo|folleto|brochure|especificaciones|hoja tecnica|enviamelo|mandamelo|enviame|mandame)\b/;
        const shortConfirmRe = /^(si+|sí+|dale|ok|okay|listo|claro|por favor|porfa|obvio|ya|correcto|exacto|asi es|👍)[\s!¡.?¿,]*$/i;

        const historyRows = (messages || []) as Array<{ text: string; direction: string }>;
        const lastBotText = removeAccents(
          (historyRows.filter(m => m.direction === 'outbound').slice(-1)[0]?.text || '').toLowerCase()
        );
        const botOfferedFile = /\b(pdf|ficha|archivo|adjunto|documento|catalogo)\b/.test(lastBotText);

        pdfRequested =
          pdfRequestRe.test(lowerCurrent) ||
          (shortConfirmRe.test((message_text || '').trim()) && botOfferedFile);

        // Direct SKU queries should attach immediately. For follow-up requests,
        // recover product context newest-first from the conversation.
        const currentCodes = extractProductCodes(message_text);
        const shouldResolve = currentCodes.length > 0 || pdfRequested;
        if (shouldResolve) {
          const codes = [...currentCodes];
          // Codes recovered from history must not multiply the attachments, so
          // they are resolved separately with a single-document budget while the
          // current message keeps the full multi-attachment budget.
          const historyDerivedCodes: string[] = [];
          if (pdfRequested && currentCodes.length === 0) {
            for (const historyMessage of [...historyRows].reverse()) {
              const historyCodes = extractProductCodes(historyMessage.text);
              // Long enumerations of alternatives are ambiguous context, but a
              // message carrying a couple of codes still identifies the product.
              if (historyCodes.length === 0 || historyCodes.length > 3) continue;
              for (const code of historyCodes) {
                if (!historyDerivedCodes.some(existing => normalizeProductCode(existing) === normalizeProductCode(code))) {
                  historyDerivedCodes.push(code);
                }
              }
              if (historyDerivedCodes.length >= 6) break;
            }
          }

          // A single message can legitimately ask for several models, so every
          // requested code is resolved instead of only the first one.
          const resolution = codes.length > 0
            ? await resolvePdfDatasheets(supabase, workshop_id, codes, 3)
            : await resolvePdfDatasheets(supabase, workshop_id, historyDerivedCodes, 1);

          resolvedDatasheets = resolution.documents;
          datasheetAmbiguous = resolution.ambiguous;

          console.log('Datasheet resolution:', {
            codes,
            historyDerivedCodes,
            resolved: resolvedDatasheets.map(doc => doc.file_name),
            ambiguous: datasheetAmbiguous,
            pdfRequested,
          });

        }
      } catch (ctxErr) {
        console.error('Datasheet context resolution error:', ctxErr);
      }
    }

    if (botSettings?.send_pdf_datasheets && resolvedDatasheets.length > 0) {
      for (const doc of resolvedDatasheets) {
        try {
          const { data: signed, error: signErr } = await supabase
            .storage
            .from('bot-documents')
            .createSignedUrl(doc.storage_path, 60 * 60 * 24);

          if (signErr) {
            console.error('Failed to sign datasheet URL:', signErr);
          } else if (signed?.signedUrl) {
            attachments.push({
              document_id: doc.id,
              file_name: doc.file_name,
              url: signed.signedUrl,
            });
          }
        } catch (attachErr) {
          console.error('Datasheet attachment error:', attachErr);
        }
      }
      attachment = attachments[0] || null;
      console.log('Datasheet attachments ready:', attachments.map(a => a.file_name));
    }


    const datasheetNames = attachments.map(a => `*${a.file_name.replace(/\.pdf$/i, '')}*`);

    // The PDF is a COMPLEMENT, never a replacement: the customer's actual
    // question (pressure, price, availability…) must still be answered in text
    // and the attachment confirmation is appended as an extra message.
    if (attachments.length > 0) {
      const deliveryLine = attachments.length === 1
        ? `Te adjunto además la ficha técnica ${datasheetNames[0]} en PDF. 📄`
        : `Te adjunto además ${attachments.length} fichas técnicas en PDF: ${datasheetNames.join(', ')}. 📄`;

      // Drop only the sentences that contradict the delivery (asking again for
      // a code, or claiming the datasheet does not exist).
      const contradictionRe = /(no tengo (la )?ficha|no puedo envi|ind[ií]came el (c[oó]digo|modelo)|escr[ií]beme el c[oó]digo|necesito el c[oó]digo)/i;

      const keptReplies = (result.replies || [])
        .filter(reply => compactText(reply).length > 0)
        .filter(reply => !contradictionRe.test(removeAccents(reply)));

      result.replies = keptReplies.length > 0
        ? [...keptReplies.slice(0, 2), deliveryLine]
        : [deliveryLine];
      result.should_handoff = false;
      result.intent = 'consulta';
      result.reasoning = `Respuesta en texto + ${attachments.length} PDF(s) adjunto(s): ${attachments.map(a => a.file_name).join(', ')}.`;
    }


    // Do not claim a file was sent when no attachment was prepared. When a
    // family code is ambiguous, ask for the exact model instead of guessing.
    if (pdfRequested && attachments.length === 0) {
      result.replies = [datasheetAmbiguous
        ? 'Encontré varias fichas para esa familia de productos. Indícame el *modelo completo* (por ejemplo, incluyendo caudal y terminación) para enviarte el PDF correcto.'
        : 'No tengo la ficha técnica de ese modelo cargada en mi documentación, así que no puedo enviártela ni inventar sus datos. Te derivo con un especialista para que te confirme la información. 🙌'];
      result.should_handoff = !datasheetAmbiguous;
      result.reasoning = datasheetAmbiguous
        ? 'Hay más de una ficha PDF compatible con el código parcial; se solicita el modelo completo para evitar enviar un documento incorrecto.'
        : 'El cliente solicitó un PDF inexistente en la documentación; se deriva a un humano en vez de prometer información.';
    }

    // The language model must never claim a delivery that the attachment
    // pipeline did not prepare. This also covers a bare SKU: direct SKU queries
    // attempt attachment resolution even when the customer did not type "PDF".
    const claimsFileDelivery = (result.replies || []).some(reply =>
      /\b(te\s+(dejo|adjunto|envio|mando)|adjunto|enviad[oa]|ficha\s+t[eé]cnica\s+(de|en)|procede\s+a\s+enviar)\b/i.test(removeAccents(reply))
    );
    if (attachments.length === 0 && claimsFileDelivery) {
      result.replies = [
        'No tengo la ficha PDF de ese modelo disponible para adjuntarla, y no quiero darte datos sin respaldo. Te derivo con un especialista para confirmarlo. 🙌',
      ];
      result.should_handoff = true;
      result.reasoning = 'Se bloqueó una promesa de envío porque el sistema no preparó ningún adjunto PDF.';
    }


    return new Response(JSON.stringify({
      success: true,
      ...result,
      booking_url: fullBookingUrl,
      attachment,
      attachments,
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
