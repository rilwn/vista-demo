ALTER TABLE identity.authentication_factors
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

ALTER TABLE identity.authentication_factors
  ADD CONSTRAINT authentication_factor_pending_expiry_valid
  CHECK (
    (enabled = true AND verified_at IS NOT NULL AND expires_at IS NULL)
    OR (enabled = false AND verified_at IS NULL)
  );

CREATE INDEX authentication_factors_pending_totp_idx
  ON identity.authentication_factors (account_id, expires_at DESC)
  WHERE factor_type = 'totp' AND enabled = false AND verified_at IS NULL;
