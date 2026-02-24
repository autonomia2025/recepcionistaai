
-- Fix: OAuth tokens exposed via profiles RLS
-- Create SECURITY DEFINER function that returns only safe columns for workshop members
CREATE OR REPLACE FUNCTION public.get_workshop_profiles(_workshop_id uuid)
RETURNS TABLE(
  id uuid,
  workshop_id uuid,
  full_name text,
  email text,
  role app_role,
  status user_status,
  created_at timestamptz,
  google_calendar_connected boolean,
  google_calendar_email text,
  google_connected_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.id, p.workshop_id, p.full_name, p.email, p.role, p.status, p.created_at,
         p.google_calendar_connected, p.google_calendar_email, p.google_connected_at
  FROM profiles p
  WHERE p.workshop_id = _workshop_id
    AND (
      _workshop_id = get_user_workshop_id(auth.uid())
      OR is_superadmin(auth.uid())
    );
$$;

-- Restrict base table SELECT to own profile only (prevents leaking tokens to workshop members)
-- SUPERADMIN policy remains unchanged
DROP POLICY IF EXISTS "Users can view profiles in their workshop" ON profiles;
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (id = auth.uid());
