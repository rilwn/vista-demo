ALTER TABLE backup.execution_runs
  DROP CONSTRAINT backup_execution_artifact_deletion_valid;

ALTER TABLE backup.execution_runs
  ADD CONSTRAINT backup_execution_artifact_deletion_valid CHECK (
    (artifact_deleted_at IS NULL AND artifact_deleted_reason IS NULL)
    OR (
      artifact_deleted_at IS NOT NULL
      AND artifact_deleted_reason IN ('approved_retention_policy', 'approved_restore_point_deletion')
      AND status = 'verified'
      AND artifact_key IS NOT NULL
    )
  );

CREATE TABLE backup.artifact_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_run_id uuid NOT NULL REFERENCES backup.execution_runs(id) ON DELETE RESTRICT,
  approval_request_id uuid NOT NULL UNIQUE REFERENCES backup.approval_requests(id) ON DELETE RESTRICT,
  target_sha256 char(64) NOT NULL,
  reason text NOT NULL,
  requested_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  status varchar(24) NOT NULL DEFAULT 'pending_approval',
  attempt_count integer NOT NULL DEFAULT 0,
  error_code varchar(80),
  lease_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backup_artifact_deletion_status_valid CHECK (
    status IN ('pending_approval', 'approved', 'rejected', 'expired', 'running', 'completed', 'failed')
  ),
  CONSTRAINT backup_artifact_deletion_reason_trimmed CHECK (
    reason = btrim(reason) AND char_length(reason) BETWEEN 10 AND 1000
  ),
  CONSTRAINT backup_artifact_deletion_sha256_valid CHECK (target_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT backup_artifact_deletion_attempt_non_negative CHECK (attempt_count >= 0),
  CONSTRAINT backup_artifact_deletion_lease_valid CHECK (
    (status = 'running' AND lease_expires_at IS NOT NULL)
    OR (status <> 'running' AND lease_expires_at IS NULL)
  ),
  CONSTRAINT backup_artifact_deletion_completion_valid CHECK (
    (status = 'completed' AND completed_at IS NOT NULL)
    OR (status <> 'completed' AND completed_at IS NULL)
  )
);

CREATE UNIQUE INDEX backup_one_open_artifact_deletion_per_run_idx
  ON backup.artifact_deletion_requests (execution_run_id)
  WHERE status IN ('pending_approval', 'approved', 'running');

CREATE INDEX backup_artifact_deletion_history_idx
  ON backup.artifact_deletion_requests (created_at DESC, id DESC);

CREATE TABLE backup.artifact_deletion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES backup.artifact_deletion_requests(id) ON DELETE RESTRICT,
  event_type varchar(24) NOT NULL,
  actor_account_id uuid REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT backup_artifact_deletion_event_type_valid CHECK (
    event_type IN ('requested', 'approved', 'rejected', 'expired', 'started', 'retry_scheduled', 'completed', 'failed')
  )
);

CREATE INDEX backup_artifact_deletion_events_history_idx
  ON backup.artifact_deletion_events (request_id, occurred_at, id);

CREATE FUNCTION backup.prevent_artifact_deletion_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'backup artifact deletion evidence is append-only';
END;
$$;

CREATE TRIGGER backup_artifact_deletion_events_append_only
BEFORE UPDATE OR DELETE ON backup.artifact_deletion_events
FOR EACH ROW EXECUTE FUNCTION backup.prevent_artifact_deletion_event_mutation();

COMMENT ON TABLE backup.artifact_deletion_requests IS
  'Four-eyes requests to permanently remove one verified backup artifact while retaining its immutable run history.';
COMMENT ON TABLE backup.artifact_deletion_events IS
  'Append-only request, approval, and execution evidence for restore-point deletion.';
