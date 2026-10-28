CREATE TABLE pos.card_authorization_attempts (
  id uuid PRIMARY KEY,
  idempotency_key varchar(200) NOT NULL UNIQUE,
  client_transaction_id uuid NOT NULL,
  -- These identifiers are evidence links, deliberately not foreign keys:
  -- authorization is committed while the sale transaction holds the shift lock.
  shift_id uuid NOT NULL,
  cash_register_id uuid NOT NULL,
  cashier_account_id uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  amount_eur numeric(18, 4) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'authorizing',
  adapter varchar(50) NOT NULL,
  provider_reference varchar(120),
  response_code varchar(64),
  attempt_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT pos_card_authorization_amount_positive CHECK (amount_eur > 0),
  CONSTRAINT pos_card_authorization_status_valid CHECK (
    status IN ('authorizing', 'approved', 'declined', 'uncertain')
  ),
  CONSTRAINT pos_card_authorization_adapter_valid CHECK (
    adapter = btrim(adapter) AND char_length(adapter) BETWEEN 1 AND 50
  ),
  CONSTRAINT pos_card_authorization_reference_valid CHECK (
    provider_reference IS NULL OR
    (provider_reference = btrim(provider_reference) AND char_length(provider_reference) BETWEEN 1 AND 120)
  ),
  CONSTRAINT pos_card_authorization_attempt_count_positive CHECK (attempt_count > 0),
  CONSTRAINT pos_card_authorization_state_valid CHECK (
    (status = 'approved' AND provider_reference IS NOT NULL AND resolved_at IS NOT NULL)
    OR (status = 'declined' AND provider_reference IS NULL AND resolved_at IS NOT NULL)
    OR (status IN ('authorizing', 'uncertain') AND resolved_at IS NULL)
  )
);

CREATE INDEX pos_card_authorization_operator_history_idx
  ON pos.card_authorization_attempts (cashier_account_id, created_at DESC, id DESC);
CREATE INDEX pos_card_authorization_unresolved_idx
  ON pos.card_authorization_attempts (cash_register_id, updated_at, id)
  WHERE status IN ('authorizing', 'uncertain');

CREATE TABLE pos.card_authorization_events (
  id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL
    REFERENCES pos.card_authorization_attempts(id) ON DELETE RESTRICT,
  event_type varchar(40) NOT NULL,
  actor_account_id uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_card_authorization_event_type_valid CHECK (
    event_type IN (
      'authorization_started', 'authorization_approved', 'authorization_declined',
      'authorization_uncertain'
    )
  ),
  CONSTRAINT pos_card_authorization_event_details_object CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX pos_card_authorization_events_attempt_idx
  ON pos.card_authorization_events (attempt_id, occurred_at, id);

CREATE FUNCTION pos.reject_card_authorization_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'POS card authorization events are immutable';
END;
$$;

CREATE TRIGGER pos_card_authorization_events_immutable
  BEFORE UPDATE OR DELETE ON pos.card_authorization_events
  FOR EACH ROW EXECUTE FUNCTION pos.reject_card_authorization_event_mutation();
