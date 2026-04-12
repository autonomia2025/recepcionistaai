
-- Add zone column to contacts
ALTER TABLE public.contacts 
ADD COLUMN zone text DEFAULT NULL;

-- Add index for zone filtering
CREATE INDEX idx_contacts_zone ON public.contacts (zone) WHERE zone IS NOT NULL;

-- Add a validation trigger to ensure only valid zones
CREATE OR REPLACE FUNCTION public.validate_contact_zone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.zone IS NOT NULL AND NEW.zone NOT IN ('talca', 'puerto_montt', 'santiago') THEN
    RAISE EXCEPTION 'Invalid zone: %. Must be talca, puerto_montt, or santiago', NEW.zone;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_contact_zone_trigger
BEFORE INSERT OR UPDATE ON public.contacts
FOR EACH ROW
EXECUTE FUNCTION public.validate_contact_zone();
