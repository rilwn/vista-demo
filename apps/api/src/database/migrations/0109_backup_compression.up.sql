ALTER TABLE backup.execution_runs
  ADD COLUMN compression_algorithm varchar(20) NOT NULL DEFAULT 'postgres_custom',
  ADD COLUMN uncompressed_size_bytes bigint;

UPDATE backup.execution_runs
SET compression_algorithm = 'none'
WHERE source_type = 'object_storage';

UPDATE backup.execution_runs
SET uncompressed_size_bytes = artifact_size_bytes
WHERE source_type = 'object_storage' AND artifact_size_bytes > 0;

ALTER TABLE backup.execution_runs
  ADD CONSTRAINT backup_execution_compression_source_valid CHECK (
    (source_type = 'database' AND compression_algorithm IN ('none', 'postgres_custom'))
    OR (source_type = 'object_storage' AND compression_algorithm IN ('none', 'gzip'))
  ),
  ADD CONSTRAINT backup_execution_uncompressed_size_valid CHECK (
    uncompressed_size_bytes IS NULL OR uncompressed_size_bytes > 0
  ),
  ADD CONSTRAINT backup_execution_uncompressed_size_required CHECK (
    status IN ('running', 'failed')
    OR (source_type = 'object_storage' AND uncompressed_size_bytes IS NOT NULL)
    OR (source_type = 'database' AND compression_algorithm = 'none'
      AND uncompressed_size_bytes IS NOT NULL)
    OR (source_type = 'database' AND compression_algorithm = 'postgres_custom'
      AND uncompressed_size_bytes IS NULL)
  );

CREATE FUNCTION backup.prevent_execution_compression_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.compression_algorithm IS DISTINCT FROM NEW.compression_algorithm THEN
    RAISE EXCEPTION 'backup compression format is immutable';
  END IF;
  IF OLD.uncompressed_size_bytes IS NOT NULL
     AND OLD.uncompressed_size_bytes IS DISTINCT FROM NEW.uncompressed_size_bytes THEN
    RAISE EXCEPTION 'backup uncompressed size is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER backup_execution_compression_immutable
BEFORE UPDATE ON backup.execution_runs
FOR EACH ROW EXECUTE FUNCTION backup.prevent_execution_compression_change();

COMMENT ON COLUMN backup.execution_runs.compression_algorithm IS
  'Immutable artifact encoding selected from the approved policy at run creation.';
COMMENT ON COLUMN backup.execution_runs.uncompressed_size_bytes IS
  'Stream size before external compression; used to bound and verify decompression.';
