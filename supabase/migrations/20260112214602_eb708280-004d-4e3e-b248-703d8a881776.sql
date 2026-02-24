-- Clean up old conflicting policies that don't specify anon role
DROP POLICY IF EXISTS "Anyone can create appointments for booking" ON public.appointments;
DROP POLICY IF EXISTS "Anyone can create contacts for booking" ON public.contacts;
DROP POLICY IF EXISTS "Anyone can check existing contacts for booking" ON public.contacts;
DROP POLICY IF EXISTS "Anyone can create calendar events for booking" ON public.calendar_events;