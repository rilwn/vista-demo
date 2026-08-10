ALTER TABLE identity.user_accounts
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT user_accounts_version_positive CHECK (version > 0);

ALTER TABLE iam.roles
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT roles_version_positive CHECK (version > 0);

ALTER TABLE identity.session_records
  ADD COLUMN two_factor_verified boolean NOT NULL DEFAULT false;

CREATE INDEX user_accounts_status_idx
  ON identity.user_accounts (status, updated_at DESC);

CREATE INDEX audit_events_occurred_at_idx
  ON audit.events (occurred_at DESC, id DESC);

COMMENT ON COLUMN identity.session_records.two_factor_verified IS
  'Records whether the second factor was verified when this session was created.';
