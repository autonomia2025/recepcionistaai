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
  const globalWhatsAppToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const twilioAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN');
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { conversation_id, text } = await req.json();

    if (!conversation_id || !text) {
      return new Response(JSON.stringify({ error: 'Missing conversation_id or text' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Sending WhatsApp message:', { conversation_id, text: text.substring(0, 50) });

    // ========================================
    // AUTH VALIDATION: Verify caller has access to conversation
    // ========================================
    const authHeader = req.headers.get('Authorization');
    let callerWorkshopId: string | null = null;
    let isSuperadmin = false;
    let isServiceRole = authHeader?.includes(supabaseServiceKey);

    if (!isServiceRole && authHeader?.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      const supabaseAnon = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!);
      const { data: authData } = await supabaseAnon.auth.getUser(token);
      
      if (authData?.user) {
        const { data: callerProfile } = await supabase
          .from('profiles')
          .select('workshop_id, role')
          .eq('id', authData.user.id)
          .single();
        
        callerWorkshopId = callerProfile?.workshop_id;
        isSuperadmin = callerProfile?.role === 'SUPERADMIN';
      }
    }

    // Get conversation with workshop and contact
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, workshop_id, contact_id')
      .eq('id', conversation_id)
      .single();

    if (convError || !conversation) {
      console.error('Conversation not found:', convError);
      return new Response(JSON.stringify({ error: 'Conversation not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // SECURITY: Verify caller has access to this conversation's workshop
    if (!isServiceRole && !isSuperadmin && callerWorkshopId !== conversation.workshop_id) {
      console.error('Access denied: user workshop mismatch', {
        callerWorkshopId,
        conversationWorkshopId: conversation.workshop_id
      });
      return new Response(JSON.stringify({ error: 'Access denied to this conversation' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get workshop data including provider info
    const { data: workshop, error: workshopError } = await supabase
      .from('workshops')
      .select('id, whatsapp_phone_number_id, whatsapp_access_token, whatsapp_connected, whatsapp_provider, twilio_phone_number')
      .eq('id', conversation.workshop_id)
      .single();

    if (workshopError || !workshop) {
      return new Response(JSON.stringify({ error: 'Workshop not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get contact data
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('id, whatsapp_id, phone')
      .eq('id', conversation.contact_id)
      .single();

    if (contactError || !contact) {
      return new Response(JSON.stringify({ error: 'Contact not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!workshop.whatsapp_connected) {
      return new Response(JSON.stringify({ error: 'WhatsApp not connected for this workshop' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const recipientPhone = contact.whatsapp_id || contact.phone;
    if (!recipientPhone) {
      return new Response(JSON.stringify({ error: 'No phone number for contact' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ========================================
    // WHATSAPP 24H WINDOW CHECK (Meta Policy)
    // ========================================
    // Only allow outbound messages if there was an inbound message from the contact in the last 24 hours
    // This applies to the Meta Cloud API provider
    if (workshop.whatsapp_provider !== 'twilio') {
      const { data: lastInbound } = await supabase
        .from('messages')
        .select('created_at')
        .eq('conversation_id', conversation_id)
        .eq('direction', 'inbound')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (lastInbound) {
        const hoursSinceInbound = (Date.now() - new Date(lastInbound.created_at).getTime()) / (1000 * 60 * 60);
        
        if (hoursSinceInbound > 24) {
          console.log('WhatsApp 24h window closed - blocking outbound message');
          
          // Log to health_logs
          await supabase.from('health_logs').insert({
            workshop_id: conversation.workshop_id,
            event_type: 'warning',
            category: 'whatsapp',
            message: 'Outbound blocked – 24h window closed',
            metadata: { 
              conversation_id, 
              hours_since_inbound: hoursSinceInbound.toFixed(2),
              contact_id: contact.id
            }
          });

          return new Response(JSON.stringify({ 
            error: 'WhatsApp 24h window closed',
            blocked: true,
            hours_since_inbound: hoursSinceInbound
          }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } else {
        // No inbound messages at all - block outbound
        console.log('No inbound messages found - blocking outbound');
        
        await supabase.from('health_logs').insert({
          workshop_id: conversation.workshop_id,
          event_type: 'warning',
          category: 'whatsapp',
          message: 'Outbound blocked – No inbound messages found',
          metadata: { conversation_id, contact_id: contact.id }
        });

        return new Response(JSON.stringify({ 
          error: 'No inbound messages found - cannot send outbound',
          blocked: true
        }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    let messageId: string | null = null;

    // Check which provider to use
    if (workshop.whatsapp_provider === 'twilio') {
      // Send via Twilio
      console.log('Sending via Twilio...');
      
      if (!twilioAccountSid || !twilioAuthToken) {
        return new Response(JSON.stringify({ error: 'Twilio credentials not configured' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!workshop.twilio_phone_number) {
        return new Response(JSON.stringify({ error: 'Twilio phone number not configured for this workshop' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
      const authHeader = btoa(`${twilioAccountSid}:${twilioAuthToken}`);

      // Format numbers for Twilio WhatsApp
      const fromNumber = `whatsapp:${workshop.twilio_phone_number}`;
      const toNumber = `whatsapp:${recipientPhone.startsWith('+') ? recipientPhone : '+' + recipientPhone}`;

      const twilioBody = new URLSearchParams({
        From: fromNumber,
        To: toNumber,
        Body: text,
      });

      const twilioResponse = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: twilioBody.toString(),
      });

      const twilioResult = await twilioResponse.json();
      console.log('Twilio API response:', twilioResult);

      if (!twilioResponse.ok) {
        console.error('Twilio API error:', twilioResult);
        return new Response(JSON.stringify({ 
          error: 'Failed to send WhatsApp message via Twilio',
          details: twilioResult 
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      messageId = twilioResult.sid;
    } else {
      // Send via Meta Cloud API (default)
      console.log('Sending via Meta Cloud API...');

      const accessToken = globalWhatsAppToken || workshop.whatsapp_access_token;
      
      if (!accessToken) {
        return new Response(JSON.stringify({ error: 'No WhatsApp access token available' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const metaApiUrl = `https://graph.facebook.com/v18.0/${workshop.whatsapp_phone_number_id}/messages`;
      
      const metaResponse = await fetch(metaApiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: recipientPhone,
          type: 'text',
          text: { body: text },
        }),
      });

      const metaResult = await metaResponse.json();
      console.log('Meta API response:', metaResult);

      if (!metaResponse.ok) {
        console.error('Meta API error:', metaResult);
        return new Response(JSON.stringify({ 
          error: 'Failed to send WhatsApp message',
          details: metaResult 
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      messageId = metaResult.messages?.[0]?.id;
    }

    // Insert outbound message
    const { error: messageError } = await supabase
      .from('messages')
      .insert({
        workshop_id: conversation.workshop_id,
        conversation_id: conversation_id,
        text: text,
        direction: 'outbound',
        channel: 'whatsapp',
      });

    if (messageError) {
      console.error('Error inserting message:', messageError);
    }

    // Update conversation
    await supabase
      .from('conversations')
      .update({ 
        last_message_at: new Date().toISOString(),
        status: 'in_progress'
      })
      .eq('id', conversation_id);

    return new Response(JSON.stringify({ 
      success: true, 
      message_id: messageId,
      provider: workshop.whatsapp_provider || 'meta'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Send WhatsApp error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});