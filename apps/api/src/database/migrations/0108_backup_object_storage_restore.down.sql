DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM backup.execution_runs WHERE source_type <> 'database')
    OR EXISTS (SELECT 1 FROM backup.restore_requests WHERE target_storage_prefix IS NOT NULL)
  THEN
    RAISE EXCEPTION 'Object-storage backup or restore evidence exists; preserve it before rollback';
  END IF;
END;
$$;

ALTER TABLE backup.restore_requests
  DROP CONSTRAINT backup_restore_storage_target_pair_valid,
  DROP CONSTRAINT backup_restore_completion_valid,
  ADD CONSTRAINT backup_restore_completion_valid CHECK (
    (status = 'completed' AND completed_at IS NOT NULL AND target_database_name IS NOT NULL)
    OR (status <> 'completed' AND completed_at IS NULL)
  ),
  DROP COLUMN target_storage_prefix,
  DROP COLUMN target_storage_bucket;

ALTER TABLE backup.execution_runs
  DROP CONSTRAINT backup_execution_source_type_valid,
  DROP COLUMN source_type;
