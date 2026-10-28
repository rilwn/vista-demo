ALTER TABLE inventory.stock_reservations
  DROP CONSTRAINT stock_reservation_reference_type_valid,
  ADD CONSTRAINT stock_reservation_reference_type_valid CHECK (
    reference_type IN ('sales_order', 'quotation', 'service_request', 'pos_fiscal_preparation')
  );

ALTER TABLE inventory.batch_stock_balances
  ADD COLUMN reserved_quantity numeric(18, 4) NOT NULL DEFAULT 0,
  ADD CONSTRAINT batch_stock_reserved_quantity_valid CHECK (
    reserved_quantity >= 0 AND reserved_quantity <= quantity
  );

CREATE TABLE pos.fiscal_sale_preparations (
  id uuid PRIMARY KEY,
  client_transaction_id uuid NOT NULL UNIQUE,
  shift_id uuid NOT NULL REFERENCES pos.shifts(id) ON DELETE RESTRICT,
  cash_register_id uuid NOT NULL
    REFERENCES organization.cash_registers(id) ON DELETE RESTRICT,
  operator_id uuid NOT NULL REFERENCES organization.operators(id) ON DELETE RESTRICT,
  cashier_account_id uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  device_serial varchar(8) NOT NULL,
  operator_identifier varchar(4) NOT NULL,
  unique_sale_id varchar(21) NOT NULL UNIQUE,
  request_digest char(64) NOT NULL,
  request_snapshot jsonb NOT NULL,
  pricing_snapshot jsonb NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'prepared',
  fiscal_document_number varchar(40),
  fiscal_receipt_number varchar(100),
  fiscal_response jsonb,
  printer_cancellation_confirmed boolean NOT NULL DEFAULT false,
  finalized_sale_id uuid UNIQUE REFERENCES pos.sales(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_fiscal_preparation_device_serial_valid CHECK (
    device_serial ~ '^[A-Z0-9]{8}$'
  ),
  CONSTRAINT pos_fiscal_preparation_operator_identifier_valid CHECK (
    operator_identifier ~ '^[A-Z0-9]{4}$'
  ),
  CONSTRAINT pos_fiscal_preparation_unp_valid CHECK (
    unique_sale_id ~ '^[A-Z0-9]{8}-[A-Z0-9]{4}-[0-9]{7}$'
    AND unique_sale_id = device_serial || '-' || operator_identifier || '-' ||
      substring(unique_sale_id from 15 for 7)
  ),
  CONSTRAINT pos_fiscal_preparation_status_valid CHECK (
    status IN ('prepared', 'printing', 'outcome_unknown', 'receipt_confirmed', 'finalized', 'cancelled')
  ),
  CONSTRAINT pos_fiscal_preparation_receipt_lifecycle_valid CHECK (
    (status IN ('receipt_confirmed', 'finalized')
      AND fiscal_document_number IS NOT NULL
      AND fiscal_receipt_number IS NOT NULL
      AND fiscal_response IS NOT NULL)
    OR (status NOT IN ('receipt_confirmed', 'finalized')
      AND fiscal_document_number IS NULL
      AND fiscal_receipt_number IS NULL
      AND fiscal_response IS NULL)
  ),
  CONSTRAINT pos_fiscal_preparation_sale_lifecycle_valid CHECK (
    (status = 'finalized' AND finalized_sale_id IS NOT NULL)
    OR (status <> 'finalized' AND finalized_sale_id IS NULL)
  ),
  CONSTRAINT pos_fiscal_preparation_snapshot_object_valid CHECK (
    jsonb_typeof(request_snapshot) = 'object'
    AND jsonb_typeof(pricing_snapshot) = 'object'
  )
);

CREATE UNIQUE INDEX pos_fiscal_preparation_one_unresolved_per_register
  ON pos.fiscal_sale_preparations (cash_register_id)
  WHERE status IN ('prepared', 'printing', 'outcome_unknown', 'receipt_confirmed');
CREATE INDEX pos_fiscal_preparation_operator_history_idx
  ON pos.fiscal_sale_preparations (cashier_account_id, created_at DESC, id DESC);

CREATE TABLE pos.datecs_unp_sequences (
  device_serial varchar(8) NOT NULL,
  operator_identifier varchar(4) NOT NULL,
  next_value integer NOT NULL DEFAULT 1,
  PRIMARY KEY (device_serial, operator_identifier),
  CONSTRAINT datecs_unp_serial_valid CHECK (device_serial ~ '^[A-Z0-9]{8}$'),
  CONSTRAINT datecs_unp_operator_valid CHECK (operator_identifier ~ '^[A-Z0-9]{4}$'),
  CONSTRAINT datecs_unp_sequence_valid CHECK (next_value BETWEEN 1 AND 10000000)
);

ALTER TABLE pos.discount_authorizations
  ADD COLUMN reserved_by_fiscal_preparation_id uuid
    REFERENCES pos.fiscal_sale_preparations(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX pos_discount_authorization_fiscal_hold_unique
  ON pos.discount_authorizations (reserved_by_fiscal_preparation_id)
  WHERE reserved_by_fiscal_preparation_id IS NOT NULL;

CREATE TABLE pos.fiscal_preparation_loyalty_reservations (
  fiscal_preparation_id uuid PRIMARY KEY
    REFERENCES pos.fiscal_sale_preparations(id) ON DELETE RESTRICT,
  loyalty_account_id uuid NOT NULL REFERENCES pos.loyalty_accounts(id) ON DELETE RESTRICT,
  points integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CONSTRAINT fiscal_preparation_loyalty_points_valid CHECK (points > 0),
  CONSTRAINT fiscal_preparation_loyalty_lifecycle_valid CHECK (
    (active AND ended_at IS NULL) OR (NOT active AND ended_at IS NOT NULL)
  )
);

CREATE INDEX pos_fiscal_loyalty_reservation_active_idx
  ON pos.fiscal_preparation_loyalty_reservations (loyalty_account_id)
  WHERE active;

COMMENT ON TABLE pos.fiscal_sale_preparations IS
  'Durable online DATECS sale saga. Reservations survive browser interruptions; only confirmed fiscal receipts may be finalized.';


