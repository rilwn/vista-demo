ALTER TABLE backup.execution_runs
  ADD COLUMN independent_copy_status varchar(20) NOT NULL DEFAULT 'not_configured',
  ADD COLUMN independent_copy_target_code varchar(40),
  ADD COLUMN independent_copy_verified_at timestamptz,
  ADD COLUMN independent_copy_error_code varchar(80),
  ADD CONSTRAINT backup_execution_independent_copy_state_valid CHECK (
    (independent_copy_status = 'not_configured'
      AND independent_copy_target_code IS NULL
      AND independent_copy_verified_at IS NULL
      AND independent_copy_error_code IS NULL)
    OR (independent_copy_status IN ('pending', 'running')
      AND independent_copy_target_code IS NOT NULL
      AND independent_copy_verified_at IS NULL
      AND independent_copy_error_code IS NULL)
    OR (independent_copy_status = 'verified'
      AND independent_copy_target_code IS NOT NULL
      AND independent_copy_verified_at IS NOT NULL
      AND independent_copy_error_code IS NULL)
    OR (independent_copy_status = 'failed'
      AND independent_copy_target_code IS NOT NULL
      AND independent_copy_verified_at IS NULL
      AND independent_copy_error_code IS NOT NULL)
  );

ALTER TABLE backup.execution_events
  DROP CONSTRAINT backup_execution_event_type_valid,
  ADD CONSTRAINT backup_execution_event_type_valid CHECK (
    event_type IN (
      'started', 'stored', 'verification_started', 'verified',
      'execution_failed', 'verification_failed', 'retention_expired',
      'independent_copy_started',
      'independent_copy_verified', 'independent_copy_failed'
    )
  );

CREATE INDEX backup_execution_independent_copy_status_idx
  ON backup.execution_runs (independent_copy_status, started_at DESC, id DESC)
  WHERE independent_copy_status <> 'not_configured';

COMMENT ON COLUMN backup.execution_runs.independent_copy_status IS
  'Status of encrypted artifact replication and checksum verification at the separate backup target.';
