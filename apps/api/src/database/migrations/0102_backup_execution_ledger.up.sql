CREATE TABLE backup.execution_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES backup.policies(id) ON DELETE RESTRICT,
  scheduled_for timestamptz NOT NULL,
  idempotency_key varchar(255) NOT NULL UNIQUE,
  backup_type varchar(30) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'running',
  verification_status varchar(20) NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 1,
  verification_attempt_count integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  stored_at timestamptz,
  verified_at timestamptz,
  artifact_key varchar(512),
  artifact_sha256 char(64),
  artifact_size_bytes bigint,
  encryption_nonce char(24),
  encryption_tag char(32),
  error_code varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backup_execution_type_valid CHECK (
    backup_type IN ('database_snapshot', 'full', 'incremental', 'differential', 'system_image')
  ),
  CONSTRAINT backup_execution_status_valid CHECK (
    status IN ('running', 'stored', 'verified', 'failed')
  ),
  CONSTRAINT backup_execution_verification_valid CHECK (
    verification_status IN ('pending', 'running', 'verified', 'failed')
  ),
  CONSTRAINT backup_execution_attempts_positive CHECK (
    attempt_count > 0 AND verification_attempt_count >= 0
  ),
  CONSTRAINT backup_execution_artifact_metadata_complete CHECK (
    status = 'running' OR status = 'failed' OR (
      artifact_key IS NOT NULL AND artifact_sha256 IS NOT NULL
      AND artifact_size_bytes > 0 AND encryption_nonce IS NOT NULL
      AND encryption_tag IS NOT NULL AND stored_at IS NOT NULL
    )
  ),
  CONSTRAINT backup_execution_verified_timestamp CHECK (
    (status = 'verified' AND verification_status = 'verified' AND verified_at IS NOT NULL)
    OR (status <> 'verified' AND verified_at IS NULL)
  )
);

CREATE UNIQUE INDEX backup_execution_policy_slot_idx
  ON backup.execution_runs (policy_id, scheduled_for);

CREATE INDEX backup_execution_history_idx
  ON backup.execution_runs (started_at DESC, id DESC);

CREATE TABLE backup.execution_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES backup.execution_runs(id) ON DELETE RESTRICT,
  event_type varchar(40) NOT NULL,
  attempt_number integer NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT backup_execution_event_type_valid CHECK (
    event_type IN (
      'started', 'stored', 'verification_started', 'verified',
      'execution_failed', 'verification_failed'
    )
  ),
  CONSTRAINT backup_execution_event_attempt_positive CHECK (attempt_number > 0)
);

CREATE INDEX backup_execution_events_run_idx
  ON backup.execution_events (run_id, occurred_at, id);

CREATE FUNCTION backup.prevent_execution_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'backup execution evidence is append-only';
END;
$$;

CREATE TRIGGER backup_execution_events_append_only
BEFORE UPDATE OR DELETE ON backup.execution_events
FOR EACH ROW EXECUTE FUNCTION backup.prevent_execution_event_mutation();

COMMENT ON TABLE backup.execution_runs IS
  'Durable lifecycle and encrypted artifact metadata for automatic database backups.';
COMMENT ON TABLE backup.execution_events IS
  'Append-only evidence for every backup and verification attempt.';
