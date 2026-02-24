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
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // === SERVER-SIDE AUTHORIZATION CHECK ===
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.warn('Unauthorized access attempt: No authorization header');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      console.warn('Unauthorized access attempt: Invalid token');
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Check if caller is SUPERADMIN
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    
    if (profile?.role !== 'SUPERADMIN') {
      console.warn('Unauthorized user creation attempt by non-SUPERADMIN:', user.id, 'role:', profile?.role);
      return new Response(JSON.stringify({ 
        error: 'Unauthorized - SUPERADMIN role required' 
      }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // === END AUTHORIZATION CHECK ===

    const { workshop_id, email, password, full_name, role } = await req.json();

    if (!workshop_id || !email || !password || !full_name) {
      return new Response(JSON.stringify({ 
        error: 'Missing required fields: workshop_id, email, password, full_name' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('SUPERADMIN', user.id, 'creating user for workshop:', workshop_id, 'email:', email);

    // 1. Create user in auth.users
    const { data: authData, error: createAuthError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        full_name,
      },
    });

    if (createAuthError) {
      console.error('Error creating auth user:', createAuthError);
      return new Response(JSON.stringify({ error: createAuthError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = authData.user.id;
    console.log('Created auth user:', userId);

    // 2. Update or create profile (trigger may have already created it)
    // Use upsert to handle the case where trigger already created the profile
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: userId,
        email,
        full_name,
        workshop_id,
        role: role || 'ADMIN',
        status: 'active',
      }, {
        onConflict: 'id',
      });

    if (profileError) {
      console.error('Error upserting profile:', profileError);
      // Try to clean up auth user
      await supabase.auth.admin.deleteUser(userId);
      return new Response(JSON.stringify({ error: profileError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Upserted profile for user:', userId);

    // 3. Create user_roles entry
    const { error: roleError } = await supabase
      .from('user_roles')
      .insert({
        user_id: userId,
        role: role || 'ADMIN',
      });

    if (roleError) {
      console.error('Error creating user role:', roleError);
      // Not critical, continue
    }

    return new Response(JSON.stringify({ 
      success: true, 
      user_id: userId,
      message: 'User created successfully'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Create user error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
