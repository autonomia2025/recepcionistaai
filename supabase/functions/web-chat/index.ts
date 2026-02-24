import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface WebChatRequest {
  workshop_id: string;
  message: string;
  session_id: string;
}

// Rate limiting map (in-memory, resets on function cold start)
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(sessionId: string, limit: number = 20, windowMs: number = 60000): boolean {
  const now = Date.now();
  const record = rateLimits.get(sessionId);

  if (!record || now > record.resetAt) {
    rateLimits.set(sessionId, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (record.count >= limit) {
    return false;
  }

  record.count++;
  return true;
}

function validateOrigin(origin: string | null, allowedDomains: string[]): boolean {
  if (!origin) return false;
  if (allowedDomains.length === 0) return false;
  if (allowedDomains.includes('*')) return true;

  try {
    const originUrl = new URL(origin);
    const originHost = originUrl.hostname.toLowerCase();

    return allowedDomains.some(domain => {
      // Clean the domain - remove protocol if present
      let cleanDomain = domain.toLowerCase().trim();

      // Remove protocol prefix if present
      if (cleanDomain.startsWith('https://')) {
        cleanDomain = cleanDomain.slice(8);
      } else if (cleanDomain.startsWith('http://')) {
        cleanDomain = cleanDomain.slice(7);
      }

      // Remove trailing slash if present
      if (cleanDomain.endsWith('/')) {
        cleanDomain = cleanDomain.slice(0, -1);
      }

      // Wildcard subdomain match: *.example.com
      if (cleanDomain.startsWith('*.')) {
        const baseDomain = cleanDomain.slice(2);
        return originHost === baseDomain || originHost.endsWith('.' + baseDomain);
      }

      // Exact match
      return originHost === cleanDomain;
    });
  } catch {
    return false;
  }
}

function sanitizeMessage(message: string): string {
  if (!message || typeof message !== 'string') return '';
  // Trim and limit length
  return message.trim().slice(0, 500);
}

// Remove WhatsApp-style formatting (*bold*, _italic_) for web chat
function cleanWhatsAppFormatting(text: string): string {
  if (!text || typeof text !== 'string') return '';
  return text
    // Remove *bold* markers (keep the text inside)
    .replace(/\*([^*]+)\*/g, '$1')
    // Remove _italic_ markers (keep the text inside)
    .replace(/_([^_]+)_/g, '$1')
    // Remove ~strikethrough~ markers (keep the text inside)
    .replace(/~([^~]+)~/g, '$1');
}

// Helper function to log events (fire-and-forget, non-blocking)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function logWebChatEvent(
  supabase: SupabaseClient<any, any, any>,
  data: {
    workshop_id: string;
    session_id: string;
    event_type: string;
    origin?: string | null;
    message_preview?: string | null;
    bot_reply_preview?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  try {
    await supabase.from('web_chat_logs').insert({
      workshop_id: data.workshop_id,
      session_id: data.session_id,
      event_type: data.event_type,
      origin: data.origin || null,
      message_preview: data.message_preview || null,
      bot_reply_preview: data.bot_reply_preview || null,
      metadata: data.metadata || {},
    });
  } catch (e) {
    // Non-blocking - just log to console
    console.error('Failed to log web chat event:', e);
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const origin = req.headers.get('origin') || req.headers.get('referer');
  const userAgent = req.headers.get('user-agent') || 'unknown';

  try {
    const body: WebChatRequest = await req.json();
    const { workshop_id, message, session_id } = body;

    // Validate required fields
    if (!workshop_id || !message || !session_id) {
      await logWebChatEvent(supabase, {
        workshop_id: workshop_id || 'unknown',
        session_id: session_id || 'unknown',
        event_type: 'error',
        origin,
        metadata: { error: 'missing_fields', user_agent: userAgent }
      });
      return new Response(
        JSON.stringify({ error: 'Missing required fields: workshop_id, message, session_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check rate limit
    if (!checkRateLimit(session_id)) {
      await logWebChatEvent(supabase, {
        workshop_id,
        session_id,
        event_type: 'rate_limited',
        origin,
        metadata: { user_agent: userAgent }
      });
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Please wait before sending more messages.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get workshop and validate
    const { data: workshop, error: workshopError } = await supabase
      .from('workshops')
      .select('id, name, web_chat_enabled, web_chat_allowed_domains, bot_enabled')
      .eq('id', workshop_id)
      .eq('is_active', true)
      .single();

    if (workshopError || !workshop) {
      await logWebChatEvent(supabase, {
        workshop_id,
        session_id,
        event_type: 'error',
        origin,
        metadata: { error: 'workshop_not_found', user_agent: userAgent }
      });
      return new Response(
        JSON.stringify({ error: 'Workshop not found or inactive' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!workshop.web_chat_enabled) {
      await logWebChatEvent(supabase, {
        workshop_id,
        session_id,
        event_type: 'error',
        origin,
        metadata: { error: 'web_chat_disabled', workshop_name: workshop.name, user_agent: userAgent }
      });
      return new Response(
        JSON.stringify({ error: 'Web chat is not enabled for this workshop' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate origin
    if (!validateOrigin(origin, workshop.web_chat_allowed_domains || [])) {
      console.log(`Origin rejected: ${origin} not in allowed domains:`, workshop.web_chat_allowed_domains);
      await logWebChatEvent(supabase, {
        workshop_id,
        session_id,
        event_type: 'origin_rejected',
        origin,
        metadata: {
          allowed_domains: workshop.web_chat_allowed_domains,
          workshop_name: workshop.name,
          user_agent: userAgent
        }
      });
      return new Response(
        JSON.stringify({ error: 'Origin not allowed' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const sanitizedMessage = sanitizeMessage(message);
    if (!sanitizedMessage) {
      return new Response(
        JSON.stringify({ error: 'Message cannot be empty' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log message received
    await logWebChatEvent(supabase, {
      workshop_id,
      session_id,
      event_type: 'message_received',
      origin,
      message_preview: sanitizedMessage.slice(0, 100),
      metadata: {
        workshop_name: workshop.name,
        bot_enabled: workshop.bot_enabled,
        user_agent: userAgent
      }
    });

    // Find or create contact - first try to find by web_session_id
    let contact;
    const { data: existingContactBySession } = await supabase
      .from('contacts')
      .select('*')
      .eq('workshop_id', workshop_id)
      .eq('web_session_id', session_id)
      .single();

    if (existingContactBySession) {
      contact = existingContactBySession;
    } else {
      // Check if there's a contact with matching phone or email that we can link
      // This prevents duplicates when a web visitor later shares their phone/email
      // For now, create a new web contact (the analyze-conversation will populate data)
      const { data: newContact, error: contactError } = await supabase
        .from('contacts')
        .insert({
          workshop_id,
          web_session_id: session_id,
          name: 'Visitante Web',
        })
        .select()
        .single();

      if (contactError) {
        console.error('Error creating contact:', contactError);
        await logWebChatEvent(supabase, {
          workshop_id,
          session_id,
          event_type: 'error',
          origin,
          metadata: { error: 'contact_creation_failed', details: contactError.message }
        });
        return new Response(
          JSON.stringify({ error: 'Failed to create contact' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      contact = newContact;
    }

    // Find or create conversation
    let conversation;
    const { data: existingConversation } = await supabase
      .from('conversations')
      .select('*')
      .eq('contact_id', contact.id)
      .eq('workshop_id', workshop_id)
      .single();

    if (existingConversation) {
      conversation = existingConversation;
      // Update last message timestamp
      await supabase
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', conversation.id);
    } else {
      const { data: newConversation, error: convError } = await supabase
        .from('conversations')
        .insert({
          workshop_id,
          contact_id: contact.id,
          status: 'new',
          last_message_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (convError) {
        console.error('Error creating conversation:', convError);
        await logWebChatEvent(supabase, {
          workshop_id,
          session_id,
          event_type: 'error',
          origin,
          metadata: { error: 'conversation_creation_failed', details: convError.message }
        });
        return new Response(
          JSON.stringify({ error: 'Failed to create conversation' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      conversation = newConversation;
    }

    // Save inbound message
    const { error: msgError } = await supabase
      .from('messages')
      .insert({
        workshop_id,
        conversation_id: conversation.id,
        text: sanitizedMessage,
        direction: 'inbound',
        channel: 'web',
      });

    if (msgError) {
      console.error('Error saving message:', msgError);
    }

    // Check if bot is enabled
    if (!workshop.bot_enabled) {
      await logWebChatEvent(supabase, {
        workshop_id,
        session_id,
        event_type: 'bot_disabled',
        origin,
        message_preview: sanitizedMessage.slice(0, 100),
        bot_reply_preview: 'Un agente te responderá pronto.',
        metadata: { workshop_name: workshop.name }
      });
      return new Response(
        JSON.stringify({
          success: true,
          replies: ['Un agente te responderá pronto.'],
          session_id
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Call build-ai-reply
    const aiStartTime = Date.now();
    const aiResponse = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/build-ai-reply`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workshop_id,
          conversation_id: conversation.id,
          contact_id: contact.id,
          message_text: sanitizedMessage,
        }),
      }
    );
    const aiDurationMs = Date.now() - aiStartTime;

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI reply failed:', errorText);
      await logWebChatEvent(supabase, {
        workshop_id,
        session_id,
        event_type: 'error',
        origin,
        message_preview: sanitizedMessage.slice(0, 100),
        metadata: {
          error: 'ai_reply_failed',
          status: aiResponse.status,
          ai_duration_ms: aiDurationMs,
          workshop_name: workshop.name
        }
      });
      return new Response(
        JSON.stringify({
          success: true,
          replies: ['Lo siento, hubo un problema. Un agente te ayudará pronto.'],
          session_id
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiResult = await aiResponse.json();
    // Clean WhatsApp formatting for web chat display
    const rawReplies = aiResult.replies || [aiResult.reply] || [''];
    const replies = rawReplies.map((r: string) => cleanWhatsAppFormatting(r));

    // Log successful bot reply
    await logWebChatEvent(supabase, {
      workshop_id,
      session_id,
      event_type: 'bot_replied',
      origin,
      message_preview: sanitizedMessage.slice(0, 100),
      bot_reply_preview: replies[0]?.slice(0, 200) || null,
      metadata: {
        reply_count: replies.length,
        ai_duration_ms: aiDurationMs,
        workshop_name: workshop.name,
        bot_enabled: true
      }
    });

    // Save outbound messages
    for (const reply of replies) {
      if (reply) {
        await supabase
          .from('messages')
          .insert({
            workshop_id,
            conversation_id: conversation.id,
            text: reply,
            direction: 'outbound',
            channel: 'web',
            metadata: {
              intent: aiResult.intent,
              confidence: aiResult.confidence,
              reasoning: aiResult.reasoning
            }
          });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        replies: replies.filter(Boolean),
        session_id
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Web chat error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await logWebChatEvent(supabase, {
      workshop_id: 'unknown',
      session_id: 'unknown',
      event_type: 'error',
      origin,
      metadata: { error: 'internal_error', message: errorMessage, user_agent: userAgent }
    });
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
