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

    // Get user profile with refresh token
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('google_refresh_token')
      .eq('id', user.id)
      .single()

    if (profileError) {
      console.error('Profile fetch error:', profileError)
    }

    // Try to revoke the token at Google
    if (profile?.google_refresh_token) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${profile.google_refresh_token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        })
        console.log('Token revoked at Google')
      } catch (revokeError) {
        console.error('Failed to revoke token at Google:', revokeError)
        // Continue anyway - we still want to clean up locally
      }
    }

    // Use service role to update profile (clear Google data)
    const adminSupabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { error: updateError } = await adminSupabase
      .from('profiles')
      .update({
        google_calendar_connected: false,
        google_calendar_email: null,
        google_calendar_id: null,
        google_refresh_token: null,
        google_connected_at: null
      })
      .eq('id', user.id)

    if (updateError) {
      console.error('Failed to update profile:', updateError)
      return new Response(JSON.stringify({ error: 'Failed to disconnect' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Delete synced events (external events from Google)
    const { error: deleteError } = await adminSupabase
      .from('calendar_events')
      .delete()
      .eq('user_id', user.id)
      .eq('event_type', 'external')

    if (deleteError) {
      console.error('Failed to delete synced events:', deleteError)
      // Don't fail the whole operation for this
    }

    console.log('Successfully disconnected Google Calendar for user:', user.id)

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error in google-calendar-disconnect:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
