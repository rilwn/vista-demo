DROP INDEX IF EXISTS identity.authentication_factors_pending_totp_idx;

ALTER TABLE identity.authentication_factors
  DROP CONSTRAINT IF EXISTS authentication_factor_pending_expiry_valid;

ALTER TABLE identity.authentication_factors
  DROP COLUMN IF EXISTS expires_at;
