import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Appointment {
  id: string;
  workshop_id: string;
  contact_id: string;
  service_type: string;
  start_datetime: string;
  status: string;
  reminder_24h_sent_at: string | null;
  reminder_2h_sent_at: string | null; // Using existing column for 3h
}

interface Contact {
  id: string;
  name: string;
  email: string | null;
}

interface Workshop {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  email_reminders_enabled: boolean;
  gmail_connected: boolean;
}

interface AutomationSettings {
  workshop_id: string;
  confirm_24h: boolean;
  remind_3h: boolean;
  reminder_24h_subject: string | null;
  reminder_24h_body: string | null;
  reminder_3h_subject: string | null;
  reminder_3h_body: string | null;
}

const DEFAULT_24H_SUBJECT = 'Recordatorio: Tu cita mañana en {{taller}}';
const DEFAULT_24H_BODY = `Hola {{nombre}},

Te recordamos que tienes una cita agendada para mañana:

📆 Fecha: {{fecha}}
🕐 Hora: {{hora}}
🔧 Servicio: {{servicio}}
📍 Dirección: {{direccion}}

Si necesitas cancelar o reprogramar, por favor contáctanos con anticipación.

¡Te esperamos!

{{taller}}
{{telefono}}`;

const DEFAULT_3H_SUBJECT = 'Tu cita es en 3 horas - {{taller}}';
const DEFAULT_3H_BODY = `Hola {{nombre}},

Tu cita es en 3 horas. ¡Te esperamos!

🕐 Hora: {{hora}}
🔧 Servicio: {{servicio}}
📍 Dirección: {{direccion}}

{{taller}}
{{telefono}}`;

// Replace variables in template
function replaceVariables(text: string, data: {
  name: string;
  date: string;
  time: string;
  service: string;
  address: string;
  phone: string;
  workshopName: string;
}): string {
  return text
    .replace(/\{\{nombre\}\}/g, data.name)
    .replace(/\{\{fecha\}\}/g, data.date)
    .replace(/\{\{hora\}\}/g, data.time)
    .replace(/\{\{servicio\}\}/g, data.service)
    .replace(/\{\{direccion\}\}/g, data.address)
    .replace(/\{\{telefono\}\}/g, data.phone)
    .replace(/\{\{taller\}\}/g, data.workshopName);
}

// Format date for display
function formatDate(dateStr: string): { date: string; time: string; fullDate: string } {
  const date = new Date(dateStr);
  const options: Intl.DateTimeFormatOptions = { 
    day: 'numeric', 
    month: 'long',
    timeZone: 'America/Santiago'
  };
  const fullOptions: Intl.DateTimeFormatOptions = { 
    weekday: 'long',
    day: 'numeric', 
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Santiago'
  };
  const timeOptions: Intl.DateTimeFormatOptions = { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Santiago'
  };
  
  return {
    date: date.toLocaleDateString('es-CL', options),
    time: date.toLocaleTimeString('es-CL', timeOptions),
    fullDate: date.toLocaleDateString('es-CL', fullOptions)
  };
}

