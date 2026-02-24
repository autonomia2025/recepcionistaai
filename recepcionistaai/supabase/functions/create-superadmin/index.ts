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
    const { email, password, full_name, init_secret } = await req.json();

    if (!email || !password || !full_name) {
      return new Response(JSON.stringify({ 
        error: 'Missing required fields: email, password, full_name' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Two modes of authorization:
    // 1. init_secret for initial setup (one-time use)
    // 2. SUPERADMIN auth token for subsequent creations
    
    const INIT_SECRET = Deno.env.get('SUPERADMIN_INIT_SECRET');
    let callerInfo = 'init_secret';
    
    if (init_secret && INIT_SECRET && init_secret === INIT_SECRET) {
      console.log('Using init_secret for SUPERADMIN creation');
      // Allow creation with init secret
    } else {
      // Standard auth check
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
      const { data: callerRole } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'SUPERADMIN')
        .single();
      
      if (!callerRole) {
        console.warn('Unauthorized superadmin creation attempt by:', user.id);
        return new Response(JSON.stringify({ 
          error: 'Unauthorized - SUPERADMIN role required' 
        }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      callerInfo = `SUPERADMIN ${user.id}`;
    }

    console.log(callerInfo, 'creating new SUPERADMIN:', email);

    // 1. Create user in auth.users
    const { data: authData, error: createAuthError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
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

    // 2. Create/update profile with SUPERADMIN role and NO workshop_id
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: userId,
        email,
        full_name,
        workshop_id: null, // SUPERADMIN has no workshop - global access
        role: 'SUPERADMIN',
        status: 'active',
      }, {
        onConflict: 'id',
      });

    if (profileError) {
      console.error('Error upserting profile:', profileError);
      await supabase.auth.admin.deleteUser(userId);
      return new Response(JSON.stringify({ error: profileError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Upserted profile for SUPERADMIN:', userId);

    // 3. Create user_roles entry
    const { error: roleError } = await supabase
      .from('user_roles')
      .insert({
        user_id: userId,
        role: 'SUPERADMIN',
      });

    if (roleError) {
      console.error('Error creating user role:', roleError);
      // Not critical since profile has role, but log it
    }

    return new Response(JSON.stringify({ 
      success: true, 
      user_id: userId,
      message: 'SUPERADMIN created successfully'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Create superadmin error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
