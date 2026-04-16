-- Make quotations bucket private
UPDATE storage.buckets SET public = false WHERE id = 'quotations';

-- Drop existing policies if any
DROP POLICY IF EXISTS "authenticated_read_quotations" ON storage.objects;
DROP POLICY IF EXISTS "authenticated_write_quotations" ON storage.objects;
DROP POLICY IF EXISTS "authenticated_update_quotations" ON storage.objects;
DROP POLICY IF EXISTS "authenticated_delete_quotations" ON storage.objects;

-- Read: only authenticated users from the same workshop
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

-- Insert: only ADMIN/STAFF from the workshop
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

-- Update: only ADMIN/STAFF from the workshop
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

-- Delete: only ADMIN from the workshop
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