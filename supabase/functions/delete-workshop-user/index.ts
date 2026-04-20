import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await admin.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('role, workshop_id')
      .eq('id', user.id)
      .single();

    if (!callerProfile || (callerProfile.role !== 'ADMIN' && callerProfile.role !== 'SUPERADMIN')) {
      return new Response(JSON.stringify({ error: 'Forbidden - ADMIN or SUPERADMIN required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { user_id: targetUserId } = await req.json();
    if (!targetUserId) {
      return new Response(JSON.stringify({ error: 'user_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (targetUserId === user.id) {
      return new Response(JSON.stringify({ error: 'No puedes eliminarte a ti mismo' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch target profile to validate scope
    const { data: targetProfile } = await admin
      .from('profiles')
      .select('id, workshop_id, role, email')
      .eq('id', targetUserId)
      .maybeSingle();

    // ADMIN can only delete users from their own workshop
    if (callerProfile.role === 'ADMIN') {
      if (!targetProfile || targetProfile.workshop_id !== callerProfile.workshop_id) {
        return new Response(JSON.stringify({ error: 'No puedes eliminar usuarios de otro negocio' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (targetProfile.role === 'SUPERADMIN') {
        return new Response(JSON.stringify({ error: 'No puedes eliminar un SUPERADMIN' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Cleanup landing_team rows linked to this profile
    if (targetProfile) {
      await admin.from('landing_team').delete().eq('profile_id', targetUserId);
    }

    // Delete profile row (in case it exists)
    await admin.from('profiles').delete().eq('id', targetUserId);

    // Mark any pending invites for this email as expired so re-invite works cleanly
    if (targetProfile?.email) {
      await admin
        .from('invites')
        .update({ status: 'expired' })
        .eq('email', targetProfile.email)
        .eq('status', 'pending');
    }

    // Finally delete the auth user — this is what releases the email for re-invitation
    const { error: deleteAuthError } = await admin.auth.admin.deleteUser(targetUserId);
    if (deleteAuthError) {
      console.error('Failed to delete auth user:', deleteAuthError);
      return new Response(JSON.stringify({ error: deleteAuthError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('delete-workshop-user error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
