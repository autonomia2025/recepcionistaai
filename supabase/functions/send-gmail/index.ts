import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface EmailRequest {
  workshop_id: string
  to: string
  subject: string
  html: string
  text?: string
  from_name?: string
}

// Refresh access token if expired
async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number } | null> {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId!,
      client_secret: clientSecret!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  })

  const data = await response.json()
  if (data.error) {
    console.error('Token refresh failed:', data)
    return null
  }

  return { access_token: data.access_token, expires_in: data.expires_in }
}

// Create MIME email
function createMimeEmail(to: string, from: string, fromName: string, subject: string, html: string, text?: string): string {
  const boundary = `boundary_${Date.now()}`
  
  const mimeEmail = [
    `From: ${fromName} <${from}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    btoa(unescape(encodeURIComponent(text || subject))),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    btoa(unescape(encodeURIComponent(html))),
    '',
    `--${boundary}--`
  ].join('\r\n')

  // Convert to base64url
  return btoa(mimeEmail).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const adminSupabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  try {
    const { workshop_id, to, subject, html, text, from_name }: EmailRequest = await req.json()

    if (!workshop_id || !to || !subject || !html) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ========================================
    // AUTH VALIDATION: Verify caller has access to this workshop
    // ========================================
    const authHeader = req.headers.get('Authorization')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    let callerWorkshopId: string | null = null
    let isSuperadmin = false
    const isServiceRole = authHeader?.includes(supabaseServiceKey)

    if (!isServiceRole && authHeader?.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '')
      const supabaseAnon = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!
      )
      const { data: authData } = await supabaseAnon.auth.getUser(token)

      if (authData?.user) {
        const { data: callerProfile } = await adminSupabase
          .from('profiles')
          .select('workshop_id, role')
          .eq('id', authData.user.id)
          .single()
        callerWorkshopId = callerProfile?.workshop_id
        isSuperadmin = callerProfile?.role === 'SUPERADMIN'
      }
    }

    if (!isServiceRole && !isSuperadmin && callerWorkshopId !== workshop_id) {
      return new Response(JSON.stringify({ error: 'Access denied' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Get workshop's Gmail token
    const { data: tokenData, error: tokenError } = await adminSupabase
      .from('workshop_gmail_tokens')
      .select('*')
      .eq('workshop_id', workshop_id)
      .single()

    if (tokenError || !tokenData) {
      // Log error
      await adminSupabase.from('health_logs').insert({
        workshop_id,
        event_type: 'error',
        category: 'gmail',
        message: 'Gmail not connected for workshop',
        metadata: { to, subject }
      })

      return new Response(JSON.stringify({ error: 'Gmail not connected for this workshop' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    let accessToken = tokenData.access_token
    const tokenExpiry = new Date(tokenData.token_expires_at)

    // Refresh if expired or expiring soon
    if (!accessToken || tokenExpiry < new Date(Date.now() + 60000)) {
      console.log('Refreshing Gmail access token...')
      const newTokens = await refreshAccessToken(tokenData.refresh_token)
      
      if (!newTokens) {
        // Log token refresh failure
        await adminSupabase.from('health_logs').insert({
          workshop_id,
          event_type: 'token_refresh_failed',
          category: 'gmail',
          message: 'Failed to refresh Gmail access token',
          metadata: { gmail_email: tokenData.gmail_email }
        })

        // Mark as disconnected
        await adminSupabase
          .from('workshops')
          .update({ gmail_connected: false })
          .eq('id', workshop_id)

        return new Response(JSON.stringify({ error: 'Gmail token expired and refresh failed' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      accessToken = newTokens.access_token

      // Update stored token
      await adminSupabase
        .from('workshop_gmail_tokens')
        .update({
          access_token: accessToken,
          token_expires_at: new Date(Date.now() + newTokens.expires_in * 1000).toISOString()
        })
        .eq('workshop_id', workshop_id)
    }

    // Get workshop info for from_name
    const { data: workshop } = await adminSupabase
      .from('workshops')
      .select('name, email_sender_name')
      .eq('id', workshop_id)
      .single()

    const senderName = from_name || workshop?.email_sender_name || workshop?.name || 'AutonomIA Suite'

    // Create and send email
    const rawMessage = createMimeEmail(
      to,
      tokenData.gmail_email,
      senderName,
      subject,
      html,
      text
    )

    const sendResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ raw: rawMessage })
    })

    const sendResult = await sendResponse.json()

    if (sendResult.error) {
      console.error('Gmail send error:', sendResult.error)
      
      // Log failure
      await adminSupabase.from('health_logs').insert({
        workshop_id,
        event_type: 'email_failed',
        category: 'gmail',
        message: `Failed to send email: ${sendResult.error.message}`,
        metadata: { to, subject, error: sendResult.error }
      })

      return new Response(JSON.stringify({ error: sendResult.error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Update last_used_at
    await adminSupabase
      .from('workshop_gmail_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('workshop_id', workshop_id)

    // Log success
    await adminSupabase.from('health_logs').insert({
      workshop_id,
      event_type: 'email_sent',
      category: 'gmail',
      message: `Email sent to ${to}: ${subject}`,
      metadata: { message_id: sendResult.id, to, subject }
    })

    console.log('Email sent successfully:', sendResult.id)

    return new Response(JSON.stringify({ 
      success: true, 
      message_id: sendResult.id 
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error in send-gmail:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
