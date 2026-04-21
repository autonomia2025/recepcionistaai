-- Increase bucket file size limit to 100MB and add progress tracking columns

-- 1. Update bot-documents bucket to allow files up to 100MB
UPDATE storage.buckets
SET file_size_limit = 104857600  -- 100 MB
WHERE id = 'bot-documents';

-- 2. Add progress tracking columns to bot_documents
ALTER TABLE public.bot_documents
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS processing_progress INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_pages INTEGER,
  ADD COLUMN IF NOT EXISTS processed_pages INTEGER DEFAULT 0;

-- 3. Enable realtime for bot_documents so frontend sees progress updates
ALTER TABLE public.bot_documents REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'bot_documents'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bot_documents;
  END IF;
END $$;