-- 0012_storage_bucket.sql
-- Create the `csv-upload` Storage bucket and RLS policies so users can only
-- read/write their own uploaded CSVs. Path convention: `{user_id}/{upload_id}.csv`.

BEGIN;

-- 1) Create the bucket (idempotent) ----------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'csv-upload',
    'csv-upload',
    false,
    10 * 1024 * 1024,  -- 10MB cap matches the API upload limit
    ARRAY['text/csv', 'application/vnd.ms-excel', 'application/octet-stream']
)
ON CONFLICT (id) DO UPDATE
SET file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2) RLS — users can only access objects under their own folder ------------
-- The "folder" is the first segment of the storage path, e.g. `{user_id}/...`.
-- Storage objects already have RLS enabled by default in Supabase; we only
-- need to add per-user policies.

DROP POLICY IF EXISTS "csv_upload_owner_select" ON storage.objects;
CREATE POLICY "csv_upload_owner_select"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'csv-upload'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

DROP POLICY IF EXISTS "csv_upload_owner_insert" ON storage.objects;
CREATE POLICY "csv_upload_owner_insert"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'csv-upload'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

DROP POLICY IF EXISTS "csv_upload_owner_delete" ON storage.objects;
CREATE POLICY "csv_upload_owner_delete"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'csv-upload'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

COMMIT;
