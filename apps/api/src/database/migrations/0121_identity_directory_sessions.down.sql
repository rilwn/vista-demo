ALTER TABLE identity.session_records
  DROP CONSTRAINT IF EXISTS identity_session_emergency_reason_valid,
  DROP CONSTRAINT IF EXISTS identity_session_auth_method_valid,
  DROP CONSTRAINT IF EXISTS identity_session_auth_provider_valid,
  DROP COLUMN IF EXISTS emergency_access_reason,
  DROP COLUMN IF EXISTS directory_groups,
  DROP COLUMN IF EXISTS auth_method,
  DROP COLUMN IF EXISTS auth_provider;
