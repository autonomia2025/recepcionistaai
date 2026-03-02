-- SUPERADMIN can view all bot_documents
CREATE POLICY "SUPERADMIN can view all bot_documents"
ON public.bot_documents FOR SELECT
USING (is_superadmin(auth.uid()));

-- SUPERADMIN can view all bot_knowledge
CREATE POLICY "SUPERADMIN can view all bot_knowledge"
ON public.bot_knowledge FOR SELECT
USING (is_superadmin(auth.uid()));