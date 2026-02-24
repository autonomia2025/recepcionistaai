import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { crypto } from "https://deno.land/std@0.177.0/crypto/mod.ts"
import { encode as hexEncode } from "https://deno.land/std@0.177.0/encoding/hex.ts"

// Verify HMAC signature for state data using Web Crypto API
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
  const expectedSig = await crypto.subtle.sign("HMAC", key, encoder.encode(stateJson))
  const expectedHex = new TextDecoder().decode(hexEncode(new Uint8Array(expectedSig)))
  return signature === expectedHex
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const error = url.searchParams.get('error')

    // Default fallback URL
    const fallbackUrl = 'https://lovable.dev'
    let appUrl = fallbackUrl

    // Try to decode state first to get appUrl
    let stateData: { userId?: string; timestamp?: number; appUrl?: string; nonce?: string } = {}
    let stateSig: string | null = null
    
    if (state) {
      try {
        const decoded = JSON.parse(atob(state))
        
        // Handle new signed format
        if (decoded.data && decoded.sig) {
          stateData = decoded.data
          stateSig = decoded.sig
        } else {
          // Handle legacy format (backwards compatibility)
          stateData = decoded
        }
        
        // Use appUrl from state if valid
        if (stateData.appUrl && stateData.appUrl.startsWith('https://')) {
          appUrl = stateData.appUrl
        }
      } catch {
        console.error('Failed to decode state for appUrl extraction')
      }
    }

    console.log('Callback received - appUrl:', appUrl, 'code present:', !!code, 'state present:', !!state, 'signed:', !!stateSig)

    if (error) {
      console.error('OAuth error from Google:', error)
      return Response.redirect(`${appUrl}/calendar?error=${encodeURIComponent(error)}`, 302)
    }

    if (!code || !state) {
      console.error('Missing code or state in callback')
      return Response.redirect(`${appUrl}/calendar?error=missing_params`, 302)
    }

    // Validate state data
    const { userId, timestamp } = stateData

    if (!userId || !timestamp) {
      console.error('Invalid state data - missing userId or timestamp')
      return Response.redirect(`${appUrl}/calendar?error=invalid_state`, 302)
    }

    // Check if state is not too old (15 minutes)
    if (Date.now() - timestamp > 15 * 60 * 1000) {
      console.error('State expired')
      return Response.redirect(`${appUrl}/calendar?error=state_expired`, 302)
    }

    // Get OAuth state secret for HMAC verification - use service role key as fallback
    const stateSecret = Deno.env.get('OAUTH_STATE_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    // Verify HMAC signature if present (required for security)
    if (stateSig && stateSecret) {
      const isValid = await verifyState(stateData, stateSig, stateSecret)
      if (!isValid) {
        console.error('State signature verification failed - potential CSRF attack')
        return Response.redirect(`${appUrl}/calendar?error=invalid_state`, 302)
      }
      console.log('State signature verified successfully')
    } else if (!stateSig) {
      // For backwards compatibility, allow unsigned states with additional logging
      // This should be removed once all clients use the new signed format
      console.warn('Unsigned state received - legacy format, will be deprecated')
    }

    // Exchange code for tokens
    const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const redirectUri = `${supabaseUrl}/functions/v1/google-calendar-callback`

    console.log('Exchanging code for tokens...')

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

    if (!tokenResponse.ok) {
      console.error('Token exchange failed:', tokenData)
      return Response.redirect(`${appUrl}/calendar?error=token_exchange_failed`, 302)
    }

    const { access_token, refresh_token } = tokenData

    // Get user info (email)
    console.log('Fetching user info...')
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` }
    })

    const userInfo = await userInfoResponse.json()

    // Get primary calendar ID
    console.log('Fetching primary calendar...')
    const calendarResponse = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary', {
      headers: { Authorization: `Bearer ${access_token}` }
    })

    const calendarData = await calendarResponse.json()

    // Update user profile with Google Calendar data using service role
    const supabase = createClient(
      supabaseUrl!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        google_calendar_connected: true,
        google_calendar_email: userInfo.email,
        google_calendar_id: calendarData.id || 'primary',
        google_refresh_token: refresh_token,
        google_connected_at: new Date().toISOString()
      })
      .eq('id', userId)

    if (updateError) {
      console.error('Failed to update profile:', updateError)
      return Response.redirect(`${appUrl}/calendar?error=profile_update_failed`, 302)
    }

    console.log('Successfully connected Google Calendar for user:', userId)
    return Response.redirect(`${appUrl}/calendar?success=true`, 302)

  } catch (error) {
    console.error('Error in google-calendar-callback:', error)
    const appUrl = Deno.env.get('APP_URL') || 'https://lovable.dev'
    return Response.redirect(`${appUrl}/calendar?error=internal_error`, 302)
  }
})
