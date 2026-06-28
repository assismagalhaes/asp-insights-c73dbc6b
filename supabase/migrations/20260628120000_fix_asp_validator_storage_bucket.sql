INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'asp-validator-uploads',
  'asp-validator-uploads',
  false,
  52428800,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'asp_validator_storage_select_own'
  ) THEN
    CREATE POLICY "asp_validator_storage_select_own"
      ON storage.objects
      FOR SELECT
      USING (
        bucket_id = 'asp-validator-uploads'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'asp_validator_storage_insert_own'
  ) THEN
    CREATE POLICY "asp_validator_storage_insert_own"
      ON storage.objects
      FOR INSERT
      WITH CHECK (
        bucket_id = 'asp-validator-uploads'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'asp_validator_storage_update_own'
  ) THEN
    CREATE POLICY "asp_validator_storage_update_own"
      ON storage.objects
      FOR UPDATE
      USING (
        bucket_id = 'asp-validator-uploads'
        AND (storage.foldername(name))[1] = auth.uid()::text
      )
      WITH CHECK (
        bucket_id = 'asp-validator-uploads'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'asp_validator_storage_delete_own'
  ) THEN
    CREATE POLICY "asp_validator_storage_delete_own"
      ON storage.objects
      FOR DELETE
      USING (
        bucket_id = 'asp-validator-uploads'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
