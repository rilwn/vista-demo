DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM backup.execution_runs
    WHERE source_type IN ('file', 'file_share')
  ) THEN
    RAISE EXCEPTION 'Cannot remove file-share backup support while file-share execution evidence exists';
  END IF;
END;
$$;

ALTER TABLE backup.execution_runs
  DROP CONSTRAINT backup_execution_compression_source_valid,
  DROP CONSTRAINT backup_execution_uncompressed_size_required,
  ADD CONSTRAINT backup_execution_compression_source_valid CHECK (
    (source_type = 'database' AND compression_algorithm IN ('none', 'postgres_custom'))
    OR (source_type = 'object_storage' AND compression_algorithm IN ('none', 'gzip'))
  ),
  ADD CONSTRAINT backup_execution_uncompressed_size_required CHECK (
    status IN ('running', 'failed')
    OR (source_type = 'object_storage' AND uncompressed_size_bytes IS NOT NULL)
    OR (source_type = 'database' AND compression_algorithm = 'none'
      AND uncompressed_size_bytes IS NOT NULL)
    OR (source_type = 'database' AND compression_algorithm = 'postgres_custom'
      AND uncompressed_size_bytes IS NULL)
  );

ALTER TABLE backup.execution_runs
  DROP CONSTRAINT backup_execution_file_share_snapshot_valid,
  DROP CONSTRAINT backup_execution_source_type_valid,
  DROP COLUMN source_location_snapshot,
  DROP COLUMN source_code_snapshot,
  DROP COLUMN source_id,
  ADD CONSTRAINT backup_execution_source_type_valid
    CHECK (source_type IN ('database', 'object_storage'));
