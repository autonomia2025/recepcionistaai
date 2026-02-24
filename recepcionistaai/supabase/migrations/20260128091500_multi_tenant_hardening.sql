-- Multi-tenant hardening: invites + public calendar availability

-- 1) Restrict invites: remove public SELECT on invites
DROP POLICY IF EXISTS "Anyone can view invite by token" ON public.invites;

-- Secure function to fetch invite by token
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

-- 2) Public calendar availability: avoid direct table access
DROP POLICY IF EXISTS "Anyone can view calendar events for availability" ON public.calendar_events;

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
