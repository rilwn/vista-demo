ALTER TABLE backup.policies
  DROP CONSTRAINT backup_policy_status_valid;

ALTER TABLE backup.policies
  ADD CONSTRAINT backup_policy_status_valid CHECK (
    status IN ('draft', 'pending_approval', 'approved', 'active', 'paused')
  );

CREATE UNIQUE INDEX backup_one_pending_policy_approval_idx
  ON backup.approval_requests (target_id)
  WHERE critical_action = 'modify_policy'
    AND target_type = 'backup_policy'
    AND status = 'pending';
