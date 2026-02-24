-- Enable pgvector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Table to track uploaded documents
CREATE TABLE public.bot_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id UUID REFERENCES public.workshops(id) ON DELETE CASCADE NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  file_type TEXT,
  chunk_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'error')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table to store document chunks with embeddings
CREATE TABLE public.bot_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id UUID REFERENCES public.workshops(id) ON DELETE CASCADE NOT NULL,
  document_id UUID REFERENCES public.bot_documents(id) ON DELETE CASCADE NOT NULL,
  file_name TEXT NOT NULL,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  embedding VECTOR(768),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_bot_documents_workshop ON public.bot_documents(workshop_id);
CREATE INDEX idx_bot_knowledge_workshop ON public.bot_knowledge(workshop_id);
CREATE INDEX idx_bot_knowledge_document ON public.bot_knowledge(document_id);

-- Vector similarity search index (using HNSW for better performance)
CREATE INDEX idx_bot_knowledge_embedding ON public.bot_knowledge 
  USING hnsw (embedding vector_cosine_ops);

-- Enable RLS
ALTER TABLE public.bot_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_knowledge ENABLE ROW LEVEL SECURITY;

-- RLS Policies for bot_documents
CREATE POLICY "Users can view their workshop documents" 
ON public.bot_documents FOR SELECT 
USING (workshop_id = public.get_user_workshop_id(auth.uid()));

CREATE POLICY "Users can insert documents to their workshop" 
ON public.bot_documents FOR INSERT 
WITH CHECK (workshop_id = public.get_user_workshop_id(auth.uid()));

CREATE POLICY "Users can delete their workshop documents" 
ON public.bot_documents FOR DELETE 
USING (workshop_id = public.get_user_workshop_id(auth.uid()));

CREATE POLICY "Users can update their workshop documents" 
ON public.bot_documents FOR UPDATE 
USING (workshop_id = public.get_user_workshop_id(auth.uid()));

-- RLS Policies for bot_knowledge
CREATE POLICY "Users can view their workshop knowledge" 
ON public.bot_knowledge FOR SELECT 
USING (workshop_id = public.get_user_workshop_id(auth.uid()));

CREATE POLICY "Users can insert knowledge to their workshop" 
ON public.bot_knowledge FOR INSERT 
WITH CHECK (workshop_id = public.get_user_workshop_id(auth.uid()));

CREATE POLICY "Users can delete their workshop knowledge" 
ON public.bot_knowledge FOR DELETE 
USING (workshop_id = public.get_user_workshop_id(auth.uid()));

-- Function for similarity search
CREATE OR REPLACE FUNCTION public.match_bot_knowledge(
  query_embedding VECTOR(768),
  p_workshop_id UUID,
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 5
) RETURNS TABLE (
  id UUID,
  content TEXT,
  file_name TEXT,
  similarity FLOAT
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT 
    bk.id,
    bk.content,
    bk.file_name,
    (1 - (bk.embedding <=> query_embedding))::FLOAT AS similarity
  FROM public.bot_knowledge bk
  WHERE bk.workshop_id = p_workshop_id
    AND bk.embedding IS NOT NULL
    AND (1 - (bk.embedding <=> query_embedding)) > match_threshold
  ORDER BY bk.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Storage bucket for documents
INSERT INTO storage.buckets (id, name, public) 
VALUES ('bot-documents', 'bot-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Users can upload to their workshop folder"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'bot-documents' 
  AND (storage.foldername(name))[1] = public.get_user_workshop_id(auth.uid())::text
);

CREATE POLICY "Users can view their workshop files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'bot-documents' 
  AND (storage.foldername(name))[1] = public.get_user_workshop_id(auth.uid())::text
);

CREATE POLICY "Users can delete their workshop files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'bot-documents' 
  AND (storage.foldername(name))[1] = public.get_user_workshop_id(auth.uid())::text
);