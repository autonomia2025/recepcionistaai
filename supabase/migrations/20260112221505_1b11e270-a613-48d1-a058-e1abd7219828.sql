-- Qualify helper function with schema to avoid search_path resolution issues in RLS

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

DROP POLICY IF EXISTS "Anyone can view calendar events for availability" ON public.calendar_events;
CREATE POLICY "Anyone can view calendar events for availability"
ON public.calendar_events
FOR SELECT
TO anon, authenticated
USING (
  public.is_workshop_active(workshop_id)
);
