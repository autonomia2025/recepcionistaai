-- Fix 1: Remove public SELECT policy on profiles that exposes Google tokens and emails
-- The policy "Anyone can view active staff profiles" is exposing sensitive data

-- First, let's identify and drop the problematic policy
-- Looking at the schema output, we need to check for policies that allow public access to profiles

-- Drop the policy that allows anyone to view profiles (this exposes tokens and emails)
DROP POLICY IF EXISTS "Anyone can view active staff profiles" ON public.profiles;

-- Ensure authenticated users can still view profiles in their workshop for legitimate purposes
-- But ONLY expose non-sensitive fields through a new view or function

-- Create a secure function to get public-facing staff info (name only, no tokens)
CREATE OR REPLACE FUNCTION public.get_workshop_staff_public(_workshop_id UUID)
RETURNS TABLE(id UUID, full_name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name
  FROM public.profiles p
  WHERE p.workshop_id = _workshop_id
    AND p.status = 'active'
    AND public.is_workshop_active(_workshop_id);
$$;

-- Fix 2: Remove public SELECT policy on contacts that exposes customer PII
-- The edge function uses service role so it doesn't need this policy
DROP POLICY IF EXISTS "Public booking select contacts" ON public.contacts;