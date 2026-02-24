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

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const twilioAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN');

    if (!twilioAccountSid || !twilioAuthToken) {
      return new Response(
        JSON.stringify({ error: 'Twilio credentials not configured' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { workshop_id, phone_number } = await req.json();

    if (!workshop_id || !phone_number) {
      return new Response(
        JSON.stringify({ error: 'workshop_id and phone_number are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize phone number (ensure E.164 format)
    let normalizedPhone = phone_number.trim();
    if (!normalizedPhone.startsWith('+')) {
      normalizedPhone = '+' + normalizedPhone;
    }

    console.log('[verify-twilio] Verifying number:', normalizedPhone);

    // Fetch incoming phone numbers from Twilio to verify the number exists
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(normalizedPhone)}`;
    
    const authHeader = btoa(`${twilioAccountSid}:${twilioAuthToken}`);
    
    const twilioResponse = await fetch(twilioUrl, {
      headers: {
        'Authorization': `Basic ${authHeader}`,
      },
    });

    if (!twilioResponse.ok) {
      const errorText = await twilioResponse.text();
      console.error('[verify-twilio] Twilio API error:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to verify number with Twilio', details: errorText }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const twilioData = await twilioResponse.json();
    console.log('[verify-twilio] Twilio response:', JSON.stringify(twilioData));

    // Check if number was found
    if (!twilioData.incoming_phone_numbers || twilioData.incoming_phone_numbers.length === 0) {
      // Number not found in regular numbers, check for WhatsApp senders
      // This might be a WhatsApp-enabled number from the WhatsApp Business API
      console.log('[verify-twilio] Number not found in regular numbers, assuming WhatsApp sender');
    }

    let phoneSid = null;
    if (twilioData.incoming_phone_numbers && twilioData.incoming_phone_numbers.length > 0) {
      phoneSid = twilioData.incoming_phone_numbers[0].sid;
    }

    // Update workshop with Twilio number
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { error: updateError } = await supabase
      .from('workshops')
      .update({
        whatsapp_provider: 'twilio',
        twilio_phone_number: normalizedPhone,
        twilio_phone_sid: phoneSid,
        whatsapp_connected: true,
        whatsapp_connected_at: new Date().toISOString(),
      })
      .eq('id', workshop_id);

    if (updateError) {
      console.error('[verify-twilio] Error updating workshop:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to update workshop', details: updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[verify-twilio] Workshop updated successfully');

    return new Response(
      JSON.stringify({ 
        success: true, 
        phone_number: normalizedPhone,
        phone_sid: phoneSid,
        message: 'Twilio number verified and connected successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('[verify-twilio] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});