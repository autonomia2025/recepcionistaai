-- =====================================================
-- MULTI-TENANT SECURITY HARDENING MIGRATION
-- =====================================================

-- 1) PROFILES: Block privilege escalation
-- Drop existing policies that allow users to update their own profile freely
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Create restricted update policy - users can only update safe fields
CREATE POLICY "Users can update safe fields on own profile"
ON public.profiles
FOR UPDATE
USING (id = auth.uid())
WITH CHECK (
  id = auth.uid()
  -- Ensure role, workshop_id, and status are NOT changed by comparing OLD vs NEW
  -- This is enforced via trigger since RLS can't compare old/new directly
);

-- Create trigger to prevent unauthorized field changes
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If not service role or superadmin, block changes to sensitive fields
  IF NOT (
    current_setting('role', true) = 'service_role' 
    OR is_superadmin(auth.uid())
    OR has_role(auth.uid(), 'ADMIN') AND NEW.workshop_id = get_user_workshop_id(auth.uid())
  ) THEN
    -- Regular users cannot change these fields
    IF OLD.role IS DISTINCT FROM NEW.role THEN
      RAISE EXCEPTION 'Cannot change own role';
    END IF;
    IF OLD.workshop_id IS DISTINCT FROM NEW.workshop_id THEN
      RAISE EXCEPTION 'Cannot change own workshop_id';
    END IF;
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      RAISE EXCEPTION 'Cannot change own status';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_profile_escalation ON public.profiles;
CREATE TRIGGER prevent_profile_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_privilege_escalation();

