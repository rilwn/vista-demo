DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM backup.execution_runs
    WHERE source_bucket_snapshot IS NOT NULL OR source_identity_snapshot IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot remove object-storage source identity while backup evidence exists';
  END IF;
END;
$$;

DROP TRIGGER backup_object_source_snapshot_immutable ON backup.execution_runs;
DROP FUNCTION backup.prevent_object_source_snapshot_change();
DROP TABLE backup.legacy_managed_object_sources;
ALTER TABLE backup.execution_runs
  DROP CONSTRAINT backup_execution_object_source_identity_valid,
  DROP COLUMN source_identity_snapshot,
  DROP COLUMN source_bucket_snapshot;
