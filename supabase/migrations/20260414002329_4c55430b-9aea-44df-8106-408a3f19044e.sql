
CREATE TABLE public.blocked_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(workshop_id, phone_number)
);

ALTER TABLE public.blocked_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SUPERADMIN can manage all blocked_numbers"
ON public.blocked_numbers FOR ALL
USING (is_superadmin(auth.uid()))
WITH CHECK (is_superadmin(auth.uid()));

CREATE POLICY "ADMIN can manage blocked_numbers in their workshop"
ON public.blocked_numbers FOR ALL
USING (workshop_id = get_user_workshop_id(auth.uid()) AND has_role(auth.uid(), 'ADMIN'))
WITH CHECK (workshop_id = get_user_workshop_id(auth.uid()) AND has_role(auth.uid(), 'ADMIN'));

CREATE OR REPLACE FUNCTION public.is_number_blocked(_workshop_id uuid, _phone text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.blocked_numbers
    WHERE workshop_id = _workshop_id
    AND _phone LIKE '%' || phone_number || '%'
  )
$$;
