DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM backup.execution_runs
    WHERE source_manifest IS NOT NULL
       OR parent_run_id IS NOT NULL
       OR backup_type IN ('incremental','differential')
  ) THEN
    RAISE EXCEPTION 'Cannot remove file-share backup lineage while backup archive evidence exists';
  END IF;
END;
$$;

DROP INDEX backup.backup_execution_parent_run_idx;

ALTER TABLE backup.execution_runs
  DROP CONSTRAINT backup_execution_source_manifest_object,
  DROP COLUMN source_manifest,
  DROP COLUMN parent_run_id;
