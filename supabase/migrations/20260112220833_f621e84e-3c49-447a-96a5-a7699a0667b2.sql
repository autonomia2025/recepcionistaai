-- Create a SECURITY DEFINER helper to check workshop status without relying on RLS-visible SELECTs
CREATE OR REPLACE FUNCTION public.is_workshop_active(_workshop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workshops w
    WHERE w.id = _workshop_id
      AND w.is_active = true
  );
$$;

-- Update public booking policies to use the helper (so anon works even if workshops is not publicly readable)
DROP POLICY IF EXISTS "Public booking insert appointments" ON public.appointments;
CREATE POLICY "Public booking insert appointments"
ON public.appointments
FOR INSERT
TO anon, authenticated
WITH CHECK (
  public.is_workshop_active(workshop_id)
);

DROP POLICY IF EXISTS "Public booking insert contacts" ON public.contacts;
CREATE POLICY "Public booking insert contacts"
ON public.contacts
FOR INSERT
TO anon, authenticated
WITH CHECK (
  public.is_workshop_active(workshop_id)
);

DROP POLICY IF EXISTS "Public booking select contacts" ON public.contacts;
CREATE POLICY "Public booking select contacts"
ON public.contacts
FOR SELECT
TO anon, authenticated
USING (
  public.is_workshop_active(workshop_id)
);

DROP POLICY IF EXISTS "Public booking insert calendar events" ON public.calendar_events;
CREATE POLICY "Public booking insert calendar events"
ON public.calendar_events
FOR INSERT
TO anon, authenticated
WITH CHECK (
  public.is_workshop_active(workshop_id)
);

-- (Optional) Keep availability readable for public booking, but also use helper for consistency
DROP POLICY IF EXISTS "Anyone can view calendar events for availability" ON public.calendar_events;
CREATE POLICY "Anyone can view calendar events for availability"
ON public.calendar_events
FOR SELECT
TO anon, authenticated
USING (
  public.is_workshop_active(workshop_id)
);