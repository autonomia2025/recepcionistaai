-- Restrict anonymous listing on storage.objects
-- Allow anonymous reads only for non-private buckets; private buckets always require auth
DROP POLICY IF EXISTS "no_anonymous_listing" ON storage.objects;
CREATE POLICY "no_anonymous_listing"
ON storage.objects FOR SELECT
USING (
  auth.role() = 'authenticated'
  OR bucket_id NOT IN ('quotations')
);