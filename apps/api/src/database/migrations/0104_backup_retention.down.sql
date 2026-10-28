DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM backup.execution_runs WHERE artifact_deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot roll back backup retention evidence after artifacts have expired';
  END IF;
END;
$$;

ALTER TABLE backup.execution_events
  DROP CONSTRAINT backup_execution_event_type_valid;

ALTER TABLE backup.execution_events
  ADD CONSTRAINT backup_execution_event_type_valid CHECK (
    event_type IN (
      'started', 'stored', 'verification_started', 'verified',
      'execution_failed', 'verification_failed'
    )
  );

DROP INDEX backup.backup_execution_retention_candidates_idx;

ALTER TABLE backup.execution_runs
  DROP CONSTRAINT backup_execution_artifact_deletion_valid,
  DROP COLUMN artifact_deleted_reason,
  DROP COLUMN artifact_deleted_at;
