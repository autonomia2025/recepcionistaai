-- Fix security warnings: Update permissive policies to be more secure

-- Drop and recreate the problematic policies

-- Fix: System can insert profiles - should only work during signup flow
DROP POLICY IF EXISTS "System can insert profiles" ON public.profiles;
CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT WITH CHECK (id = auth.uid());

-- Fix: Anyone can insert workshops - should be more restricted  
DROP POLICY IF EXISTS "Anyone can insert workshops" ON public.workshops;
CREATE POLICY "Authenticated users can create workshops" ON public.workshops
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Fix: System can insert subscriptions
DROP POLICY IF EXISTS "System can insert subscriptions" ON public.subscriptions;
CREATE POLICY "Authenticated users can create subscriptions" ON public.subscriptions
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Fix: System can manage roles - restrict to proper access
DROP POLICY IF EXISTS "System can manage roles" ON public.user_roles;
CREATE POLICY "Users can insert their own roles" ON public.user_roles
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "SUPERADMIN can manage all roles" ON public.user_roles
  FOR ALL USING (public.is_superadmin(auth.uid()));

-- Fix function search path for update_updated_at_column
DROP FUNCTION IF EXISTS public.update_updated_at_column() CASCADE;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Recreate triggers
CREATE TRIGGER update_bot_settings_updated_at
  BEFORE UPDATE ON public.bot_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_automations_settings_updated_at
  BEFORE UPDATE ON public.automations_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();