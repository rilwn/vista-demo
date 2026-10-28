DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM backup.execution_runs
    WHERE independent_copy_status <> 'not_configured'
  ) THEN
    RAISE EXCEPTION 'Independent backup-copy evidence exists; preserve it before rollback';
  END IF;
END;
$$;

DROP INDEX backup.backup_execution_independent_copy_status_idx;

ALTER TABLE backup.execution_events
  DROP CONSTRAINT backup_execution_event_type_valid,
  ADD CONSTRAINT backup_execution_event_type_valid CHECK (
    event_type IN (
      'started', 'stored', 'verification_started', 'verified',
      'execution_failed', 'verification_failed', 'retention_expired'
    )
  );

ALTER TABLE backup.execution_runs
  DROP CONSTRAINT backup_execution_independent_copy_state_valid,
  DROP COLUMN independent_copy_error_code,
  DROP COLUMN independent_copy_verified_at,
  DROP COLUMN independent_copy_target_code,
  DROP COLUMN independent_copy_status;
