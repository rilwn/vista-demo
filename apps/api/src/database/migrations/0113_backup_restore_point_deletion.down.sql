DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM backup.artifact_deletion_requests) THEN
    RAISE EXCEPTION 'Cannot roll back restore-point deletion after deletion request history exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM backup.execution_runs
    WHERE artifact_deleted_reason = 'approved_restore_point_deletion'
  ) THEN
    RAISE EXCEPTION 'Cannot roll back restore-point deletion evidence after an artifact was removed';
  END IF;
END;
$$;

DROP TRIGGER backup_artifact_deletion_events_append_only ON backup.artifact_deletion_events;
DROP FUNCTION backup.prevent_artifact_deletion_event_mutation();
DROP TABLE backup.artifact_deletion_events;
DROP TABLE backup.artifact_deletion_requests;

ALTER TABLE backup.execution_runs
  DROP CONSTRAINT backup_execution_artifact_deletion_valid;

ALTER TABLE backup.execution_runs
  ADD CONSTRAINT backup_execution_artifact_deletion_valid CHECK (
    (artifact_deleted_at IS NULL AND artifact_deleted_reason IS NULL)
    OR (
      artifact_deleted_at IS NOT NULL
      AND artifact_deleted_reason = 'approved_retention_policy'
      AND status = 'verified'
      AND artifact_key IS NOT NULL
    )
  );
