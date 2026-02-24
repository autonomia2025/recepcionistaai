-- Drop and recreate public INSERT policies with explicit anon role
-- These policies were conflicting because other policies use auth.uid() which returns null for anon users

-- Recreate appointments insert policy to be more permissive for anon
DROP POLICY IF EXISTS "Anyone can create appointments for booking" ON public.appointments;
CREATE POLICY "Public booking insert appointments" 
ON public.appointments 
FOR INSERT 
TO anon, authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.workshops w 
    WHERE w.id = workshop_id AND w.is_active = true
  )
);

-- Recreate contacts insert policy 
DROP POLICY IF EXISTS "Anyone can create contacts for booking" ON public.contacts;
CREATE POLICY "Public booking insert contacts" 
ON public.contacts 
FOR INSERT 
TO anon, authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.workshops w 
    WHERE w.id = workshop_id AND w.is_active = true
  )
);

-- Recreate contacts select policy
DROP POLICY IF EXISTS "Anyone can check existing contacts for booking" ON public.contacts;
CREATE POLICY "Public booking select contacts" 
ON public.contacts 
FOR SELECT 
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.workshops w 
    WHERE w.id = workshop_id AND w.is_active = true
  )
);

-- Recreate calendar_events insert policy
DROP POLICY IF EXISTS "Anyone can create calendar events for booking" ON public.calendar_events;
CREATE POLICY "Public booking insert calendar events" 
ON public.calendar_events 
FOR INSERT 
TO anon, authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.workshops w 
    WHERE w.id = workshop_id AND w.is_active = true
  )
);