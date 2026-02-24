import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
      const cleanDomain = domain.toLowerCase().trim();
      
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

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body: WebChatRequest = await req.json();
    const { workshop_id, message, session_id } = body;

    // Validate required fields
    if (!workshop_id || !message || !session_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: workshop_id, message, session_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check rate limit
    if (!checkRateLimit(session_id)) {
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
      return new Response(
        JSON.stringify({ error: 'Workshop not found or inactive' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!workshop.web_chat_enabled) {
      return new Response(
        JSON.stringify({ error: 'Web chat is not enabled for this workshop' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate origin
    const origin = req.headers.get('origin') || req.headers.get('referer');
    if (!validateOrigin(origin, workshop.web_chat_allowed_domains || [])) {
      console.log(`Origin rejected: ${origin} not in allowed domains:`, workshop.web_chat_allowed_domains);
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

    // Find or create contact by web_session_id
    let contact;
    const { data: existingContact } = await supabase
      .from('contacts')
      .select('*')
      .eq('workshop_id', workshop_id)
      .eq('web_session_id', session_id)
      .single();

    if (existingContact) {
      contact = existingContact;
    } else {
      // Create anonymous web contact
      const { data: newContact, error: contactError } = await supabase
        .from('contacts')
        .insert({
          workshop_id,
          web_session_id: session_id,
          name: 'Visitante Web',
          channel: 'web',
          phone: null,
        })
        .select()
        .single();

      if (contactError) {
        console.error('Error creating contact:', contactError);
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
          channel: 'web',
          status: 'active',
          last_message_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (convError) {
        console.error('Error creating conversation:', convError);
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
        contact_id: contact.id,
        content: sanitizedMessage,
        direction: 'inbound',
        channel: 'web',
      });

    if (msgError) {
      console.error('Error saving message:', msgError);
    }

    // Check if bot is enabled
    if (!workshop.bot_enabled) {
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
          user_message: sanitizedMessage,
        }),
      }
    );

    if (!aiResponse.ok) {
      console.error('AI reply failed:', await aiResponse.text());
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
    const replies = aiResult.replies || [aiResult.reply] || [''];

    // Save outbound messages
    for (const reply of replies) {
      if (reply) {
        await supabase
          .from('messages')
          .insert({
            workshop_id,
            conversation_id: conversation.id,
            contact_id: contact.id,
            content: reply,
            direction: 'outbound',
            channel: 'web',
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
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
