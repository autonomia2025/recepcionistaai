import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  console.log("=== Verify Instagram Request ===");
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { workshop_id, page_id, access_token } = await req.json();

    if (!workshop_id || !page_id || !access_token) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Verifying Instagram for workshop ${workshop_id}, page ${page_id}`);

    // Verify the access token by calling the Instagram Graph API
    const verifyUrl = `https://graph.instagram.com/v18.0/${page_id}?fields=id,username&access_token=${access_token}`;
    
    const verifyResponse = await fetch(verifyUrl);
    const verifyData = await verifyResponse.json();

    console.log("Instagram verification response:", verifyData);

    if (!verifyResponse.ok || verifyData.error) {
      console.error("Instagram verification failed:", verifyData);
      return new Response(
        JSON.stringify({ 
          error: 'Instagram verification failed', 
          details: verifyData.error?.message || 'Invalid credentials' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update workshop with Instagram credentials
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { error: updateError } = await supabase
      .from('workshops')
      .update({
        instagram_connected: true,
        instagram_page_id: page_id,
        instagram_access_token: access_token,
        instagram_connected_at: new Date().toISOString(),
      })
      .eq('id', workshop_id);

    if (updateError) {
      console.error("Error updating workshop:", updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to update workshop' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log("Instagram connected successfully for workshop:", workshop_id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        username: verifyData.username,
        page_id: verifyData.id 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error("Verify Instagram error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});