ALTER TABLE backup.execution_runs
  ADD COLUMN parent_run_id uuid REFERENCES backup.execution_runs(id) ON DELETE RESTRICT,
  ADD COLUMN source_manifest jsonb;

ALTER TABLE backup.execution_runs
  ADD CONSTRAINT backup_execution_source_manifest_object CHECK (
    source_manifest IS NULL OR jsonb_typeof(source_manifest) = 'object'
  );

CREATE INDEX backup_execution_parent_run_idx
  ON backup.execution_runs (parent_run_id)
  WHERE parent_run_id IS NOT NULL;

COMMENT ON COLUMN backup.execution_runs.parent_run_id IS
  'Verified restore-point dependency for incremental file-share backups; ancestors cannot be removed while descendants remain available.';
COMMENT ON COLUMN backup.execution_runs.source_manifest IS
  'Verified source snapshot manifest used to create and restore mounted-share incremental or differential backups.';
