// Lovable Cloud backend function: create/manage public bookings
// This runs with service-role privileges to avoid client-side RLS issues on public pages.
// Includes automatic Google Calendar sync for assigned professionals.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CreatePayload = {
  action?: 'create';
  workshop_id: string;
  professional_id: string;
  service_name: string;
  start_datetime: string;
  end_datetime: string;
  contact_name: string;
  contact_phone: string;
};

type ReschedulePayload = {
  action: 'reschedule';
  appointment_id: string;
  cancel_token: string;  // Required for authorization
  new_start_datetime: string;
  new_end_datetime: string;
};

type CancelPayload = {
  action: 'cancel';
  appointment_id: string;
  cancel_token: string;  // Required for authorization
};

type GetAppointmentPayload = {
  action: 'get_appointment';
  appointment_id: string;
  cancel_token: string;  // Required for authorization
};

type Payload = CreatePayload | ReschedulePayload | CancelPayload | GetAppointmentPayload;

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizePhone(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

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

async function createGoogleEvent(
  accessToken: string,
  calendarId: string,
  event: { title: string; description?: string; start_time: string; end_time: string }
): Promise<string | null> {
  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: event.title,
          description: event.description || "",
          start: {
            dateTime: event.start_time,
            timeZone: "America/Santiago",
          },
          end: {
            dateTime: event.end_time,
            timeZone: "America/Santiago",
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("Failed to create Google event:", error);
      return null;
    }

    const data = await response.json();
    console.log("Created Google Calendar event:", data.id);
    return data.id;
  } catch (error) {
    console.error("Error creating Google event:", error);
    return null;
  }
}