// Convert plain text body to simple HTML
function textToHtml(text: string, workshopName: string): string {
  const lines = text.split('\n').map(line => {
    if (line.trim() === '') return '<br>';
    return `<p style="margin: 0 0 8px; color: #3f3f46; font-size: 16px; line-height: 1.6;">${line}</p>`;
  }).join('\n');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 32px 40px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">
                📅 ${workshopName}
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px 40px;">
              ${lines}
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px; background-color: #fafafa; border-radius: 0 0 8px 8px; text-align: center;">
              <p style="margin: 0; color: #71717a; font-size: 14px;">${workshopName}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Send email reminder via send-gmail function
async function sendEmailReminder(
  supabaseUrl: string,
  serviceRoleKey: string,
  workshopId: string,
  contactEmail: string,
  subject: string,
  body: string,
  workshopName: string
): Promise<{ success: boolean; messageId: string | null; error?: string }> {
  try {
    const html = textToHtml(body, workshopName);

    const response = await fetch(`${supabaseUrl}/functions/v1/send-gmail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`
      },
      body: JSON.stringify({
        workshop_id: workshopId,
        to: contactEmail,
        subject,
        html,
        text: body,
        from_name: workshopName
      })
    });

    const result = await response.json();

    if (!response.ok || result.error) {
      return { success: false, messageId: null, error: result.error || 'Failed to send email' };
    }

    return { success: true, messageId: result.message_id };
  } catch (error) {
    console.error('Error sending email reminder:', error);
    return { success: false, messageId: null, error: String(error) };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const now = new Date();
    const results = { 
      processed: 0, 
      sent: 0, 
      errors: 0, 
      details: [] as { appointmentId: string; type: string; status: string; error?: string }[] 
    };

    // Time windows with 5 minute tolerance for cron execution
    // 24h reminder: appointments between 23h55m and 24h5m from now
    const hours24From = new Date(now.getTime() + 23 * 60 * 60 * 1000 + 55 * 60 * 1000);
    const hours24To = new Date(now.getTime() + 24 * 60 * 60 * 1000 + 5 * 60 * 1000);
    
    // 3h reminder: appointments between 2h55m and 3h5m from now
    const hours3From = new Date(now.getTime() + 2 * 60 * 60 * 1000 + 55 * 60 * 1000);
    const hours3To = new Date(now.getTime() + 3 * 60 * 60 * 1000 + 5 * 60 * 1000);

    console.log('Checking reminders at:', now.toISOString());
    console.log('24h window:', hours24From.toISOString(), '-', hours24To.toISOString());
    console.log('3h window:', hours3From.toISOString(), '-', hours3To.toISOString());

    // Fetch appointments needing 24h reminder
    const { data: appointments24h, error: err24h } = await supabase
      .from('appointments')
      .select('*')
      .eq('status', 'scheduled')
      .is('reminder_24h_sent_at', null)
      .gte('start_datetime', hours24From.toISOString())
      .lte('start_datetime', hours24To.toISOString());

    if (err24h) {
      console.error('Error fetching 24h appointments:', err24h);
    }

    // Fetch appointments needing 3h reminder (using reminder_2h_sent_at column)
    const { data: appointments3h, error: err3h } = await supabase
      .from('appointments')
      .select('*')
      .eq('status', 'scheduled')
      .is('reminder_2h_sent_at', null)
      .gte('start_datetime', hours3From.toISOString())
      .lte('start_datetime', hours3To.toISOString());

    if (err3h) {
      console.error('Error fetching 3h appointments:', err3h);
    }

    const allAppointments = [
      ...(appointments24h || []).map(a => ({ ...a, reminderType: 'reminder_24h' as const })),
      ...(appointments3h || []).map(a => ({ ...a, reminderType: 'reminder_3h' as const }))
    ];

    console.log(`Found ${allAppointments.length} appointments needing reminders`);

    for (const appointment of allAppointments) {
      results.processed++;

      try {
        // Get workshop
        const { data: workshop } = await supabase
          .from('workshops')
          .select('id, name, address, phone, email_reminders_enabled, gmail_connected')
          .eq('id', appointment.workshop_id)
          .single();

        if (!workshop) {
          results.details.push({ 
            appointmentId: appointment.id, 
            type: appointment.reminderType, 
            status: 'skipped', 
            error: 'Workshop not found' 
          });
          continue;
        }

        // Check if email reminders are enabled
        if (!workshop.email_reminders_enabled || !workshop.gmail_connected) {
          results.details.push({ 
            appointmentId: appointment.id, 
            type: appointment.reminderType, 
            status: 'skipped', 
            error: 'Email reminders disabled or Gmail not connected' 
          });
          continue;
        }

        // Get automation settings
        const { data: settings } = await supabase
          .from('automations_settings')
          .select('*')
          .eq('workshop_id', appointment.workshop_id)
          .single() as { data: AutomationSettings | null; error: unknown };

        // Check if this reminder type is enabled
        const isEnabled = appointment.reminderType === 'reminder_24h' 
          ? (settings?.confirm_24h ?? true)
          : (settings?.remind_3h ?? true);

        if (!isEnabled) {
          results.details.push({ 
            appointmentId: appointment.id, 
            type: appointment.reminderType, 
            status: 'skipped', 
            error: 'Reminder type disabled' 
          });
          continue;
        }

        // Get contact
        const { data: contact } = await supabase
          .from('contacts')
          .select('id, name, email')
          .eq('id', appointment.contact_id)
          .single();

        if (!contact || !contact.email) {
          results.details.push({ 
            appointmentId: appointment.id, 
            type: appointment.reminderType, 
            status: 'skipped', 
            error: 'Contact not found or no email' 
          });
          continue;
        }

        // Idempotency check via email_reminder_logs
        const { error: insertError } = await supabase
          .from('email_reminder_logs')
          .insert({
            appointment_id: appointment.id,
            reminder_type: appointment.reminderType,
            workshop_id: appointment.workshop_id,
            email_to: contact.email,
            status: 'pending'
          });

        if (insertError && insertError.code === '23505') {
          // Already processed
          console.log(`Email reminder ${appointment.reminderType} already processed for ${appointment.id}`);
          continue;
        }

        if (insertError) {
          console.error('Error inserting reminder log:', insertError);
          results.errors++;
          results.details.push({ 
            appointmentId: appointment.id, 
            type: appointment.reminderType, 
            status: 'error', 
            error: insertError.message 
          });
          continue;
        }

        // Prepare message data
        const { date, time, fullDate } = formatDate(appointment.start_datetime);
        const messageData = {
          name: contact.name,
          date: fullDate,
          time,
          service: appointment.service_type || 'Servicio',
          address: workshop.address || 'Nuestra ubicación',
          phone: workshop.phone || '',
          workshopName: workshop.name
        };

        // Get subject and body from settings
        const subject = appointment.reminderType === 'reminder_24h'
          ? replaceVariables(settings?.reminder_24h_subject || DEFAULT_24H_SUBJECT, messageData)
          : replaceVariables(settings?.reminder_3h_subject || DEFAULT_3H_SUBJECT, messageData);

        const body = appointment.reminderType === 'reminder_24h'
          ? replaceVariables(settings?.reminder_24h_body || DEFAULT_24H_BODY, messageData)
          : replaceVariables(settings?.reminder_3h_body || DEFAULT_3H_BODY, messageData);

        // Send email
        const emailResult = await sendEmailReminder(
          supabaseUrl,
          supabaseServiceKey,
          appointment.workshop_id,
          contact.email,
          subject,
          body,
          workshop.name
        );

        // Update email_reminder_logs status
        await supabase
          .from('email_reminder_logs')
          .update({ 
            status: emailResult.success ? 'sent' : 'failed',
            error_message: emailResult.error || null
          })
          .eq('appointment_id', appointment.id)
          .eq('reminder_type', appointment.reminderType);

        if (emailResult.success) {
          // Update appointment reminder sent timestamp
          const updateField = appointment.reminderType === 'reminder_24h' 
            ? { reminder_24h_sent_at: now.toISOString() }
            : { reminder_2h_sent_at: now.toISOString() }; // Using existing column

          await supabase
            .from('appointments')
            .update(updateField)
            .eq('id', appointment.id);

          // Log to health_logs
          await supabase.from('health_logs').insert({
            workshop_id: appointment.workshop_id,
            event_type: 'reminder_sent',
            category: 'gmail',
            message: `Email reminder (${appointment.reminderType}) sent to ${contact.email}`,
            metadata: { 
              appointment_id: appointment.id, 
              reminder_type: appointment.reminderType, 
              message_id: emailResult.messageId 
            }
          });

          results.sent++;
          results.details.push({ 
            appointmentId: appointment.id, 
            type: appointment.reminderType, 
            status: 'sent' 
          });

        } else {
          // Log failure to health_logs
          await supabase.from('health_logs').insert({
            workshop_id: appointment.workshop_id,
            event_type: 'reminder_failed',
            category: 'gmail',
            message: `Email reminder failed: ${emailResult.error}`,
            metadata: { 
              appointment_id: appointment.id, 
              reminder_type: appointment.reminderType, 
              error: emailResult.error 
            }
          });

          results.errors++;
          results.details.push({ 
            appointmentId: appointment.id, 
            type: appointment.reminderType, 
            status: 'failed', 
            error: emailResult.error 
          });
        }

      } catch (error) {
        results.errors++;
        results.details.push({ 
          appointmentId: appointment.id, 
          type: appointment.reminderType, 
          status: 'error', 
          error: String(error) 
        });
        console.error(`Error processing appointment ${appointment.id}:`, error);
      }
    }

    console.log('Reminder results:', results);

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Send reminders error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
