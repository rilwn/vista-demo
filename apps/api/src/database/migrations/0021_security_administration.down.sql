DROP INDEX IF EXISTS audit.audit_events_occurred_at_idx;
DROP INDEX IF EXISTS identity.user_accounts_status_idx;

ALTER TABLE identity.session_records
  DROP COLUMN IF EXISTS two_factor_verified;

ALTER TABLE iam.roles
  DROP CONSTRAINT IF EXISTS roles_version_positive,
  DROP COLUMN IF EXISTS version;

ALTER TABLE identity.user_accounts
  DROP CONSTRAINT IF EXISTS user_accounts_version_positive,
  DROP COLUMN IF EXISTS version;