-- 2) ACCEPT_INVITE RPC - Secure invite acceptance
CREATE OR REPLACE FUNCTION public.accept_invite(invite_token TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.invites%ROWTYPE;
  v_user_email TEXT;
  v_workshop_name TEXT;
BEGIN
  -- Get the invite
  SELECT * INTO v_invite
  FROM public.invites
  WHERE token = invite_token
  LIMIT 1;

  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  IF v_invite.status <> 'pending' THEN
    RAISE EXCEPTION 'Invite already used';
  END IF;

  IF v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'Invite expired';
  END IF;

  -- Get current user email
  SELECT lower(email) INTO v_user_email
  FROM auth.users
  WHERE id = auth.uid();

  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  IF v_user_email <> lower(v_invite.email) THEN
    RAISE EXCEPTION 'Email mismatch: this invite is for a different email address';
  END IF;

  -- Update profile with workshop assignment
  UPDATE public.profiles
  SET workshop_id = v_invite.workshop_id,
      role = v_invite.role,
      status = 'active'
  WHERE id = auth.uid();

  -- Mark invite as accepted
  UPDATE public.invites
  SET status = 'accepted'
  WHERE id = v_invite.id;

  -- Get workshop name for response
  SELECT name INTO v_workshop_name
  FROM public.workshops
  WHERE id = v_invite.workshop_id;

  RETURN jsonb_build_object(
    'success', true,
    'workshop_id', v_invite.workshop_id,
    'workshop_name', v_workshop_name,
    'role', v_invite.role
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_invite(TEXT) TO authenticated;

-- 3) HARDEN EXISTING RPCs

-- get_workshop_seats: validate caller belongs to workshop or is superadmin
CREATE OR REPLACE FUNCTION public.get_workshop_seats(_workshop_id uuid)
RETURNS TABLE(used_seats integer, max_seats integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    (SELECT COUNT(*)::INTEGER FROM public.profiles WHERE workshop_id = _workshop_id AND status != 'disabled') +
    (SELECT COUNT(*)::INTEGER FROM public.invites WHERE workshop_id = _workshop_id AND status = 'pending') AS used_seats,
    (SELECT s.max_users FROM public.subscriptions s WHERE s.workshop_id = _workshop_id AND s.status IN ('active', 'trial') ORDER BY s.started_at DESC LIMIT 1) AS max_seats
  WHERE 
    -- Security: only allow if user belongs to workshop or is superadmin
    _workshop_id = get_user_workshop_id(auth.uid()) 
    OR is_superadmin(auth.uid())
$$;

-- match_bot_knowledge: validate workshop ownership
CREATE OR REPLACE FUNCTION public.match_bot_knowledge(
  query_embedding vector, 
  p_workshop_id uuid, 
  match_threshold double precision DEFAULT 0.5, 
  match_count integer DEFAULT 5
)
RETURNS TABLE(id uuid, content text, file_name text, similarity double precision)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Security check: workshop must belong to caller or be active (for public bot queries)
  IF NOT (
    p_workshop_id = get_user_workshop_id(auth.uid())
    OR is_superadmin(auth.uid())
    OR is_workshop_active(p_workshop_id)  -- Allow for public chat widget
  ) THEN
    RAISE EXCEPTION 'Access denied to workshop knowledge base';
  END IF;

  RETURN QUERY
  SELECT 
    bk.id,
    bk.content,
    bk.file_name,
    (1 - (bk.embedding <=> query_embedding))::FLOAT AS similarity
  FROM public.bot_knowledge bk
  WHERE bk.workshop_id = p_workshop_id
    AND bk.embedding IS NOT NULL
    AND (1 - (bk.embedding <=> query_embedding)) > match_threshold
  ORDER BY bk.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- get_workshop_staff_public: only for active workshops (public booking pages)
CREATE OR REPLACE FUNCTION public.get_workshop_staff_public(_workshop_id uuid)
RETURNS TABLE(id uuid, full_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name
  FROM public.profiles p
  WHERE p.workshop_id = _workshop_id
    AND p.status = 'active'
    -- Security: only expose for active workshops (public booking)
    AND public.is_workshop_active(_workshop_id);
$$;

-- get_invite_by_token: secure function for invite lookup (already exists, ensure it's correct)
CREATE OR REPLACE FUNCTION public.get_invite_by_token(invite_token TEXT)
RETURNS TABLE(
  id UUID,
  email TEXT,
  role public.app_role,
  workshop_id UUID,
  status public.invite_status,
  expires_at TIMESTAMPTZ,
  workshop_name TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id,
         i.email,
         i.role,
         i.workshop_id,
         i.status,
         i.expires_at,
         w.name AS workshop_name
  FROM public.invites i
  JOIN public.workshops w ON w.id = i.workshop_id
  WHERE i.token = invite_token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_invite_by_token(TEXT) TO anon, authenticated;

-- get_public_calendar_events: for public booking availability
CREATE OR REPLACE FUNCTION public.get_public_calendar_events(
  _workshop_id UUID,
  _user_id UUID,
  _start TIMESTAMPTZ,
  _end TIMESTAMPTZ
)
RETURNS TABLE(
  user_id UUID,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ce.user_id, ce.start_time, ce.end_time
  FROM public.calendar_events ce
  WHERE ce.workshop_id = _workshop_id
    AND ce.user_id = _user_id
    AND ce.start_time >= _start
    AND ce.end_time <= _end
    AND public.is_workshop_active(_workshop_id);
$$;

GRANT EXECUTE ON FUNCTION public.get_public_calendar_events(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO anon, authenticated;

-- 4) USER_ROLES RLS HARDENING
DROP POLICY IF EXISTS "Users can insert their own roles" ON public.user_roles;

-- Only allow superadmin to manage roles, or backend service role
CREATE POLICY "Only SUPERADMIN can insert roles"
ON public.user_roles
FOR INSERT
WITH CHECK (
  is_superadmin(auth.uid())
  OR current_setting('role', true) = 'service_role'
);

DROP POLICY IF EXISTS "Users can update their own roles" ON public.user_roles;
-- No update policy for regular users - only superadmin via existing ALL policy

-- 5) NOTIFICATIONS RLS - Remove anon insert, require valid workshop
DROP POLICY IF EXISTS "Service role can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Anyone can insert notifications" ON public.notifications;

CREATE POLICY "Backend can insert notifications"
ON public.notifications
FOR INSERT
WITH CHECK (
  -- Only service role (backend) or authenticated users for their own workshop
  current_setting('role', true) = 'service_role'
  OR (
    auth.uid() IS NOT NULL 
    AND workshop_id = get_user_workshop_id(auth.uid())
  )
);

-- 6) INVITES - Remove direct public update, use RPC instead
DROP POLICY IF EXISTS "Anyone can update invite by token" ON public.invites;
DROP POLICY IF EXISTS "Anyone can view invite by token" ON public.invites;

-- Keep admin policies for managing invites in their workshop
-- The accept_invite RPC handles acceptance securely

-- 7) Additional hardening for contacts public policy
-- Ensure public SELECT on contacts is truly limited
DROP POLICY IF EXISTS "Anyone can check existing contacts for booking" ON public.contacts;

CREATE POLICY "Public booking can check contacts"
ON public.contacts
FOR SELECT
USING (
  -- Only for active workshops during booking flow
  is_workshop_active(workshop_id)
);