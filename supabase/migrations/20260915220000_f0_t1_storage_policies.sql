-- Permissive policies are OR-ed together: these made quotations readable by any
-- authenticated user and by anon, and every other bucket readable by anyone.
DROP POLICY IF EXISTS "Authenticated can view quotations" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload quotations to their workshop" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can update quotations in their workshop" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can delete quotations in their workshop" ON storage.objects;
DROP POLICY IF EXISTS "Public can view quotations" ON storage.objects;
DROP POLICY IF EXISTS "no_anonymous_listing" ON storage.objects;

UPDATE storage.buckets SET public = false WHERE id = 'quotations';

DROP POLICY IF EXISTS "authenticated_read_quotations" ON storage.objects;
DROP POLICY IF EXISTS "authenticated_write_quotations" ON storage.objects;
DROP POLICY IF EXISTS "authenticated_update_quotations" ON storage.objects;
DROP POLICY IF EXISTS "authenticated_delete_quotations" ON storage.objects;
DROP POLICY IF EXISTS "superadmin_read_quotations" ON storage.objects;
DROP POLICY IF EXISTS "superadmin_read_bot_documents" ON storage.objects;

CREATE POLICY "authenticated_read_quotations"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'quotations'
  AND auth.role() = 'authenticated'
  AND auth.uid() IN (
    SELECT p.id FROM public.profiles p
    WHERE p.workshop_id::text = (string_to_array(name, '/'))[1]
  )
);

CREATE POLICY "authenticated_write_quotations"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'quotations'
  AND auth.role() = 'authenticated'
  AND auth.uid() IN (
    SELECT p.id FROM public.profiles p
    WHERE p.workshop_id::text = (string_to_array(name, '/'))[1]
    AND p.role IN ('ADMIN', 'STAFF')
  )
);

CREATE POLICY "authenticated_update_quotations"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'quotations'
  AND auth.role() = 'authenticated'
  AND auth.uid() IN (
    SELECT p.id FROM public.profiles p
    WHERE p.workshop_id::text = (string_to_array(name, '/'))[1]
    AND p.role IN ('ADMIN', 'STAFF')
  )
);

CREATE POLICY "authenticated_delete_quotations"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'quotations'
  AND auth.role() = 'authenticated'
  AND auth.uid() IN (
    SELECT p.id FROM public.profiles p
    WHERE p.workshop_id::text = (string_to_array(name, '/'))[1]
    AND p.role = 'ADMIN'
  )
);

-- SUPERADMIN kept read access to both buckets through the removed global policy.
CREATE POLICY "superadmin_read_quotations"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'quotations' AND public.is_superadmin(auth.uid()));

CREATE POLICY "superadmin_read_bot_documents"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'bot-documents' AND public.is_superadmin(auth.uid()));
