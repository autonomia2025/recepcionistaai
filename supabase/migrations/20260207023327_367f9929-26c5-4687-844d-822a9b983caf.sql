-- Fix: Remove public SELECT policy on contacts that exposes customer PII
-- The booking flow uses the edge function with service role, so this is unnecessary
DROP POLICY IF EXISTS "Public booking can check contacts" ON public.contacts;

-- Also remove legacy policy name if it exists
DROP POLICY IF EXISTS "Anyone can check existing contacts for booking" ON public.contacts;