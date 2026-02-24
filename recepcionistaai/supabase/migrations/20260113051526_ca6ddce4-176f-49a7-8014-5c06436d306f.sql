-- Allow SUPERADMIN to manage bot_settings
CREATE POLICY "SUPERADMIN can manage all bot_settings" 
ON public.bot_settings 
FOR ALL 
USING (is_superadmin(auth.uid()))
WITH CHECK (is_superadmin(auth.uid()));

-- Allow SUPERADMIN to update workshops
DROP POLICY IF EXISTS "SUPERADMIN can update all workshops" ON public.workshops;
CREATE POLICY "SUPERADMIN can update all workshops" 
ON public.workshops 
FOR UPDATE 
USING (is_superadmin(auth.uid()));