import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AppointmentPayload {
  event: 'appointment_created' | 'appointment_updated' | 'appointment_cancelled';
  workshop_id: string;
  appointment: {
    id: string;
    service: string;
    professional: string;
    start_time: string;
    end_time: string;
    contact: {
      name: string;
      phone: string;
    };
  };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload: AppointmentPayload = await req.json();
    
    console.log('=== Appointment Webhook Triggered ===');
    console.log('Event:', payload.event);
    console.log('Workshop ID:', payload.workshop_id);
    console.log('Appointment:', JSON.stringify(payload.appointment, null, 2));
    
    // Here you can add custom logic to:
    // 1. Send notifications (email, SMS, WhatsApp)
    // 2. Integrate with external calendars
    // 3. Trigger other automations
    // 4. Call external APIs
    
    // For now, we just log the event and return success
    // In the future, this can be extended to:
    // - Send WhatsApp confirmation via the existing send-whatsapp function
    // - Sync with Google Calendar
    // - Send email notifications
    
    const response = {
      success: true,
      message: 'Webhook processed successfully',
      event: payload.event,
      appointment_id: payload.appointment.id,
      processed_at: new Date().toISOString(),
    };
    
    console.log('Webhook response:', response);
    
    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
    
  } catch (error: unknown) {
    console.error('Webhook error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
