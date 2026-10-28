ALTER TABLE backup.execution_runs
  DROP CONSTRAINT backup_execution_source_type_valid,
  ADD COLUMN source_id uuid REFERENCES backup.protected_sources(id) ON DELETE RESTRICT,
  ADD COLUMN source_code_snapshot varchar(80),
  ADD COLUMN source_location_snapshot varchar(255),
  ADD CONSTRAINT backup_execution_source_type_valid
    CHECK (source_type IN ('database', 'object_storage', 'file', 'file_share'));

UPDATE backup.execution_runs run
SET source_id=source.id,
    source_code_snapshot=source.source_code,
    source_location_snapshot=source.location
FROM (
  SELECT DISTINCT ON (link.policy_id)
    link.policy_id,candidate.id,candidate.source_code,candidate.location
  FROM backup.policy_sources link
  JOIN backup.protected_sources candidate ON candidate.id=link.source_id
  ORDER BY link.policy_id,candidate.id
) source
WHERE run.policy_id=source.policy_id AND run.source_id IS NULL;

ALTER TABLE backup.execution_runs
  ADD CONSTRAINT backup_execution_file_share_snapshot_valid CHECK (
    source_type NOT IN ('file', 'file_share')
    OR (source_id IS NOT NULL AND source_code_snapshot IS NOT NULL
        AND source_location_snapshot IS NOT NULL)
  );

ALTER TABLE backup.execution_runs
  DROP CONSTRAINT backup_execution_compression_source_valid,
  DROP CONSTRAINT backup_execution_uncompressed_size_required,
  ADD CONSTRAINT backup_execution_compression_source_valid CHECK (
    (source_type = 'database' AND compression_algorithm IN ('none', 'postgres_custom'))
    OR (source_type IN ('object_storage', 'file', 'file_share')
      AND compression_algorithm IN ('none', 'gzip'))
  ),
  ADD CONSTRAINT backup_execution_uncompressed_size_required CHECK (
    status IN ('running', 'failed')
    OR (source_type IN ('object_storage', 'file', 'file_share')
      AND uncompressed_size_bytes IS NOT NULL)
    OR (source_type = 'database' AND compression_algorithm = 'none'
      AND uncompressed_size_bytes IS NOT NULL)
    OR (source_type = 'database' AND compression_algorithm = 'postgres_custom'
      AND uncompressed_size_bytes IS NULL)
  );

COMMENT ON COLUMN backup.execution_runs.source_id IS
  'Protected source whose approved configuration was used for this execution.';
COMMENT ON COLUMN backup.execution_runs.source_code_snapshot IS
  'Immutable source code used to bind a file-share archive manifest to its source.';
COMMENT ON COLUMN backup.execution_runs.source_location_snapshot IS
  'Immutable relative path under BACKUP_FILE_SOURCE_ROOT used for this file-share run.';
