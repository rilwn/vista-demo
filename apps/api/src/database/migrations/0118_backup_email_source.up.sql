ALTER TABLE backup.execution_runs
  DROP CONSTRAINT backup_execution_source_type_valid,
  ADD CONSTRAINT backup_execution_source_type_valid
    CHECK (source_type IN ('database', 'email', 'object_storage', 'file', 'file_share')),
  DROP CONSTRAINT backup_execution_compression_source_valid,
  ADD CONSTRAINT backup_execution_compression_source_valid CHECK (
    (source_type = 'database' AND compression_algorithm IN ('none', 'postgres_custom'))
    OR (source_type IN ('email', 'object_storage', 'file', 'file_share')
      AND compression_algorithm IN ('none', 'gzip'))
  ),
  DROP CONSTRAINT backup_execution_uncompressed_size_required,
  ADD CONSTRAINT backup_execution_uncompressed_size_required CHECK (
    status IN ('running', 'failed')
    OR (source_type IN ('email', 'object_storage', 'file', 'file_share')
      AND uncompressed_size_bytes IS NOT NULL)
    OR (source_type = 'database' AND compression_algorithm = 'none'
      AND uncompressed_size_bytes IS NOT NULL)
    OR (source_type = 'database' AND compression_algorithm = 'postgres_custom'
      AND uncompressed_size_bytes IS NULL)
  ),
  DROP CONSTRAINT backup_execution_object_source_identity_valid,
  ADD CONSTRAINT backup_execution_source_identity_valid CHECK (
    (source_type = 'email'
      AND source_bucket_snapshot IS NOT NULL
      AND source_bucket_snapshot LIKE 'email-%'
      AND source_identity_snapshot IS NOT NULL
      AND source_identity_snapshot ~ '^[0-9a-f]{64}$')
    OR (source_type = 'object_storage'
      AND (source_bucket_snapshot IS NULL OR length(source_bucket_snapshot) > 0)
      AND (source_identity_snapshot IS NULL OR source_identity_snapshot ~ '^[0-9a-f]{64}$'))
    OR (source_type NOT IN ('email', 'object_storage')
      AND source_bucket_snapshot IS NULL AND source_identity_snapshot IS NULL)
  );

COMMENT ON COLUMN backup.execution_runs.source_bucket_snapshot IS
  'Immutable source namespace: original S3 bucket, or non-secret email mailbox identity namespace.';
COMMENT ON COLUMN backup.execution_runs.source_identity_snapshot IS
  'Non-secret SHA-256 source identity; prevents incremental chains crossing a changed endpoint or mailbox scope.';
