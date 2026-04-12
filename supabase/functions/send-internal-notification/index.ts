import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Internal notification types for admin alerts
type NotificationType = 'human_handoff' | 'hot_lead' | 'quotation' | 'appointment';

interface NotificationPayload {
  workshop_id: string;
  notification_type: NotificationType;
  contact_id?: string;
  conversation_id?: string;
  appointment_id?: string;
  service_request_id?: string;
  extra_data?: Record<string, unknown>;
}

interface Workshop {
  id: string;
  name: string;
  gmail_connected: boolean;
  admin_notification_email: string | null;
  email_notifications_handoff: boolean;
  email_notifications_hot_lead: boolean;
  email_notifications_appointment: boolean;
  email_notifications_quotation: boolean;
  booking_mode: string;
  email_primary_color: string | null;
  email_logo_url: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const payload: NotificationPayload = await req.json();
    const { workshop_id, notification_type, contact_id, conversation_id, appointment_id, service_request_id, extra_data } = payload;

    console.log('Internal notification request:', { workshop_id, notification_type });

    if (!workshop_id || !notification_type) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ========================================
    // SECURITY: This function is called by backend only (service role)
    // Verify it's being called with service role key
    // ========================================
    const authHeader = req.headers.get('Authorization');
    const isServiceRole = authHeader?.includes(supabaseServiceKey);
    
