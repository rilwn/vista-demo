ALTER TABLE backup.execution_runs
  ADD COLUMN source_type varchar(30) NOT NULL DEFAULT 'database',
  ADD CONSTRAINT backup_execution_source_type_valid
    CHECK (source_type IN ('database', 'object_storage'));

ALTER TABLE backup.restore_requests
  ADD COLUMN target_storage_bucket varchar(63),
  ADD COLUMN target_storage_prefix varchar(512);

ALTER TABLE backup.restore_requests
  DROP CONSTRAINT backup_restore_completion_valid,
  ADD CONSTRAINT backup_restore_completion_valid CHECK (
    (status = 'completed' AND completed_at IS NOT NULL AND (
      (target_database_name IS NOT NULL AND target_storage_bucket IS NULL
        AND target_storage_prefix IS NULL)
      OR (target_database_name IS NULL AND target_storage_bucket IS NOT NULL
        AND target_storage_prefix IS NOT NULL)
    ))
    OR (status <> 'completed' AND completed_at IS NULL)
  ),
  ADD CONSTRAINT backup_restore_storage_target_pair_valid CHECK (
    (target_storage_bucket IS NULL AND target_storage_prefix IS NULL)
    OR (target_storage_bucket IS NOT NULL AND target_storage_prefix IS NOT NULL
      AND target_storage_prefix ~ '^restores/[a-f0-9]{32}/attempt-[1-9][0-9]*/$')
  );

COMMENT ON COLUMN backup.execution_runs.source_type IS
  'Source adapter used by this immutable run; database or Vista file object storage.';
COMMENT ON COLUMN backup.restore_requests.target_storage_prefix IS
  'Isolated object-store restore namespace; never a live file-store key.';
