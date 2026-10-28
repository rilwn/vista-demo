ALTER TABLE backup.execution_runs
  ADD COLUMN artifact_deleted_at timestamptz,
  ADD COLUMN artifact_deleted_reason varchar(40),
  ADD CONSTRAINT backup_execution_artifact_deletion_valid CHECK (
    (artifact_deleted_at IS NULL AND artifact_deleted_reason IS NULL)
    OR (
      artifact_deleted_at IS NOT NULL
      AND artifact_deleted_reason = 'approved_retention_policy'
      AND status = 'verified'
      AND artifact_key IS NOT NULL
    )
  );

CREATE INDEX backup_execution_retention_candidates_idx
  ON backup.execution_runs (policy_id, scheduled_for DESC, id)
  WHERE status = 'verified' AND verification_status = 'verified'
    AND artifact_deleted_at IS NULL AND artifact_key IS NOT NULL;

ALTER TABLE backup.execution_events
  DROP CONSTRAINT backup_execution_event_type_valid;

ALTER TABLE backup.execution_events
  ADD CONSTRAINT backup_execution_event_type_valid CHECK (
    event_type IN (
      'started', 'stored', 'verification_started', 'verified',
      'execution_failed', 'verification_failed', 'retention_expired'
    )
  );

COMMENT ON COLUMN backup.execution_runs.artifact_deleted_at IS
  'When the stored copy was removed under the second-person-approved retention policy; execution metadata remains.';
