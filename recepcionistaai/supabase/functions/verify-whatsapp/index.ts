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
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const rawBody = await req.text();
    console.log('[verify-whatsapp] Raw body:', rawBody);

    const parsed = rawBody ? JSON.parse(rawBody) : {};
    const workshop_id = parsed?.workshop_id;
    const phone_number_id_from_client = parsed?.phone_number_id;
    const waba_id_from_client = parsed?.whatsapp_business_account_id;

    if (!workshop_id) {
      return new Response(JSON.stringify({ error: 'Missing workshop_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[verify-whatsapp] Input recibido:', {
      workshop_id,
      phone_number_id_from_client,
      phone_number_id_from_client_type: typeof phone_number_id_from_client,
      phone_number_id_from_client_length: String(phone_number_id_from_client || '').length,
      waba_id_from_client,
      waba_id_from_client_type: typeof waba_id_from_client,
    });

    console.log('[verify-whatsapp] Starting verification for workshop:', workshop_id);

    // Get workshop WhatsApp credentials
    const { data: workshop, error: workshopError } = await supabase
      .from('workshops')
      .select('whatsapp_phone_number_id, whatsapp_business_account_id, whatsapp_access_token')
      .eq('id', workshop_id)
      .single();

    if (workshopError || !workshop) {
      console.error('[verify-whatsapp] Workshop not found:', workshopError);
      return new Response(JSON.stringify({ error: 'Workshop not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Log los valores EXACTOS recibidos de la DB (como strings)
    const phoneNumberIdFromDb = String(workshop.whatsapp_phone_number_id || '');
    const accessToken = String(workshop.whatsapp_access_token || '');

    // Preferir el valor enviado por el cliente (si viene como string) para evitar cualquier desajuste visual vs DB.
    // IMPORTANTE: si el cliente enviara un number, ya habría pérdida de precisión; por eso el frontend lo envía como string.
    const phoneNumberIdFromClient = typeof phone_number_id_from_client === 'string'
      ? phone_number_id_from_client
      : '';

    const phoneNumberId = (phoneNumberIdFromClient || phoneNumberIdFromDb).trim();

    console.log('[verify-whatsapp] Comparación IDs (client vs DB):', {
      phone_from_client: phoneNumberIdFromClient,
      phone_from_client_length: phoneNumberIdFromClient.length,
      phone_from_client_type: typeof phone_number_id_from_client,
      phone_from_db: phoneNumberIdFromDb,
      phone_from_db_length: phoneNumberIdFromDb.length,
      using: phoneNumberIdFromClient ? 'client' : 'db',
      phone_used: phoneNumberId,
      phone_used_length: phoneNumberId.length,
      matches: phoneNumberIdFromClient ? phoneNumberIdFromClient === phoneNumberIdFromDb : null,
      has_access_token: !!accessToken,
    });

    // Validación: solo dígitos (sin convertir a number)
    if (phoneNumberId && !/^\d+$/.test(phoneNumberId)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'phone_number_id must contain only digits',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!phoneNumberId || !accessToken) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing WhatsApp credentials'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify with Meta API - usar la variable string directamente
    const verifyUrl = `https://graph.facebook.com/v18.0/${phoneNumberId}`;
    console.log('[verify-whatsapp] Llamando a Meta API:', verifyUrl);
    
    const metaResponse = await fetch(verifyUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    const metaResult = await metaResponse.json();
    console.log('[verify-whatsapp] Meta API response status:', metaResponse.status);
    console.log('[verify-whatsapp] Meta API response:', JSON.stringify(metaResult));

    if (!metaResponse.ok) {
      console.error('[verify-whatsapp] Meta API verification failed:', metaResult);
      return new Response(JSON.stringify({ 
        success: false, 
        error: metaResult.error?.message || 'Verification failed',
        debug: {
          phone_number_id_used: phoneNumberId,
          phone_number_id_length: phoneNumberId.length,
        }
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update workshop as connected
    const { error: updateError } = await supabase
      .from('workshops')
      .update({
        whatsapp_connected: true,
        whatsapp_connected_at: new Date().toISOString(),
      })
      .eq('id', workshop_id);

    if (updateError) {
      console.error('Error updating workshop:', updateError);
      throw updateError;
    }

    return new Response(JSON.stringify({ 
      success: true,
      phone_number: metaResult.display_phone_number,
      verified_name: metaResult.verified_name,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Verify WhatsApp error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
