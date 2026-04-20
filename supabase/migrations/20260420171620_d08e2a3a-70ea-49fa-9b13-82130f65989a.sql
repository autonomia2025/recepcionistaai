-- Fix prevent_profile_privilege_escalation to allow first-time workshop assignment
-- When OLD.workshop_id IS NULL, this is the user accepting an invite for the first time
-- That MUST be allowed; the RPC accept_invite (SECURITY DEFINER) handles the legitimacy check.

CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Service role and superadmins can do anything
  IF current_setting('role', true) = 'service_role' 
     OR is_superadmin(auth.uid())
     OR (has_role(auth.uid(), 'ADMIN') AND NEW.workshop_id = get_user_workshop_id(auth.uid()))
  THEN
    RETURN NEW;
  END IF;

  -- Block role changes by self
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    RAISE EXCEPTION 'Cannot change own role';
  END IF;

  -- Block status changes by self
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    RAISE EXCEPTION 'Cannot change own status';
  END IF;

  -- Workshop_id: allow ONLY first-time assignment (NULL -> something).
  -- Block changes between workshops or removal of workshop.
  IF OLD.workshop_id IS DISTINCT FROM NEW.workshop_id THEN
    IF OLD.workshop_id IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot change own workshop_id';
    END IF;
    -- OLD is NULL, NEW is not NULL: first assignment (invite acceptance) -> allowed
  END IF;

  RETURN NEW;
END;
$function$;