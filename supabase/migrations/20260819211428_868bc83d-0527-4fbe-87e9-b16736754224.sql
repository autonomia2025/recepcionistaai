ALTER TABLE public.workshops
ADD COLUMN IF NOT EXISTS max_storage_bytes bigint NOT NULL DEFAULT 1073741824;

CREATE INDEX IF NOT EXISTS idx_bot_documents_workshop_id ON public.bot_documents(workshop_id);