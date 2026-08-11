CREATE TABLE identity.password_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  password_hash text NOT NULL,
  replaced_at timestamptz NOT NULL DEFAULT now(),
  replaced_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT password_history_hash_not_empty CHECK (length(password_hash) > 0)
);

CREATE INDEX password_history_account_recent_idx
  ON identity.password_history (account_id, replaced_at DESC, id DESC);

COMMENT ON TABLE identity.password_history IS
  'Previous password hashes retained for the configured reuse-prevention window; never exposed through an API.';