async function updateGoogleEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  event: { title?: string; description?: string; start_time: string; end_time: string }
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(event.title && { summary: event.title }),
          ...(event.description && { description: event.description }),
          start: {
            dateTime: event.start_time,
            timeZone: "America/Santiago",
          },
          end: {
            dateTime: event.end_time,
            timeZone: "America/Santiago",
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("Failed to update Google event:", error);
      return false;
    }

    console.log("Updated Google Calendar event:", eventId);
    return true;
  } catch (error) {
    console.error("Error updating Google event:", error);
    return false;
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

// ============= Main Handler =============

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceKey) {
      return jsonResponse(500, { error: "Server misconfigured: missing backend credentials" });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const payload = (await req.json()) as Payload;
    const action = payload.action || 'create';

    console.log(`Processing action: ${action}`, payload);

    // Handle get_appointment (for cancel page)
    if (action === 'get_appointment') {
      const { appointment_id, cancel_token } = payload as GetAppointmentPayload;
      
      if (!appointment_id || !cancel_token) {
        return jsonResponse(400, { error: "Missing appointment_id or cancel_token" });
      }

      // Get appointment with related data
      const { data: appointment, error: aptError } = await admin
        .from("appointments")
        .select(`
          id, 
          service_type, 
          start_datetime, 
          end_datetime, 
          status, 
          notes, 
          cancel_token,
          workshop_id,
          contact_id,
          assigned_to_user_id
        `)
        .eq("id", appointment_id)
        .single();

      if (aptError || !appointment) {
        return jsonResponse(404, { error: "Appointment not found" });
      }

      // Validate cancel token
      if (appointment.cancel_token !== cancel_token) {
        console.log("Invalid cancel token for get_appointment:", appointment_id);
        return jsonResponse(403, { error: "Invalid authorization token" });
      }

      // Get workshop info
      const { data: workshop } = await admin
        .from("workshops")
        .select("name, slug")
        .eq("id", appointment.workshop_id)
        .single();

      // Get contact info
      const { data: contact } = await admin
        .from("contacts")
        .select("name")
        .eq("id", appointment.contact_id)
        .single();

      // Get assigned user info
      let assignedUser = null;
      if (appointment.assigned_to_user_id) {
        const { data: user } = await admin
          .from("profiles")
          .select("full_name")
          .eq("id", appointment.assigned_to_user_id)
          .single();
        assignedUser = user;
      }

      return jsonResponse(200, {
        ok: true,
        appointment: {
          id: appointment.id,
          service_type: appointment.service_type,
          start_datetime: appointment.start_datetime,
          end_datetime: appointment.end_datetime,
          status: appointment.status,
          notes: appointment.notes,
          workshop: workshop,
          contact: contact,
          assigned_user: assignedUser
        }
      });
    }

    // Handle reschedule
    if (action === 'reschedule') {
      const { appointment_id, cancel_token, new_start_datetime, new_end_datetime } = payload as ReschedulePayload;
      
      if (!appointment_id || !new_start_datetime || !new_end_datetime) {
        return jsonResponse(400, { error: "Missing required fields for reschedule" });
      }

      if (!cancel_token) {
        return jsonResponse(400, { error: "Cancel token is required for authorization" });
      }

      // Get existing appointment with calendar event and assigned user profile
      const { data: appointment, error: aptError } = await admin
        .from("appointments")
        .select("*, cancel_token, calendar_events(id, google_event_id), profiles:assigned_to_user_id(google_calendar_connected, google_refresh_token, google_calendar_id)")
        .eq("id", appointment_id)
        .single();

      if (aptError || !appointment) {
        return jsonResponse(404, { error: "Appointment not found" });
      }

      // Validate cancel token
      if (appointment.cancel_token !== cancel_token) {
        console.log("Invalid cancel token for reschedule attempt:", appointment_id);
        return jsonResponse(403, { error: "Invalid authorization token" });
      }

      // Update appointment
      const { error: updateError } = await admin
        .from("appointments")
        .update({
          start_datetime: new_start_datetime,
          end_datetime: new_end_datetime,
          notes: `${appointment.notes || ''}\n[Reprogramado el ${new Date().toLocaleString('es-CL')}]`
        })
        .eq("id", appointment_id);

      if (updateError) {
        return jsonResponse(500, { error: "Failed to reschedule appointment", details: updateError });
      }

      let googleSynced = false;
      const calendarEvent = appointment.calendar_events?.[0];
      const profile = appointment.profiles;

      // Update calendar event if exists
      if (calendarEvent) {
        await admin
          .from("calendar_events")
          .update({
            start_time: new_start_datetime,
            end_time: new_end_datetime
          })
          .eq("appointment_id", appointment_id);

        // Sync to Google Calendar if connected and has google_event_id
        if (calendarEvent.google_event_id && profile?.google_calendar_connected && profile.google_refresh_token) {
          const accessToken = await refreshAccessToken(profile.google_refresh_token);
          if (accessToken) {
            const calendarId = profile.google_calendar_id || "primary";
            googleSynced = await updateGoogleEvent(accessToken, calendarId, calendarEvent.google_event_id, {
              start_time: new_start_datetime,
              end_time: new_end_datetime
            });
          }
        }
      }

      // Create notification for staff
      await admin.from("notifications").insert({
        workshop_id: appointment.workshop_id,
        user_id: appointment.assigned_to_user_id,
        appointment_id: appointment_id,
        type: "appointment_rescheduled",
        title: "Cita reprogramada",
        message: `Una cita ha sido reprogramada para el ${new Date(new_start_datetime).toLocaleString('es-CL')}`
      });

      console.log("Reschedule completed", { googleSynced });
      return jsonResponse(200, { ok: true, action: 'rescheduled', google_synced: googleSynced });
    }

    // Handle cancel
    if (action === 'cancel') {
      const { appointment_id, cancel_token } = payload as CancelPayload;
      
      if (!appointment_id) {
        return jsonResponse(400, { error: "Missing appointment_id" });
      }

      if (!cancel_token) {
        return jsonResponse(400, { error: "Cancel token is required for authorization" });
      }

      // Get existing appointment with calendar event and profile
      const { data: appointment, error: aptError } = await admin
        .from("appointments")
        .select("*, cancel_token, calendar_events(id, google_event_id), profiles:assigned_to_user_id(google_calendar_connected, google_refresh_token, google_calendar_id)")
        .eq("id", appointment_id)
        .single();

      if (aptError || !appointment) {
        return jsonResponse(404, { error: "Appointment not found" });
      }

      // Validate cancel token
      if (appointment.cancel_token !== cancel_token) {
        console.log("Invalid cancel token for cancel attempt:", appointment_id);
        return jsonResponse(403, { error: "Invalid authorization token" });
      }

      let googleDeleted = false;
      const calendarEvent = appointment.calendar_events?.[0];
      const profile = appointment.profiles;

      // Delete from Google Calendar first if connected
      if (calendarEvent?.google_event_id && profile?.google_calendar_connected && profile.google_refresh_token) {
        const accessToken = await refreshAccessToken(profile.google_refresh_token);
        if (accessToken) {
          const calendarId = profile.google_calendar_id || "primary";
          googleDeleted = await deleteGoogleEvent(accessToken, calendarId, calendarEvent.google_event_id);
        }
      }

      // Update appointment status
      const { error: updateError } = await admin
        .from("appointments")
        .update({
          status: 'canceled',
          notes: `${appointment.notes || ''}\n[Cancelado por cliente el ${new Date().toLocaleString('es-CL')}]`
        })
        .eq("id", appointment_id);

      if (updateError) {
        return jsonResponse(500, { error: "Failed to cancel appointment", details: updateError });
      }

      // Delete calendar event locally
      await admin
        .from("calendar_events")
        .delete()
        .eq("appointment_id", appointment_id);

      // Create notification for staff
      await admin.from("notifications").insert({
        workshop_id: appointment.workshop_id,
        user_id: appointment.assigned_to_user_id,
        appointment_id: appointment_id,
        type: "appointment_canceled",
        title: "Cita cancelada",
        message: `Una cita ha sido cancelada por el cliente`
      });

      console.log("Cancel completed", { googleDeleted });
      return jsonResponse(200, { ok: true, action: 'canceled', google_deleted: googleDeleted });
    }

    // Handle create (default)
    const createPayload = payload as CreatePayload;
    const {
      workshop_id,
      professional_id,
      service_name,
      start_datetime,
      end_datetime,
      contact_name,
      contact_phone
    } = createPayload;

    if (
      !workshop_id ||
      !professional_id ||
      !service_name ||
      !start_datetime ||
      !end_datetime ||
      !contact_name ||
      !contact_phone
    ) {
      return jsonResponse(400, { error: "Missing required fields" });
    }

    const phone = normalizePhone(contact_phone);

    // Validate workshop is active
    const { data: isActive, error: isActiveError } = await admin
      .rpc("is_workshop_active", { _workshop_id: workshop_id })
      .single();

    if (isActiveError) {
      return jsonResponse(500, { error: "Failed to validate workshop", details: isActiveError });
    }
    if (!isActive) {
      return jsonResponse(403, { error: "Workshop is not active" });
    }

    // Get professional's Google Calendar info
    const { data: professionalProfile } = await admin
      .from("profiles")
      .select("google_calendar_connected, google_refresh_token, google_calendar_id")
      .eq("id", professional_id)
      .single();

    // Find or create contact - search by phone OR whatsapp_id (which may contain the phone)
    const phoneDigits = phone.replace(/\D/g, '');
    
    const { data: existingContacts, error: existingContactError } = await admin
      .from("contacts")
      .select("id, phone, whatsapp_id")
      .eq("workshop_id", workshop_id)
      .or(`phone.eq.${phone},whatsapp_id.ilike.%${phoneDigits.slice(-9)}%`);

    if (existingContactError) {
      console.error("Failed to lookup contact:", existingContactError);
      return jsonResponse(500, { error: "Failed to lookup contact", details: existingContactError });
    }

    let contactId = existingContacts?.[0]?.id as string | undefined;
    console.log("Contact lookup result:", { phone, phoneDigits, existingContacts, contactId });

    if (!contactId) {
      const { data: newContact, error: contactError } = await admin
        .from("contacts")
        .insert({
          workshop_id,
          name: contact_name,
          phone,
          did_schedule: true,
          schedule_confidence: 1.0,
          lead_score: 100, // Max score when booking
        })
        .select("id")
        .single();

      if (contactError) {
        return jsonResponse(500, { error: "Failed to create contact", details: contactError });
      }

      contactId = newContact.id;
    } else {
      await admin
        .from("contacts")
        .update({
          did_schedule: true,
          schedule_confidence: 1.0,
          lead_score: 100, // Max score when booking
          lead_score_reasoning: "Cliente agendó una cita",
          ...(contact_name && { name: contact_name }),
        })
        .eq("id", contactId);
      
      console.log("Updated existing contact as scheduled with lead_score 100:", contactId);
    }

    // Create appointment
    const { data: appointment, error: appointmentError } = await admin
      .from("appointments")
      .insert({
        workshop_id,
        contact_id: contactId,
        assigned_to_user_id: professional_id,
        service_type: service_name,
        start_datetime,
        end_datetime,
        status: "scheduled",
        notes: `Reserva online - ${contact_name} (${phone})`,
      })
      .select("id")
      .single();

    if (appointmentError) {
      return jsonResponse(500, { error: "Failed to create appointment", details: appointmentError });
    }

    // Create calendar event locally first
    const eventTitle = `${service_name} - ${contact_name}`;
    const eventDescription = `Teléfono: ${phone}`;
    
    const { data: calendarEvent, error: eventError } = await admin
      .from("calendar_events")
      .insert({
        workshop_id,
        user_id: professional_id,
        contact_id: contactId,
        appointment_id: appointment.id,
        title: eventTitle,
        start_time: start_datetime,
        end_time: end_datetime,
        event_type: "appointment",
        description: eventDescription,
      })
      .select("id")
      .single();

    // Sync to Google Calendar if professional has it connected
    let googleEventId: string | null = null;
    if (professionalProfile?.google_calendar_connected && professionalProfile.google_refresh_token) {
      console.log("Professional has Google Calendar connected, syncing...");
      const accessToken = await refreshAccessToken(professionalProfile.google_refresh_token);
      
      if (accessToken) {
        const calendarId = professionalProfile.google_calendar_id || "primary";
        googleEventId = await createGoogleEvent(accessToken, calendarId, {
          title: eventTitle,
          description: eventDescription,
          start_time: start_datetime,
          end_time: end_datetime
        });

        // Save google_event_id to our calendar_events table
        if (googleEventId && calendarEvent) {
          await admin
            .from("calendar_events")
            .update({ google_event_id: googleEventId, synced_at: new Date().toISOString() })
            .eq("id", calendarEvent.id);
          
          console.log("Saved google_event_id to calendar_events:", googleEventId);
        }
      } else {
        console.log("Failed to get Google access token for professional");
      }
    } else {
      console.log("Professional does not have Google Calendar connected");
    }

    // Check for recent conversation (within 24h) and send thank you message via WhatsApp
    // Meta policy: can only send messages within 24h customer service window
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data: recentConversation } = await admin
      .from("conversations")
      .select("id, last_message_at")
      .eq("contact_id", contactId)
      .eq("workshop_id", workshop_id)
      .gte("last_message_at", twentyFourHoursAgo)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    
    let whatsappMessageSent = false;
    
    if (recentConversation) {
      // Update conversation status to 'booked'
      await admin
        .from("conversations")
        .update({ status: "booked" })
        .eq("id", recentConversation.id);
      console.log("Updated conversation status to booked:", recentConversation.id);

      // Get workshop WhatsApp config
      const { data: workshopData } = await admin
        .from("workshops")
        .select("whatsapp_connected, whatsapp_phone_number_id, whatsapp_access_token, name")
        .eq("id", workshop_id)
        .single();

      // Get contact's WhatsApp ID
      const { data: contactData } = await admin
        .from("contacts")
        .select("whatsapp_id, phone")
        .eq("id", contactId)
        .single();

      const recipientPhone = contactData?.whatsapp_id || contactData?.phone;
      const globalWhatsAppToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
      const accessToken = globalWhatsAppToken || workshopData?.whatsapp_access_token;

      if (workshopData?.whatsapp_connected && workshopData.whatsapp_phone_number_id && accessToken && recipientPhone) {
        // Format appointment date nicely with Chile timezone
        const appointmentDate = new Date(start_datetime);
        
        // Use Intl.DateTimeFormat for proper timezone handling
        const dateFormatter = new Intl.DateTimeFormat('es-CL', { 
          weekday: 'long', 
          day: 'numeric', 
          month: 'long',
          timeZone: 'America/Santiago'
        });
        const timeFormatter = new Intl.DateTimeFormat('es-CL', { 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: false,
          timeZone: 'America/Santiago'
        });
        
        const formattedDate = dateFormatter.format(appointmentDate);
        const formattedTime = timeFormatter.format(appointmentDate);

        const thankYouMessage = `¡Gracias por agendar con ${workshopData.name || 'nosotros'}! 🎉\n\n` +
          `Tu cita para *${service_name}* ha sido confirmada:\n` +
          `📅 ${formattedDate}\n` +
          `🕐 ${formattedTime} hrs\n\n` +
          `Te esperamos. Si necesitas reagendar o cancelar, responde a este mensaje.`;

        try {
          const metaApiUrl = `https://graph.facebook.com/v18.0/${workshopData.whatsapp_phone_number_id}/messages`;
          
          const metaResponse = await fetch(metaApiUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to: recipientPhone,
              type: 'text',
              text: { body: thankYouMessage },
            }),
          });

          const metaResult = await metaResponse.json();
          
          if (metaResponse.ok) {
            whatsappMessageSent = true;
            console.log("WhatsApp thank you message sent:", metaResult.messages?.[0]?.id);

            // Insert outbound message record
            await admin.from("messages").insert({
              workshop_id,
              conversation_id: recentConversation.id,
              text: thankYouMessage,
              direction: 'outbound',
              channel: 'whatsapp',
            });

            // Update conversation last_message_at
            await admin
              .from("conversations")
              .update({ last_message_at: new Date().toISOString() })
              .eq("id", recentConversation.id);
          } else {
            console.error("Failed to send WhatsApp message:", metaResult);
          }
        } catch (whatsappError) {
          console.error("Error sending WhatsApp thank you message:", whatsappError);
        }
      } else {
        console.log("Cannot send WhatsApp: missing config or no recent conversation within 24h window");
      }
    } else {
      // No recent conversation, just check if any conversation exists to update status
      const { data: anyConversation } = await admin
        .from("conversations")
        .select("id")
        .eq("contact_id", contactId)
        .eq("workshop_id", workshop_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (anyConversation) {
        await admin
          .from("conversations")
          .update({ status: "booked" })
          .eq("id", anyConversation.id);
        console.log("Updated older conversation status to booked (no WhatsApp sent - outside 24h window):", anyConversation.id);
      }
    }

    // Create notification for staff with proper Chile timezone
    const notifDateFormatter = new Intl.DateTimeFormat('es-CL', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/Santiago'
    });
    const formattedNotifDate = notifDateFormatter.format(new Date(start_datetime));
    
    const { error: notifError } = await admin.from("notifications").insert({
      workshop_id,
      user_id: professional_id,
      appointment_id: appointment.id,
      type: "new_appointment",
      title: "Nueva cita agendada",
      message: `${contact_name} agendó ${service_name} para el ${formattedNotifDate}`
    });

    console.log("Create completed:", { 
      appointment_id: appointment.id, 
      google_synced: !!googleEventId,
      notification_created: !notifError,
      whatsapp_message_sent: whatsappMessageSent
    });

    return jsonResponse(200, {
      ok: true,
      appointment_id: appointment.id,
      contact_id: contactId,
      calendar_event_created: !eventError,
      google_synced: !!googleEventId,
      notification_created: !notifError,
      whatsapp_message_sent: whatsappMessageSent
    });
  } catch (e) {
    console.error("Unexpected error:", e);
    
    // Log error to health_logs for monitoring
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && serviceKey) {
        const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
        await admin.from('health_logs').insert({
          workshop_id: null,
          event_type: 'error',
          category: 'booking',
          message: `Public booking error: ${String(e)}`,
          metadata: { error: String(e), timestamp: new Date().toISOString() }
        });
      }
    } catch (logErr) {
      console.error('Failed to log to health_logs:', logErr);
    }
    
    return jsonResponse(500, { error: "Unexpected error", details: String(e) });
  }
});
