import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface GoogleEvent {
  id: string
  summary?: string
  description?: string
  start: { dateTime?: string; date?: string }
  end: { dateTime?: string; date?: string }
  status: string
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
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

  if (!response.ok) {
    console.error('Failed to refresh token:', await response.text())
    return null
  }

  const data = await response.json()
  return data.access_token
}

async function fetchGoogleEvents(accessToken: string, calendarId: string): Promise<GoogleEvent[]> {
  const now = new Date()
  const timeMin = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days ago
  const timeMax = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days from now

  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`)
  url.searchParams.set('timeMin', timeMin)
  url.searchParams.set('timeMax', timeMax)
  url.searchParams.set('singleEvents', 'true')
  url.searchParams.set('orderBy', 'startTime')
  url.searchParams.set('maxResults', '250')

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` }
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch events: ${await response.text()}`)
  }

  const data = await response.json()
  return data.items || []
}

async function createGoogleEvent(accessToken: string, calendarId: string, event: any): Promise<string | null> {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        summary: event.title,
        description: event.description,
        start: event.is_all_day 
          ? { date: event.start_time.split('T')[0] }
          : { dateTime: event.start_time },
        end: event.is_all_day 
          ? { date: event.end_time.split('T')[0] }
          : { dateTime: event.end_time }
      })
    }
  )

  if (!response.ok) {
    console.error('Failed to create Google event:', await response.text())
    return null
  }

  const data = await response.json()
  return data.id
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

    // Get user profile with Google tokens
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('google_calendar_connected, google_refresh_token, google_calendar_id, workshop_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!profile.google_calendar_connected || !profile.google_refresh_token) {
      return new Response(JSON.stringify({ error: 'Google Calendar not connected' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!profile.workshop_id) {
      return new Response(JSON.stringify({ error: 'User is not assigned to a workshop. Please contact an administrator.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Refresh access token
    console.log('Refreshing access token for user:', user.id)
    const accessToken = await refreshAccessToken(profile.google_refresh_token)
    
    if (!accessToken) {
      // Token refresh failed, mark as disconnected
      const adminSupabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )
      await adminSupabase
        .from('profiles')
        .update({ google_calendar_connected: false })
        .eq('id', user.id)

      return new Response(JSON.stringify({ error: 'Token refresh failed. Please reconnect.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const calendarId = profile.google_calendar_id || 'primary'

    // Parse request body for sync options
    const body = await req.json().catch(() => ({}))
    const { direction = 'both', eventToSync } = body

    let syncedFromGoogle = 0
    let syncedToGoogle = 0

    // Sync FROM Google
    if (direction === 'both' || direction === 'from_google') {
      console.log('Syncing events FROM Google...')
      const googleEvents = await fetchGoogleEvents(accessToken, calendarId)

      for (const gEvent of googleEvents) {
        if (gEvent.status === 'cancelled') continue

        const startTime = gEvent.start.dateTime || gEvent.start.date
        const endTime = gEvent.end.dateTime || gEvent.end.date
        const isAllDay = !gEvent.start.dateTime

        // Check if event already exists
        const { data: existing } = await supabase
          .from('calendar_events')
          .select('id')
          .eq('google_event_id', gEvent.id)
          .eq('user_id', user.id)
          .single()

        if (existing) {
          // Update existing event
          await supabase
            .from('calendar_events')
            .update({
              title: gEvent.summary || 'Sin título',
              description: gEvent.description,
              start_time: startTime,
              end_time: endTime,
              is_all_day: isAllDay,
              synced_at: new Date().toISOString()
            })
            .eq('id', existing.id)
        } else {
          // Create new event
          await supabase
            .from('calendar_events')
            .insert({
              workshop_id: profile.workshop_id,
              user_id: user.id,
              google_event_id: gEvent.id,
              title: gEvent.summary || 'Sin título',
              description: gEvent.description,
              start_time: startTime,
              end_time: endTime,
              is_all_day: isAllDay,
              event_type: 'external',
              synced_at: new Date().toISOString()
            })
          syncedFromGoogle++
        }
      }
    }

    // Sync TO Google (single event)
    if (eventToSync && (direction === 'both' || direction === 'to_google')) {
      console.log('Syncing event TO Google:', eventToSync.id)
      
      const googleEventId = await createGoogleEvent(accessToken, calendarId, eventToSync)
      
      if (googleEventId) {
        await supabase
          .from('calendar_events')
          .update({
            google_event_id: googleEventId,
            synced_at: new Date().toISOString()
          })
          .eq('id', eventToSync.id)
        syncedToGoogle++
      }
    }

    console.log(`Sync complete: ${syncedFromGoogle} from Google, ${syncedToGoogle} to Google`)

    return new Response(JSON.stringify({
      success: true,
      syncedFromGoogle,
      syncedToGoogle
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error in google-calendar-sync:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