    if (!isServiceRole) {
      console.error('send-internal-notification called without service role');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get workshop settings
    const { data: workshop, error: workshopError } = await supabase
      .from('workshops')
      .select(`
        id, name, gmail_connected, admin_notification_email,
        email_notifications_handoff, email_notifications_hot_lead,
        email_notifications_appointment, email_notifications_quotation,
        booking_mode, email_primary_color, email_logo_url,
        zone_notification_emails
      `)
      .eq('id', workshop_id)
      .single();

    if (workshopError || !workshop) {
      console.error('Workshop not found:', workshopError);
      return new Response(JSON.stringify({ error: 'Workshop not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Check if Gmail is connected
    if (!workshop.gmail_connected) {
      console.log('Gmail not connected, skipping notification');
      return new Response(JSON.stringify({ success: false, reason: 'Gmail not connected' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Check if this notification type is enabled
    const isEnabled = checkNotificationEnabled(workshop as Workshop, notification_type);
    if (!isEnabled) {
      console.log(`Notification type ${notification_type} is disabled`);
      return new Response(JSON.stringify({ success: false, reason: 'Notification type disabled' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Validate notification type against booking_mode
    // - quotation: only for chatbot_only
    // - appointment: only for with_scheduling
    if (notification_type === 'quotation' && workshop.booking_mode !== 'chatbot_only') {
      console.log('Quotation notification skipped - workshop has scheduling');
      return new Response(JSON.stringify({ success: false, reason: 'Quotation only for chatbot_only' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    if (notification_type === 'appointment' && workshop.booking_mode !== 'with_scheduling') {
      console.log('Appointment notification skipped - workshop is chatbot_only');
      return new Response(JSON.stringify({ success: false, reason: 'Appointment only for with_scheduling' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get admin email: 1) zone-specific (SOC Ingenieria), 2) explicit setting, 3) connected Gmail, 4) first admin profile
    let adminEmail = workshop.admin_notification_email;

    // For SOC Ingenieria hot_lead notifications, route to zone-specific email
    const SOC_WORKSHOP_ID = '610fb257-a649-4115-b944-21f31e7952db';
    if (workshop_id === SOC_WORKSHOP_ID && notification_type === 'hot_lead' && extra_data?.zone) {
      const zoneEmails = (workshop as any).zone_notification_emails as Record<string, string> | null;
      const zoneEmail = zoneEmails?.[extra_data.zone as string];
      if (zoneEmail) {
        adminEmail = zoneEmail;
        console.log(`Routing hot_lead to zone email: ${extra_data.zone} -> ${zoneEmail}`);
      }
    }

    if (!adminEmail) {
      // Try connected Gmail email
      const { data: gmailToken } = await supabase
        .from('workshop_gmail_tokens')
        .select('gmail_email')
        .eq('workshop_id', workshop_id)
        .single();
      
      adminEmail = gmailToken?.gmail_email;
    }
    if (!adminEmail) {
      const { data: adminProfile } = await supabase
        .from('profiles')
        .select('email')
        .eq('workshop_id', workshop_id)
        .eq('role', 'ADMIN')
        .eq('status', 'active')
        .limit(1)
        .single();
      
      adminEmail = adminProfile?.email;
    }

    if (!adminEmail) {
      console.log('No admin email found');
      return new Response(JSON.stringify({ success: false, reason: 'No admin email' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get contact info if provided
    let contactName = 'Cliente';
    let contactPhone = '';
    if (contact_id) {
      const { data: contact } = await supabase
        .from('contacts')
        .select('name, phone, email, lead_score, detected_intent')
        .eq('id', contact_id)
        .single();
      
      if (contact) {
        contactName = contact.name;
        contactPhone = contact.phone || '';
      }
    }

    // Generate email content based on notification type
    const { subject, html, text } = generateEmailContent(
      notification_type,
      workshop as Workshop,
      contactName,
      contactPhone,
      conversation_id,
      appointment_id,
      service_request_id,
      extra_data,
      supabaseUrl
    );

    // Send email via send-gmail
    const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-gmail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({
        workshop_id,
        to: adminEmail,
        subject,
        html,
        text,
        from_name: `${workshop.name} - Alertas`
      })
    });

    const emailResult = await emailResponse.json();

    // Log the notification
    await supabase.from('internal_notification_logs').insert({
      workshop_id,
      notification_type,
      contact_id,
      conversation_id,
      appointment_id,
      service_request_id,
      email_to: adminEmail,
      email_subject: subject,
      status: emailResult.success ? 'sent' : 'failed',
      error_message: emailResult.error || null
    });

    if (emailResult.success) {
      console.log(`Internal notification sent: ${notification_type} to ${adminEmail}`);
      return new Response(JSON.stringify({ success: true, message_id: emailResult.message_id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } else {
      console.error('Failed to send notification:', emailResult.error);
      return new Response(JSON.stringify({ success: false, error: emailResult.error }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

  } catch (error) {
    console.error('Internal notification error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function checkNotificationEnabled(workshop: Workshop, type: NotificationType): boolean {
  switch (type) {
    case 'human_handoff':
      return workshop.email_notifications_handoff === true;
    case 'hot_lead':
      return workshop.email_notifications_hot_lead === true;
    case 'appointment':
      return workshop.email_notifications_appointment === true;
    case 'quotation':
      return workshop.email_notifications_quotation === true;
    default:
      return false;
  }
}

function generateEmailContent(
  type: NotificationType,
  workshop: Workshop,
  contactName: string,
  contactPhone: string,
  conversationId?: string,
  appointmentId?: string,
  serviceRequestId?: string,
  extraData?: Record<string, unknown>,
  supabaseUrl?: string
): { subject: string; html: string; text: string } {
  const primaryColor = workshop.email_primary_color || '#6366f1';
  const appUrl = supabaseUrl?.replace('supabase.co', 'lovable.app').replace('/functions/v1', '') || '';
  
  const configs: Record<NotificationType, { emoji: string; title: string; description: string; ctaText: string; ctaUrl: string; urgencyColor: string }> = {
    human_handoff: {
      emoji: '🙋',
      title: 'Cliente solicita atención humana',
      description: `${contactName} ha solicitado hablar con una persona. El bot ha sido pausado y espera tu respuesta.`,
      ctaText: 'Ver conversación',
      ctaUrl: conversationId ? `${appUrl}/inbox?conversation=${conversationId}` : `${appUrl}/inbox`,
      urgencyColor: '#f59e0b'
    },
    hot_lead: {
      emoji: '🔥',
      title: 'Lead caliente detectado',
      description: `${contactName} muestra alta intención de compra o urgencia. ${extraData?.intent ? `Intención: ${extraData.intent}` : ''}`,
      ctaText: 'Ver lead',
      ctaUrl: conversationId ? `${appUrl}/inbox?conversation=${conversationId}` : `${appUrl}/clients`,
      urgencyColor: '#ef4444'
    },
    quotation: {
      emoji: '📋',
      title: 'Nueva solicitud de cotización',
      description: `${contactName} ha solicitado una cotización. ${extraData?.product ? `Producto: ${extraData.product}` : ''}`,
      ctaText: 'Ver solicitud',
      ctaUrl: serviceRequestId ? `${appUrl}/requests?id=${serviceRequestId}` : `${appUrl}/requests`,
      urgencyColor: '#3b82f6'
    },
    appointment: {
      emoji: '📅',
      title: 'Nueva cita agendada',
      description: `${contactName} ha agendado una cita. ${extraData?.service ? `Servicio: ${extraData.service}` : ''} ${extraData?.date ? `Fecha: ${extraData.date}` : ''}`,
      ctaText: 'Ver agenda',
      ctaUrl: `${appUrl}/calendar`,
      urgencyColor: '#22c55e'
    }
  };

  const config = configs[type];

  const subject = `${config.emoji} ${config.title} - ${workshop.name}`;

  const text = `${config.title}\n\n${config.description}\n\nCliente: ${contactName}${contactPhone ? `\nTeléfono: ${contactPhone}` : ''}\n\n${config.ctaText}: ${config.ctaUrl}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 100%; max-width: 520px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); overflow: hidden;">
          
          <!-- Urgency bar -->
          <tr>
            <td style="height: 6px; background: ${config.urgencyColor};"></td>
          </tr>
          
          <!-- Header -->
          <tr>
            <td style="padding: 28px 32px 20px; text-align: center;">
              <div style="font-size: 48px; margin-bottom: 12px;">${config.emoji}</div>
              <h1 style="margin: 0; color: #18181b; font-size: 22px; font-weight: 700;">${config.title}</h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 0 32px 28px;">
              <p style="margin: 0 0 20px; color: #52525b; font-size: 16px; line-height: 1.6; text-align: center;">${config.description}</p>
              
              <!-- Contact info box -->
              <div style="background-color: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                <p style="margin: 0 0 8px; font-weight: 600; color: #18181b;">👤 ${contactName}</p>
                ${contactPhone ? `<p style="margin: 0; color: #52525b;">📞 ${contactPhone}</p>` : ''}
              </div>
              
              <!-- CTA Button -->
              <div style="text-align: center;">
                <a href="${config.ctaUrl}" style="display: inline-block; background-color: ${primaryColor}; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                  ${config.ctaText} →
                </a>
              </div>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; background-color: #fafafa; border-top: 1px solid #e5e5e5; text-align: center;">
              <p style="margin: 0; color: #a1a1aa; font-size: 13px;">${workshop.name} • Alerta automática</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
