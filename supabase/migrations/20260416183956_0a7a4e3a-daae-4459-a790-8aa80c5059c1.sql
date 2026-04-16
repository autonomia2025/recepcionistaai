-- Create quotations bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('quotations', 'quotations', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to view quotations from their workshop
CREATE POLICY "Authenticated can view quotations"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'quotations');

-- Allow authenticated users to upload quotations to their workshop folder
CREATE POLICY "Authenticated can upload quotations to their workshop"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'quotations'
  AND (storage.foldername(name))[1] = get_user_workshop_id(auth.uid())::text
);

-- Allow authenticated users to update quotations in their workshop folder
CREATE POLICY "Authenticated can update quotations in their workshop"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'quotations'
  AND (storage.foldername(name))[1] = get_user_workshop_id(auth.uid())::text
);

-- Allow authenticated users to delete quotations in their workshop folder
CREATE POLICY "Authenticated can delete quotations in their workshop"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'quotations'
  AND (storage.foldername(name))[1] = get_user_workshop_id(auth.uid())::text
);

-- Public can view (since bucket is public for sharing quote links)
CREATE POLICY "Public can view quotations"
ON storage.objects FOR SELECT
TO anon
USING (bucket_id = 'quotations');