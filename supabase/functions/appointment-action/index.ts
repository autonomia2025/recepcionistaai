import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// This edge function handles appointment actions from email links
// Actions: confirm, cancel (reschedule redirects to public page)

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    const appointmentId = url.searchParams.get('id');
    const token = url.searchParams.get('token');
    const source = url.searchParams.get('source') || 'email_link';

    console.log('Appointment action request:', { action, appointmentId, source });

    if (!action || !appointmentId || !token) {
      return generateHtmlResponse('error', 'Enlace inválido', 'Faltan parámetros necesarios.');
    }

    // Validate appointment and token
    const { data: appointment, error: fetchError } = await supabase
      .from('appointments')
      .select(`
        id, 
        workshop_id, 
        contact_id, 
        service_type, 
        start_datetime, 
        status, 
        cancel_token,
        confirmed_at
      `)
      .eq('id', appointmentId)
      .single();

    if (fetchError || !appointment) {
      console.error('Appointment not found:', fetchError);
      return generateHtmlResponse('error', 'Cita no encontrada', 'Esta cita no existe o ha sido eliminada.');
    }

    // Validate token
    if (appointment.cancel_token !== token) {
      console.error('Token mismatch');
      return generateHtmlResponse('error', 'Enlace expirado', 'Este enlace ya no es válido.');
    }

    // Get workshop info for branding
    const { data: workshop } = await supabase
      .from('workshops')
      .select('name, email_primary_color, email_logo_url')
      .eq('id', appointment.workshop_id)
      .single();

    const workshopName = workshop?.name || 'Nuestro negocio';
    const primaryColor = workshop?.email_primary_color || '#6366f1';

    // Get contact info
    const { data: contact } = await supabase
      .from('contacts')
      .select('name')
      .eq('id', appointment.contact_id)
      .single();

    const contactName = contact?.name || 'Cliente';

    // Format appointment date
    const appointmentDate = new Date(appointment.start_datetime);
    const formattedDate = appointmentDate.toLocaleDateString('es-CL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Santiago'
    });

    // Handle actions
    if (action === 'confirm') {
      // Check if already confirmed
      if (appointment.confirmed_at) {
        return generateHtmlResponse(
          'info',
          'Cita ya confirmada',
          `Tu cita para el ${formattedDate} ya estaba confirmada. ¡Te esperamos!`,
          workshopName,
          primaryColor
        );
      }

      // Check if appointment is still scheduled
      if (appointment.status !== 'scheduled') {
        return generateHtmlResponse(
          'warning',
          'Cita no disponible',
          `Esta cita ya no está vigente (estado: ${appointment.status}).`,
          workshopName,
          primaryColor
        );
      }

      // Confirm the appointment
      const { error: updateError } = await supabase
        .from('appointments')
        .update({
          confirmed_at: new Date().toISOString(),
          confirmed_via: 'email_link'
        })
        .eq('id', appointmentId);

      if (updateError) {
        console.error('Error confirming appointment:', updateError);
        return generateHtmlResponse('error', 'Error', 'No se pudo confirmar la cita. Inténtalo de nuevo.');
      }

      // Log the action
      await supabase.from('appointment_actions').insert({
        appointment_id: appointmentId,
        workshop_id: appointment.workshop_id,
        action_type: 'confirmed',
        action_source: source,
        action_token: token
      });

      // Log to health_logs
      await supabase.from('health_logs').insert({
        workshop_id: appointment.workshop_id,
        event_type: 'appointment_confirmed',
        category: 'appointments',
        message: `Cita confirmada vía email por ${contactName}`,
        metadata: { appointment_id: appointmentId, source }
      });

      return generateHtmlResponse(
        'success',
        '¡Cita confirmada!',
        `Gracias ${contactName}, tu cita para el ${formattedDate} ha sido confirmada. ¡Te esperamos!`,
        workshopName,
        primaryColor
      );

    } else if (action === 'cancel') {
      // Check if already cancelled
      if (appointment.status === 'canceled') {
        return generateHtmlResponse(
          'info',
          'Cita ya cancelada',
          'Esta cita ya había sido cancelada anteriormente.',
          workshopName,
          primaryColor
        );
      }

      // Cancel the appointment
      const { error: updateError } = await supabase
        .from('appointments')
        .update({ status: 'canceled' })
        .eq('id', appointmentId);

      if (updateError) {
        console.error('Error canceling appointment:', updateError);
        return generateHtmlResponse('error', 'Error', 'No se pudo cancelar la cita. Inténtalo de nuevo.');
      }

      // Also update the calendar event if exists
      const { data: calendarEvent } = await supabase
        .from('calendar_events')
        .select('google_event_id, user_id')
        .eq('appointment_id', appointmentId)
        .single();

      if (calendarEvent?.google_event_id && calendarEvent?.user_id) {
        // Fetch user profile to get Google tokens
        const { data: profile } = await supabase
          .from('profiles')
          .select('google_refresh_token, google_calendar_id')
          .eq('id', calendarEvent.user_id)
          .single();

        if (profile?.google_refresh_token) {
          const accessToken = await refreshAccessToken(profile.google_refresh_token);
          if (accessToken) {
            const calendarId = profile.google_calendar_id || 'primary';
            await deleteGoogleEvent(accessToken, calendarId, calendarEvent.google_event_id);
          }
        }
      }

      await supabase
        .from('calendar_events')
        .delete()
        .eq('appointment_id', appointmentId);

      // Log the action
      await supabase.from('appointment_actions').insert({
        appointment_id: appointmentId,
        workshop_id: appointment.workshop_id,
        action_type: 'cancelled',
        action_source: source,
        action_token: token
      });

      // Log to health_logs
      await supabase.from('health_logs').insert({
        workshop_id: appointment.workshop_id,
        event_type: 'appointment_cancelled',
        category: 'appointments',
        message: `Cita cancelada vía email por ${contactName}`,
        metadata: { appointment_id: appointmentId, source }
      });

      // Create notification for workshop staff
      await supabase.from('notifications').insert({
        workshop_id: appointment.workshop_id,
        type: 'appointment_cancelled',
        title: '❌ Cita cancelada',
        message: `${contactName} canceló su cita del ${formattedDate} (${appointment.service_type})`,
        appointment_id: appointmentId
      });

      return generateHtmlResponse(
        'cancelled',
        'Cita cancelada',
        `Tu cita para el ${formattedDate} ha sido cancelada. Si deseas reagendar, por favor contáctanos.`,
        workshopName,
        primaryColor
      );

    } else {
      return generateHtmlResponse('error', 'Acción no válida', `La acción "${action}" no es reconocida.`);
    }

  } catch (error) {
    console.error('Appointment action error:', error);
    return generateHtmlResponse('error', 'Error del sistema', 'Ocurrió un error inesperado. Por favor intenta más tarde.');
  }
});

