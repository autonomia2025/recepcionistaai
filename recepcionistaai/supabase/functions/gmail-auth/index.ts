import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { crypto } from "https://deno.land/std@0.177.0/crypto/mod.ts"
import { encode as hexEncode } from "https://deno.land/std@0.177.0/encoding/hex.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Generate HMAC signature for state data
async function signState(stateData: object, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const stateJson = JSON.stringify(stateData)
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(stateJson))
  return new TextDecoder().decode(hexEncode(new Uint8Array(signature)))
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

    // Get user's workshop and verify they're an admin
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('workshop_id, role')
      .eq('id', user.id)
      .single()

    if (profileError || !profile?.workshop_id) {
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

    // Reuse Google Calendar OAuth credentials
    const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
    if (!clientId) {
      console.error('GOOGLE_CLIENT_ID not configured')
      return new Response(JSON.stringify({ error: 'Google OAuth not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const stateSecret = Deno.env.get('OAUTH_STATE_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!stateSecret) {
      return new Response(JSON.stringify({ error: 'OAuth configuration error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const redirectUri = `${supabaseUrl}/functions/v1/gmail-callback`

    const origin = req.headers.get('origin') || req.headers.get('referer')?.replace(/\/[^/]*$/, '') || ''

    // Create signed state with workshop_id (for multi-tenant)
    const stateData = {
      workshopId: profile.workshop_id,
      userId: user.id,
      timestamp: Date.now(),
      appUrl: origin,
      nonce: crypto.randomUUID()
    }

    const signature = await signState(stateData, stateSecret)
    const state = btoa(JSON.stringify({
      data: stateData,
      sig: signature
    }))

    // Minimal scopes for sending emails
    const scopes = [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email'
    ].join(' ')

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', scopes)
    authUrl.searchParams.set('access_type', 'offline')
    authUrl.searchParams.set('prompt', 'consent')
    authUrl.searchParams.set('state', state)

    console.log('Generated Gmail OAuth URL for workshop:', profile.workshop_id)

    return new Response(JSON.stringify({ url: authUrl.toString() }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error in gmail-auth:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
