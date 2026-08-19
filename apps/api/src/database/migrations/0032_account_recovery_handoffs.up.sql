CREATE TABLE identity.account_recovery_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  issued_by_account_id uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  code_digest char(64) NOT NULL UNIQUE,
  encrypted_code bytea NOT NULL,
  idempotency_key varchar(255) NOT NULL,
  reason varchar(1000) NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  recovery_started_at timestamptz,
  consumed_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT account_recovery_handoff_expiry_valid CHECK (expires_at > issued_at),
  CONSTRAINT account_recovery_handoff_reason_present CHECK (length(btrim(reason)) >= 3),
  CONSTRAINT account_recovery_handoff_consumption_sequence_valid CHECK (
    recovery_started_at IS NULL OR consumed_at IS NULL OR consumed_at >= recovery_started_at
  ),
  CONSTRAINT account_recovery_handoff_idempotency_unique
    UNIQUE (issued_by_account_id, idempotency_key)
);

CREATE INDEX account_recovery_handoffs_account_active_idx
  ON identity.account_recovery_handoffs (account_id, expires_at DESC)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

COMMENT ON TABLE identity.account_recovery_handoffs IS
  'Short-lived, administrator-issued recovery handoffs. Recovery codes are encrypted and hashed; their plaintext value is returned only when issued.';