// ============= Google Calendar Helper Functions =============

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    console.error("Google OAuth credentials not configured");
    return null;
  }

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Failed to refresh Google token:", error);
      return null;
    }

    const data = await response.json();
    return data.access_token;
  } catch (error) {
    console.error("Error refreshing Google token:", error);
    return null;
  }
}

async function deleteGoogleEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    // 204 No Content or 410 Gone (already deleted) are both acceptable
    if (!response.ok && response.status !== 410) {
      const error = await response.text();
      console.error("Failed to delete Google event:", error);
      return false;
    }

    console.log("Deleted Google Calendar event:", eventId);
    return true;
  } catch (error) {
    console.error("Error deleting Google event:", error);
    return false;
  }
}

function generateHtmlResponse(
  type: 'success' | 'error' | 'warning' | 'info' | 'cancelled',
  title: string,
  message: string,
  workshopName?: string,
  primaryColor?: string
): Response {
  const color = primaryColor || '#6366f1';

  const iconMap = {
    success: { emoji: '✅', bg: '#dcfce7', border: '#22c55e' },
    error: { emoji: '❌', bg: '#fee2e2', border: '#ef4444' },
    warning: { emoji: '⚠️', bg: '#fef3c7', border: '#f59e0b' },
    info: { emoji: 'ℹ️', bg: '#dbeafe', border: '#3b82f6' },
    cancelled: { emoji: '📅', bg: '#fef2f2', border: '#dc2626' }
  };

  const icon = iconMap[type] || iconMap.info;

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #f5f5f5 0%, #e5e5e5 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.1);
      max-width: 480px;
      width: 100%;
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, ${color} 0%, ${color}dd 100%);
      padding: 32px;
      text-align: center;
    }
    .header h1 {
      color: white;
      font-size: 20px;
      font-weight: 600;
    }
    .content {
      padding: 40px 32px;
      text-align: center;
    }
    .icon {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: ${icon.bg};
      border: 3px solid ${icon.border};
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
      font-size: 40px;
    }
    .title {
      font-size: 24px;
      font-weight: 700;
      color: #18181b;
      margin-bottom: 12px;
    }
    .message {
      font-size: 16px;
      color: #52525b;
      line-height: 1.6;
    }
    .footer {
      background: #fafafa;
      padding: 20px 32px;
      text-align: center;
      border-top: 1px solid #e5e5e5;
    }
    .footer p {
      color: #71717a;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    ${workshopName ? `<div class="header"><h1>${workshopName}</h1></div>` : ''}
    <div class="content">
      <div class="icon">${icon.emoji}</div>
      <h2 class="title">${title}</h2>
      <p class="message">${message}</p>
    </div>
    <div class="footer">
      <p>Puedes cerrar esta ventana</p>
    </div>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
