DROP INDEX backup.backup_one_pending_disable_job_approval_idx;
ALTER TABLE backup.approval_requests
  DROP CONSTRAINT backup_approval_target_version_positive,
  DROP COLUMN target_version;
