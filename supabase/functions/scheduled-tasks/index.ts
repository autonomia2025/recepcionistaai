import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createScheduledTasksHandler, SCHEDULED_TASKS } from "../_shared/scheduledTasks.ts";

// Called by pg_cron (public.invoke_scheduled_task) or, as a fallback, by an
// external cron: POST {"task":"heartbeat","trigger":"external"} with header
// x-cron-secret = the Vault secret "cron_secret".
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

serve(createScheduledTasksHandler({
  supabase,
  tasks: SCHEDULED_TASKS,
  verifySecret: async (token) => {
    const { data, error } = await supabase.rpc('verify_cron_secret', { _token: token });
    if (error) throw error;
    return data === true;
  },
}));
