import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Verify user is SUPERADMIN
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if user is superadmin
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "SUPERADMIN") {
      return new Response(JSON.stringify({ error: "Unauthorized - SUPERADMIN required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { workshop_id } = await req.json();

    if (!workshop_id) {
      return new Response(JSON.stringify({ error: "workshop_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get all user IDs associated with this workshop
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("workshop_id", workshop_id);

    const userIds = profiles?.map(p => p.id) || [];

    // Delete in order to respect foreign keys
    // 1. Delete messages
    await supabaseAdmin.from("messages").delete().eq("workshop_id", workshop_id);
    // 2. Delete conversations
    await supabaseAdmin.from("conversations").delete().eq("workshop_id", workshop_id);
    // 3. Delete appointments
    await supabaseAdmin.from("appointments").delete().eq("workshop_id", workshop_id);
    // 4. Delete calendar_events
    await supabaseAdmin.from("calendar_events").delete().eq("workshop_id", workshop_id);
    // 5. Delete contacts
    await supabaseAdmin.from("contacts").delete().eq("workshop_id", workshop_id);
    // 6. Delete service_requests
    await supabaseAdmin.from("service_requests").delete().eq("workshop_id", workshop_id);
    // 7. Delete notifications
    await supabaseAdmin.from("notifications").delete().eq("workshop_id", workshop_id);
    // 8. Delete invites
    await supabaseAdmin.from("invites").delete().eq("workshop_id", workshop_id);
    // 9. Delete integrations
    await supabaseAdmin.from("integrations").delete().eq("workshop_id", workshop_id);
    // 10. Delete api_usage
    await supabaseAdmin.from("api_usage").delete().eq("workshop_id", workshop_id);
    // 11. Delete billing_events
    await supabaseAdmin.from("billing_events").delete().eq("workshop_id", workshop_id);
    // 12. Delete subscriptions
    await supabaseAdmin.from("subscriptions").delete().eq("workshop_id", workshop_id);
    // 13. Delete bot_settings
    await supabaseAdmin.from("bot_settings").delete().eq("workshop_id", workshop_id);
    // 14. Delete automations_settings
    await supabaseAdmin.from("automations_settings").delete().eq("workshop_id", workshop_id);
    // 15. Delete system_alerts
    await supabaseAdmin.from("system_alerts").delete().eq("workshop_id", workshop_id);
    // 16. Delete user_roles for workshop users
    for (const userId of userIds) {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
    }
    // 17. Delete profiles
    await supabaseAdmin.from("profiles").delete().eq("workshop_id", workshop_id);
    // 18. Delete auth users
    for (const userId of userIds) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
    }
    // 19. Finally delete the workshop
    const { error: workshopError } = await supabaseAdmin
      .from("workshops")
      .delete()
      .eq("id", workshop_id);

    if (workshopError) {
      throw workshopError;
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error deleting workshop:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
