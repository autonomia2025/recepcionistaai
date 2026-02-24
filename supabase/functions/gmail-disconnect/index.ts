import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Get user's workshop and verify admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('workshop_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.workshop_id) {
      return new Response(JSON.stringify({ error: 'Workshop not found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (profile.role !== 'ADMIN' && profile.role !== 'SUPERADMIN') {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const adminSupabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Get token to revoke at Google
    const { data: tokenData } = await adminSupabase
      .from('workshop_gmail_tokens')
      .select('refresh_token, gmail_email')
      .eq('workshop_id', profile.workshop_id)
      .single()

    // Revoke at Google
    if (tokenData?.refresh_token) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${tokenData.refresh_token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        })
        console.log('Token revoked at Google')
      } catch (revokeError) {
        console.error('Failed to revoke at Google:', revokeError)
      }
    }

    // Delete token record
    await adminSupabase
      .from('workshop_gmail_tokens')
      .delete()
      .eq('workshop_id', profile.workshop_id)

    // Update workshop status
    await adminSupabase
      .from('workshops')
      .update({ 
        gmail_connected: false,
        gmail_email: null,
        gmail_refresh_token: null
      })
      .eq('id', profile.workshop_id)

    // Log to health_logs
    await adminSupabase
      .from('health_logs')
      .insert({
        workshop_id: profile.workshop_id,
        event_type: 'gmail_disconnected',
        category: 'gmail',
        message: `Gmail disconnected: ${tokenData?.gmail_email || 'unknown'}`,
        metadata: { disconnected_by: user.id }
      })

    console.log('Gmail disconnected for workshop:', profile.workshop_id)

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error in gmail-disconnect:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
