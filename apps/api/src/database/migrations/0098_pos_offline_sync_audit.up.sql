CREATE TABLE pos.offline_sync_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  client_event_id uuid NOT NULL,
  client_transaction_id uuid NOT NULL,
  cash_register_id uuid NOT NULL
    REFERENCES organization.cash_registers(id) ON DELETE RESTRICT,
  unique_sale_id varchar(21) NOT NULL
    REFERENCES pos.datecs_unp_leases(unique_sale_id) ON DELETE RESTRICT,
  device_serial varchar(8) NOT NULL,
  operator_identifier varchar(4) NOT NULL,
  event_type varchar(16) NOT NULL,
  reason_code varchar(32) NOT NULL,
  client_occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  audit_event_id uuid NOT NULL UNIQUE REFERENCES audit.events(id) ON DELETE RESTRICT,
  CONSTRAINT pos_offline_sync_event_once UNIQUE (account_id, client_event_id),
  CONSTRAINT pos_offline_sync_event_type_valid CHECK (event_type IN ('retry', 'conflict')),
  CONSTRAINT pos_offline_sync_event_reason_valid CHECK (
    reason_code IN ('receipt_mismatch', 'server_rejected', 'sync_interrupted')
  ),
  CONSTRAINT pos_offline_sync_event_device_valid CHECK (device_serial ~ '^[A-Z0-9]{8}$'),
  CONSTRAINT pos_offline_sync_event_operator_valid CHECK (operator_identifier ~ '^[A-Z0-9]{4}$'),
  CONSTRAINT pos_offline_sync_event_number_valid CHECK (
    unique_sale_id = device_serial || '-' || operator_identifier || '-'
      || substring(unique_sale_id from 15 for 7)
  )
);

CREATE INDEX pos_offline_sync_events_transaction_idx
  ON pos.offline_sync_events (cash_register_id, client_transaction_id, received_at);

CREATE TRIGGER pos_offline_sync_events_append_only
BEFORE UPDATE OR DELETE ON pos.offline_sync_events
FOR EACH ROW EXECUTE FUNCTION audit.reject_event_mutation();

COMMENT ON TABLE pos.offline_sync_events IS
  'Idempotent server receipts of offline POS sync retries and conflicts; sensitive customer/payment data is intentionally excluded.';
