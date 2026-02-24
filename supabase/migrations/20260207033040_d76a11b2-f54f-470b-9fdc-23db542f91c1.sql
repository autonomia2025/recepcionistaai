-- ============================================================
-- FIX: Drop overly permissive public SELECT on workshops table
-- that exposes API tokens (whatsapp_access_token, instagram_access_token, 
-- gmail_refresh_token, etc.) to unauthenticated users.
-- ============================================================

-- 1) Drop the dangerous public policy
DROP POLICY IF EXISTS "Anyone can view active workshops" ON public.workshops;

-- 2) Create a SECURITY DEFINER function for public booking pages
--    Returns ONLY safe, non-sensitive columns by slug
CREATE OR REPLACE FUNCTION public.get_public_workshop_by_slug(_slug text)
RETURNS TABLE(
  id uuid,
  name text,
  slug text,
  is_active boolean,
  address text,
  city text,
  category text,
  booking_mode text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.id, w.name, w.slug, w.is_active, w.address, w.city, w.category, w.booking_mode
  FROM public.workshops w
  WHERE w.slug = _slug
    AND w.is_active = true
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_workshop_by_slug(text) TO anon, authenticated;