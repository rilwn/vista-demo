ALTER TABLE backup.approval_requests
  ADD COLUMN target_version integer,
  ADD CONSTRAINT backup_approval_target_version_positive CHECK (
    target_version IS NULL OR target_version > 0
  );

CREATE UNIQUE INDEX backup_one_pending_disable_job_approval_idx
  ON backup.approval_requests (target_id)
  WHERE critical_action = 'disable_job'
    AND target_type = 'backup_policy'
    AND status = 'pending';

COMMENT ON COLUMN backup.approval_requests.target_version IS
  'Version of the target policy or restore point that the requester reviewed; critical actions reject stale targets.';
