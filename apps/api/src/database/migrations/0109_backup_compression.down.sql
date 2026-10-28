DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM backup.execution_runs
    WHERE source_type = 'object_storage'
      AND compression_algorithm = 'gzip'
      AND status IN ('stored', 'verified')
      AND artifact_deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot remove backup compression metadata while gzip artifacts remain recoverable';
  END IF;
END;
$$;

DROP TRIGGER backup_execution_compression_immutable ON backup.execution_runs;
DROP FUNCTION backup.prevent_execution_compression_change();

ALTER TABLE backup.execution_runs
  DROP CONSTRAINT backup_execution_uncompressed_size_valid,
  DROP CONSTRAINT backup_execution_uncompressed_size_required,
  DROP CONSTRAINT backup_execution_compression_source_valid,
  DROP COLUMN uncompressed_size_bytes,
  DROP COLUMN compression_algorithm;
