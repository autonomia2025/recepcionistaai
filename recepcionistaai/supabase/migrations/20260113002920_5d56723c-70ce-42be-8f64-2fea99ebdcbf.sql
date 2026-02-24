-- Add slug column to workshops for dynamic booking URLs
ALTER TABLE public.workshops ADD COLUMN IF NOT EXISTS slug text UNIQUE;

-- Generate slugs for existing workshops
UPDATE public.workshops 
SET slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(id::text, 1, 8)
WHERE slug IS NULL;