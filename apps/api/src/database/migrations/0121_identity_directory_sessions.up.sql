ALTER TABLE identity.session_records
  ADD COLUMN auth_provider text NOT NULL DEFAULT 'local',
  ADD COLUMN auth_method text NOT NULL DEFAULT 'password',
  ADD COLUMN directory_groups text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN emergency_access_reason text;

ALTER TABLE identity.session_records
  ADD CONSTRAINT identity_session_auth_provider_valid
    CHECK (auth_provider IN ('local', 'ldap', 'oidc', 'saml')),
  ADD CONSTRAINT identity_session_auth_method_valid
    CHECK (auth_method IN ('password', 'directory_password', 'oidc', 'saml', 'emergency_password')),
  ADD CONSTRAINT identity_session_emergency_reason_valid
    CHECK (emergency_access_reason IS NULL OR length(btrim(emergency_access_reason)) BETWEEN 8 AND 500);

COMMENT ON COLUMN identity.session_records.directory_groups IS
  'External group identifiers captured at sign-in; mapped to existing Vista roles at authorization time.';
