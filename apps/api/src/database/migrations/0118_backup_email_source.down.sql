DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM backup.execution_runs WHERE source_type='email') THEN
    RAISE EXCEPTION 'Cannot remove email backup support while execution evidence exists';
  END IF;
END;
$$;

ALTER TABLE backup.execution_runs
  DROP CONSTRAINT backup_execution_source_identity_valid,
  ADD CONSTRAINT backup_execution_object_source_identity_valid CHECK (
    (source_bucket_snapshot IS NULL AND source_identity_snapshot IS NULL)
    OR (
      source_type = 'object_storage'
      AND (source_bucket_snapshot IS NULL OR length(source_bucket_snapshot) > 0)
      AND (source_identity_snapshot IS NULL OR source_identity_snapshot ~ '^[0-9a-f]{64}$')
    )
  ),
  DROP CONSTRAINT backup_execution_uncompressed_size_required,
  ADD CONSTRAINT backup_execution_uncompressed_size_required CHECK (
    status IN ('running', 'failed')
    OR (source_type IN ('object_storage', 'file', 'file_share')
      AND uncompressed_size_bytes IS NOT NULL)
    OR (source_type = 'database' AND compression_algorithm = 'none'
      AND uncompressed_size_bytes IS NOT NULL)
    OR (source_type = 'database' AND compression_algorithm = 'postgres_custom'
      AND uncompressed_size_bytes IS NULL)
  ),
  DROP CONSTRAINT backup_execution_compression_source_valid,
  ADD CONSTRAINT backup_execution_compression_source_valid CHECK (
    (source_type = 'database' AND compression_algorithm IN ('none', 'postgres_custom'))
    OR (source_type IN ('object_storage', 'file', 'file_share')
      AND compression_algorithm IN ('none', 'gzip'))
  ),
  DROP CONSTRAINT backup_execution_source_type_valid,
  ADD CONSTRAINT backup_execution_source_type_valid
    CHECK (source_type IN ('database', 'object_storage', 'file', 'file_share'));

COMMENT ON COLUMN backup.execution_runs.source_bucket_snapshot IS
  'Original object-store bucket for independent archive verification and recovery.';
COMMENT ON COLUMN backup.execution_runs.source_identity_snapshot IS
  'Non-secret SHA-256 of source endpoint, region and bucket; prevents deltas crossing source changes.';
