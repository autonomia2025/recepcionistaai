import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { crypto } from "https://deno.land/std@0.177.0/crypto/mod.ts"
import { encode as hexEncode } from "https://deno.land/std@0.177.0/encoding/hex.ts"

// Verify HMAC signature
async function verifyState(stateData: object, signature: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const stateJson = JSON.stringify(stateData)
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const expectedSignature = await crypto.subtle.sign("HMAC", key, encoder.encode(stateJson))
  const expectedHex = new TextDecoder().decode(hexEncode(new Uint8Array(expectedSignature)))
  return expectedHex === signature
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const stateParam = url.searchParams.get('state')
    const error = url.searchParams.get('error')

    // Default redirect URL
    let appUrl = Deno.env.get('SUPABASE_URL')?.replace('.supabase.co', '.lovable.app') || ''

    if (error) {
      console.error('OAuth error:', error)
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/dashboard?gmail_error=${encodeURIComponent(error)}` }
      })
    }

    if (!code || !stateParam) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/dashboard?gmail_error=missing_params` }
      })
    }

    // Parse and verify state
    let stateData: any
    let workshopId: string
    let userId: string

    try {
      const stateSecret = Deno.env.get('OAUTH_STATE_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      if (!stateSecret) throw new Error('No state secret')

      const parsedState = JSON.parse(atob(stateParam))
      stateData = parsedState.data
      const signature = parsedState.sig

      // Verify signature
      const isValid = await verifyState(stateData, signature, stateSecret)
      if (!isValid) throw new Error('Invalid state signature')

      // Check expiry (15 minutes)
      if (Date.now() - stateData.timestamp > 15 * 60 * 1000) {
        throw new Error('State expired')
      }

      workshopId = stateData.workshopId
      userId = stateData.userId
      if (stateData.appUrl) appUrl = stateData.appUrl

    } catch (stateError) {
      console.error('State verification failed:', stateError)
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/dashboard?gmail_error=invalid_state` }
      })
    }

    // Exchange code for tokens
    const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const redirectUri = `${supabaseUrl}/functions/v1/gmail-callback`

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId!,
        client_secret: clientSecret!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    })

    const tokenData = await tokenResponse.json()

    if (tokenData.error) {
      console.error('Token exchange error:', tokenData)
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/dashboard?gmail_error=token_exchange_failed` }
      })
    }

    // Get user email from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    })
    const userInfo = await userInfoResponse.json()
    const gmailEmail = userInfo.email

    // Store tokens securely using service role
    const adminSupabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Upsert token record
    const { error: upsertError } = await adminSupabase
      .from('workshop_gmail_tokens')
      .upsert({
        workshop_id: workshopId,
        gmail_email: gmailEmail,
        refresh_token: tokenData.refresh_token,
        access_token: tokenData.access_token,
        token_expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
        connected_at: new Date().toISOString()
      }, { onConflict: 'workshop_id' })

    if (upsertError) {
      console.error('Failed to store Gmail token:', upsertError)
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/dashboard?gmail_error=storage_failed` }
      })
    }

    // Update workshop gmail_connected status
    await adminSupabase
      .from('workshops')
      .update({ 
        gmail_connected: true,
        gmail_email: gmailEmail
      })
      .eq('id', workshopId)

    // Log to health_logs
    await adminSupabase
      .from('health_logs')
      .insert({
        workshop_id: workshopId,
        event_type: 'gmail_connected',
        category: 'gmail',
        message: `Gmail connected: ${gmailEmail}`,
        metadata: { connected_by: userId }
      })

    console.log('Gmail connected successfully for workshop:', workshopId)

    return new Response(null, {
      status: 302,
      headers: { Location: `${appUrl}/dashboard?gmail_connected=true` }
    })

  } catch (error) {
    console.error('Error in gmail-callback:', error)
    const appUrl = Deno.env.get('SUPABASE_URL')?.replace('.supabase.co', '.lovable.app') || ''
    return new Response(null, {
      status: 302,
      headers: { Location: `${appUrl}/dashboard?gmail_error=unknown` }
    })
  }
})
