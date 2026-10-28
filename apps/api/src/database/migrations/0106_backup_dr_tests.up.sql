CREATE TABLE backup.dr_test_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_code varchar(40) NOT NULL UNIQUE,
  backup_run_id uuid NOT NULL REFERENCES backup.execution_runs(id) ON DELETE RESTRICT,
  planned_for timestamptz NOT NULL,
  scope text NOT NULL,
  rpo_target_minutes integer NOT NULL,
  rto_target_minutes integer NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'planned',
  restore_request_id uuid REFERENCES backup.restore_requests(id) ON DELETE RESTRICT,
  outcome varchar(12),
  actual_rpo_minutes integer,
  actual_rto_minutes integer,
  result_summary text,
  non_conformities text NOT NULL DEFAULT '',
  corrective_actions text NOT NULL DEFAULT '',
  evidence_file_id uuid REFERENCES files.objects(id) ON DELETE RESTRICT,
  protocol_signed_by varchar(180),
  protocol_signed_at timestamptz,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  completed_by uuid REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT backup_dr_test_status_valid CHECK (status IN ('planned', 'recorded')),
  CONSTRAINT backup_dr_test_outcome_valid CHECK (outcome IS NULL OR outcome IN ('passed', 'failed')),
  CONSTRAINT backup_dr_test_targets_positive CHECK (
    rpo_target_minutes > 0 AND rto_target_minutes > 0
  ),
  CONSTRAINT backup_dr_test_actuals_nonnegative CHECK (
    (actual_rpo_minutes IS NULL OR actual_rpo_minutes >= 0)
    AND (actual_rto_minutes IS NULL OR actual_rto_minutes >= 0)
  ),
  CONSTRAINT backup_dr_test_scope_trimmed CHECK (
    scope = btrim(scope) AND char_length(scope) BETWEEN 10 AND 2000
  ),
  CONSTRAINT backup_dr_test_record_complete CHECK (
    (status = 'planned' AND restore_request_id IS NULL AND outcome IS NULL
      AND actual_rpo_minutes IS NULL AND actual_rto_minutes IS NULL
      AND result_summary IS NULL AND evidence_file_id IS NULL
      AND protocol_signed_by IS NULL AND protocol_signed_at IS NULL
      AND completed_by IS NULL AND completed_at IS NULL)
    OR (status = 'recorded' AND restore_request_id IS NOT NULL AND outcome IS NOT NULL
      AND actual_rpo_minutes IS NOT NULL AND actual_rto_minutes IS NOT NULL
      AND result_summary IS NOT NULL AND char_length(btrim(result_summary)) >= 10
      AND evidence_file_id IS NOT NULL AND protocol_signed_by IS NOT NULL
      AND protocol_signed_at IS NOT NULL AND completed_by IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CONSTRAINT backup_dr_test_failure_actions_required CHECK (
    status <> 'recorded' OR outcome <> 'failed'
    OR char_length(btrim(corrective_actions)) >= 10
  )
);

CREATE UNIQUE INDEX backup_dr_test_open_run_idx
  ON backup.dr_test_records (backup_run_id) WHERE status = 'planned';

CREATE INDEX backup_dr_test_history_idx
  ON backup.dr_test_records (planned_for DESC, id DESC);

CREATE TABLE backup.dr_test_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dr_test_id uuid NOT NULL REFERENCES backup.dr_test_records(id) ON DELETE RESTRICT,
  event_type varchar(24) NOT NULL,
  actor_account_id uuid REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT backup_dr_test_event_type_valid CHECK (
    event_type IN ('planned', 'result_recorded')
  )
);

CREATE INDEX backup_dr_test_events_idx
  ON backup.dr_test_events (dr_test_id, occurred_at, id);

CREATE FUNCTION backup.prevent_dr_test_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'disaster-recovery test evidence is append-only';
END;
$$;

CREATE TRIGGER backup_dr_test_events_append_only
BEFORE UPDATE OR DELETE ON backup.dr_test_events
FOR EACH ROW EXECUTE FUNCTION backup.prevent_dr_test_event_mutation();

CREATE FUNCTION backup.prevent_recorded_dr_test_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'recorded' THEN
    RAISE EXCEPTION 'recorded disaster-recovery test evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER backup_dr_test_records_immutable
BEFORE UPDATE OR DELETE ON backup.dr_test_records
FOR EACH ROW EXECUTE FUNCTION backup.prevent_recorded_dr_test_mutation();

COMMENT ON TABLE backup.dr_test_records IS
  'Planned and evidenced isolated PostgreSQL disaster-recovery exercises with signed protocol references.';
COMMENT ON TABLE backup.dr_test_events IS
  'Append-only plan and signed-result evidence for disaster-recovery exercises.';
