DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM backup.policies WHERE status IN ('pending_approval', 'approved')
  ) THEN
    RAISE EXCEPTION 'Backup policy approval rollback is blocked while approval states exist';
  END IF;
END;
$$;

DROP INDEX backup_one_pending_policy_approval_idx;

ALTER TABLE backup.policies
  DROP CONSTRAINT backup_policy_status_valid;

ALTER TABLE backup.policies
  ADD CONSTRAINT backup_policy_status_valid CHECK (
    status IN ('draft', 'active', 'paused')
  );
