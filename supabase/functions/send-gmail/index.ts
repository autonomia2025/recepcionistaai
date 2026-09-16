import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  assertSafeHeaderValue,
  buildMimeMessage,
  EmailValidationError,
  type MailAttachment,
  parseAddressList,
  toBase64Url,
} from '../_shared/mime.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

interface AttachmentInput {
  filename?: unknown
  content_type?: unknown
  content_base64?: unknown
}

interface EmailRequest {
  workshop_id: string
  to: string | string[]
  subject: string
  html: string
  text?: string
  from_name?: string
  attachments?: AttachmentInput[]
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
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

function decodeAttachments(input: unknown): MailAttachment[] {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) {
    throw new EmailValidationError('attachments debe ser una lista')
  }

  let totalBytes = 0
  return input.map((item: AttachmentInput, index: number) => {
    const position = index + 1
    if (
      typeof item?.filename !== 'string' ||
      typeof item?.content_type !== 'string' ||
      typeof item?.content_base64 !== 'string'
    ) {
      throw new EmailValidationError(`Adjunto ${position}: faltan filename, content_type o content_base64`)
    }

    let binary: string
    try {
      binary = atob(item.content_base64)
    } catch {
      throw new EmailValidationError(`Adjunto ${position}: content_base64 no es base64 válido`)
    }

    const content = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    totalBytes += content.length
    if (totalBytes > MAX_ATTACHMENT_BYTES) {
      throw new EmailValidationError('Los adjuntos superan 25 MB')
    }
    return { filename: item.filename, contentType: item.content_type, content }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const adminSupabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const { workshop_id, to, subject, html, text, from_name, attachments: rawAttachments }: EmailRequest = await req.json()

    if (!workshop_id || !to || !subject || !html) {
      return jsonResponse({ error: 'Missing required fields' }, 400)
    }

    // Only internal functions (service role) and workshop admins may send from the workshop mailbox.
    const authHeader = req.headers.get('Authorization') ?? ''
    const isServiceRole = authHeader === `Bearer ${supabaseServiceKey}`

    if (!isServiceRole) {
      if (!authHeader.startsWith('Bearer ')) {
        return jsonResponse({ error: 'Unauthorized' }, 401)
      }

      const supabaseAnon = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!)
      const { data: authData } = await supabaseAnon.auth.getUser(authHeader.slice('Bearer '.length))
      if (!authData?.user) {
        return jsonResponse({ error: 'Unauthorized' }, 401)
      }

      const { data: callerProfile } = await adminSupabase
        .from('profiles')
        .select('workshop_id, role')
        .eq('id', authData.user.id)
        .single()

      const allowed =
        callerProfile?.role === 'SUPERADMIN' ||
        (callerProfile?.role === 'ADMIN' && callerProfile.workshop_id === workshop_id)

      if (!allowed) {
        return jsonResponse({ error: 'Access denied' }, 403)
      }
    }

    const recipients = parseAddressList(to, 'to')
    assertSafeHeaderValue(subject, 'subject')
    if (from_name) assertSafeHeaderValue(from_name, 'from_name')
    const attachments = decodeAttachments(rawAttachments)

    // Get workshop's Gmail token
    const { data: tokenData, error: tokenError } = await adminSupabase
      .from('workshop_gmail_tokens')
      .select('*')
      .eq('workshop_id', workshop_id)
      .single()

    if (tokenError || !tokenData) {
      await adminSupabase.from('health_logs').insert({
        workshop_id,
        event_type: 'error',
        category: 'gmail',
        message: 'Gmail not connected for workshop',
        metadata: { to: recipients.join(', '), subject }
      })

      return jsonResponse({ error: 'Gmail not connected for this workshop' }, 400)
    }

    let accessToken = tokenData.access_token
    const tokenExpiry = new Date(tokenData.token_expires_at)

    // Refresh if expired or expiring soon
    if (!accessToken || tokenExpiry < new Date(Date.now() + 60000)) {
      console.log('Refreshing Gmail access token...')
      const newTokens = await refreshAccessToken(tokenData.refresh_token)

      if (!newTokens) {
        await adminSupabase.from('health_logs').insert({
          workshop_id,
          event_type: 'token_refresh_failed',
          category: 'gmail',
          message: 'Failed to refresh Gmail access token',
          metadata: { gmail_email: tokenData.gmail_email }
        })

        await adminSupabase
          .from('workshops')
          .update({ gmail_connected: false })
          .eq('id', workshop_id)

        return jsonResponse({ error: 'Gmail token expired and refresh failed' }, 401)
      }

      accessToken = newTokens.access_token

      await adminSupabase
        .from('workshop_gmail_tokens')
        .update({
          access_token: accessToken,
          token_expires_at: new Date(Date.now() + newTokens.expires_in * 1000).toISOString()
        })
        .eq('workshop_id', workshop_id)
    }

    const { data: workshop } = await adminSupabase
      .from('workshops')
      .select('name, email_sender_name')
      .eq('id', workshop_id)
      .single()

    const senderName = from_name || workshop?.email_sender_name || workshop?.name || 'AutonomIA Suite'

    const rawMessage = buildMimeMessage({
      from: { email: tokenData.gmail_email, name: senderName },
      to: recipients,
      subject,
      html,
      text,
      attachments,
    })

    // The JSON endpoint caps the request size, so messages with attachments go through the media upload endpoint.
    const sendResponse = attachments.length > 0
      ? await fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'message/rfc822'
          },
          body: rawMessage
        })
      : await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ raw: toBase64Url(rawMessage) })
        })

    const sendResult = await sendResponse.json()

    if (sendResult.error) {
      console.error('Gmail send error:', sendResult.error)

      await adminSupabase.from('health_logs').insert({
        workshop_id,
        event_type: 'email_failed',
        category: 'gmail',
        message: `Failed to send email: ${sendResult.error.message}`,
        metadata: { to: recipients.join(', '), subject, error: sendResult.error }
      })

      return jsonResponse({ error: sendResult.error.message }, 500)
    }

    await adminSupabase
      .from('workshop_gmail_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('workshop_id', workshop_id)

    await adminSupabase.from('health_logs').insert({
      workshop_id,
      event_type: 'email_sent',
      category: 'gmail',
      message: `Email sent to ${recipients.join(', ')}: ${subject}`,
      metadata: {
        message_id: sendResult.id,
        to: recipients.join(', '),
        subject,
        attachments: attachments.map((attachment) => attachment.filename),
      }
    })

    console.log('Email sent successfully:', sendResult.id)

    return jsonResponse({ success: true, message_id: sendResult.id }, 200)

  } catch (error) {
    if (error instanceof EmailValidationError) {
      return jsonResponse({ error: error.message }, 400)
    }
    console.error('Error in send-gmail:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return jsonResponse({ error: message }, 500)
  }
})
