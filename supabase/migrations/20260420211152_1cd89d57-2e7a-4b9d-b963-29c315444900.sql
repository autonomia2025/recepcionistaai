ALTER TABLE public.workshops 
ADD COLUMN IF NOT EXISTS zone_detection_enabled boolean NOT NULL DEFAULT false;

UPDATE public.workshops 
SET zone_detection_enabled = true 
WHERE id = '610fb257-9736-493c-aa12-c478644b38a8'::uuid
   OR lower(name) LIKE '%soc%ingenier%';