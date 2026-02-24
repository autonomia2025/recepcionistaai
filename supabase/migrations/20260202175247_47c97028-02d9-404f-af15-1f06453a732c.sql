-- Create web_chat_logs table for debugging and monitoring
CREATE TABLE public.web_chat_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  event_type text NOT NULL, -- 'message_received', 'bot_replied', 'origin_rejected', 'rate_limited', 'error'
  origin text,
  message_preview text, -- primeros 100 caracteres del mensaje
  bot_reply_preview text, -- primeros 200 caracteres de la respuesta
  metadata jsonb DEFAULT '{}'::jsonb, -- datos adicionales: user_agent, timing, etc.
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indices para búsqueda rápida
CREATE INDEX idx_web_chat_logs_workshop ON public.web_chat_logs(workshop_id);
CREATE INDEX idx_web_chat_logs_created ON public.web_chat_logs(created_at DESC);
CREATE INDEX idx_web_chat_logs_event ON public.web_chat_logs(event_type);
CREATE INDEX idx_web_chat_logs_session ON public.web_chat_logs(session_id);

-- RLS
ALTER TABLE public.web_chat_logs ENABLE ROW LEVEL SECURITY;

-- Solo SUPERADMIN puede ver logs
CREATE POLICY "SUPERADMIN can view all web_chat_logs" ON public.web_chat_logs
  FOR SELECT USING (is_superadmin(auth.uid()));

-- Service role puede insertar (desde edge functions)
CREATE POLICY "Service role can insert web_chat_logs" ON public.web_chat_logs
  FOR INSERT WITH CHECK (true);

-- SUPERADMIN can delete logs for cleanup
CREATE POLICY "SUPERADMIN can delete web_chat_logs" ON public.web_chat_logs
  FOR DELETE USING (is_superadmin(auth.uid()));