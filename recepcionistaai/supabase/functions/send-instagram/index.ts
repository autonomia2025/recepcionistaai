import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  console.log("=== Send Instagram Request ===");
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { conversation_id, text } = await req.json();

    if (!conversation_id || !text) {
      return new Response(
        JSON.stringify({ error: 'Missing conversation_id or text' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get conversation with contact and workshop
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select(`
        *,
        contacts (*),
        workshops (*)
      `)
      .eq('id', conversation_id)
      .single();

    if (convError || !conversation) {
      console.error("Conversation not found:", convError);
      return new Response(
        JSON.stringify({ error: 'Conversation not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const workshop = conversation.workshops;
    const contact = conversation.contacts;

    if (!workshop.instagram_connected || !workshop.instagram_page_id || !workshop.instagram_access_token) {
      console.error("Instagram not configured for workshop");
      return new Response(
        JSON.stringify({ error: 'Instagram not configured for this workshop' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!contact.instagram_id) {
      console.error("Contact has no Instagram ID");
      return new Response(
        JSON.stringify({ error: 'Contact has no Instagram ID' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Sending Instagram message to ${contact.instagram_id}`);

    // Send message via Instagram Graph API
    const instagramApiUrl = `https://graph.instagram.com/v18.0/${workshop.instagram_page_id}/messages`;
    
    const response = await fetch(instagramApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${workshop.instagram_access_token}`,
      },
      body: JSON.stringify({
        recipient: {
          id: contact.instagram_id,
        },
        message: {
          text: text,
        },
      }),
    });

    const responseText = await response.text();
    console.log("Instagram API response:", response.status, responseText);

    if (!response.ok) {
      console.error("Instagram API error:", responseText);
      return new Response(
        JSON.stringify({ error: 'Failed to send Instagram message', details: responseText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Save outbound message
    const { error: msgError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversation_id,
        text: text,
        direction: 'outbound',
        channel: 'instagram',
      });

    if (msgError) {
      console.error("Error saving message:", msgError);
    }

    // Update conversation timestamp
    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversation_id);

    console.log("Instagram message sent and saved successfully");

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error("Send Instagram error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});