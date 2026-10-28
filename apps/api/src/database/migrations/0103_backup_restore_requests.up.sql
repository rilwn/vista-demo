CREATE TABLE backup.restore_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_run_id uuid NOT NULL REFERENCES backup.execution_runs(id) ON DELETE RESTRICT,
  approval_request_id uuid NOT NULL UNIQUE REFERENCES backup.approval_requests(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  requested_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  status varchar(24) NOT NULL DEFAULT 'pending_approval',
  attempt_count integer NOT NULL DEFAULT 0,
  target_database_name varchar(63),
  error_code varchar(80),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backup_restore_status_valid CHECK (
    status IN ('pending_approval', 'approved', 'rejected', 'expired', 'running', 'completed', 'failed')
  ),
  CONSTRAINT backup_restore_attempt_positive CHECK (attempt_count >= 0),
  CONSTRAINT backup_restore_reason_trimmed CHECK (
    reason = btrim(reason) AND char_length(reason) BETWEEN 10 AND 1000
  ),
  CONSTRAINT backup_restore_completion_valid CHECK (
    (status = 'completed' AND completed_at IS NOT NULL AND target_database_name IS NOT NULL)
    OR (status <> 'completed' AND completed_at IS NULL)
  ),
  CONSTRAINT backup_restore_target_name_valid CHECK (
    target_database_name IS NULL OR target_database_name ~ '^vista_restore_[a-f0-9_]+$'
  )
);

CREATE UNIQUE INDEX backup_one_open_restore_per_run_idx
  ON backup.restore_requests (execution_run_id)
  WHERE status IN ('pending_approval', 'approved', 'running');

CREATE TABLE backup.restore_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restore_request_id uuid NOT NULL REFERENCES backup.restore_requests(id) ON DELETE RESTRICT,
  event_type varchar(24) NOT NULL,
  actor_account_id uuid REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT backup_restore_event_type_valid CHECK (
  event_type IN ('requested', 'approved', 'rejected', 'expired', 'started', 'completed', 'failed')
  )
);

CREATE INDEX backup_restore_history_idx
  ON backup.restore_requests (created_at DESC, id DESC);

CREATE INDEX backup_restore_events_history_idx
  ON backup.restore_events (restore_request_id, occurred_at, id);

CREATE FUNCTION backup.prevent_restore_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'backup restore evidence is append-only';
END;
$$;

CREATE TRIGGER backup_restore_events_append_only
BEFORE UPDATE OR DELETE ON backup.restore_events
FOR EACH ROW EXECUTE FUNCTION backup.prevent_restore_event_mutation();

COMMENT ON TABLE backup.restore_requests IS
  'Four-eyes restore requests that restore verified backups only to new, isolated PostgreSQL databases.';
COMMENT ON TABLE backup.restore_events IS
  'Append-only request, approval, and isolated restore lifecycle evidence.';
