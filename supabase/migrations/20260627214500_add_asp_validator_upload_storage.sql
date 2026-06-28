ALTER TABLE public.asp_validator_uploads
  ADD COLUMN IF NOT EXISTS file_path text,
  ADD COLUMN IF NOT EXISTS storage_bucket text DEFAULT 'asp-validator-uploads',
  ADD COLUMN IF NOT EXISTS upload_source text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS ocr_structured_data jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ocr_data_quality_score numeric,
  ADD COLUMN IF NOT EXISTS ocr_structured_fields_count integer DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_asp_validator_uploads_file_path
  ON public.asp_validator_uploads (storage_bucket, file_path);

INSERT INTO storage.buckets (id, name, public)
VALUES ('asp-validator-uploads', 'asp-validator-uploads', false)
ON CONFLICT (id) DO NOTHING;

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
