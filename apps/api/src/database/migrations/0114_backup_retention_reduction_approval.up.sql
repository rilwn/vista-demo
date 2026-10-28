CREATE TABLE backup.retention_reduction_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_request_id uuid NOT NULL UNIQUE REFERENCES backup.approval_requests(id) ON DELETE RESTRICT,
  policy_id uuid NOT NULL REFERENCES backup.policies(id) ON DELETE RESTRICT,
  target_policy_version integer NOT NULL,
  previous_daily_copies integer NOT NULL,
  previous_monthly_copies integer NOT NULL,
  proposed_daily_copies integer NOT NULL,
  proposed_monthly_copies integer NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backup_retention_reduction_status_valid CHECK (
    status IN ('pending', 'approved', 'rejected', 'expired')
  ),
  CONSTRAINT backup_retention_reduction_version_positive CHECK (target_policy_version > 0),
  CONSTRAINT backup_retention_reduction_values_positive CHECK (
    previous_daily_copies > 0 AND previous_monthly_copies > 0
    AND proposed_daily_copies > 0 AND proposed_monthly_copies > 0
  ),
  CONSTRAINT backup_retention_reduction_only_decreases CHECK (
    proposed_daily_copies <= previous_daily_copies
    AND proposed_monthly_copies <= previous_monthly_copies
    AND (proposed_daily_copies < previous_daily_copies
      OR proposed_monthly_copies < previous_monthly_copies)
  )
);

CREATE UNIQUE INDEX backup_one_pending_retention_reduction_idx
  ON backup.retention_reduction_requests (policy_id)
  WHERE status = 'pending';

CREATE INDEX backup_retention_reduction_history_idx
  ON backup.retention_reduction_requests (created_at DESC, id DESC);

COMMENT ON TABLE backup.retention_reduction_requests IS
  'Version-checked proposals to reduce an active backup policy retention window after independent approval.';
