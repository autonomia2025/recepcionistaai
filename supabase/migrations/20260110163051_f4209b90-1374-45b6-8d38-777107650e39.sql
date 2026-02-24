-- Add policy for SUPERADMIN to insert bot_settings and automations_settings
CREATE POLICY "SUPERADMIN can insert bot_settings" ON public.bot_settings
  FOR INSERT WITH CHECK (public.is_superadmin(auth.uid()));

CREATE POLICY "SUPERADMIN can insert automations_settings" ON public.automations_settings
  FOR INSERT WITH CHECK (public.is_superadmin(auth.uid()));