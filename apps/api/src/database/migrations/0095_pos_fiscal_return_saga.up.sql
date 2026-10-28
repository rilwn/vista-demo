ALTER TABLE pos.returns
  ADD COLUMN fiscal_document_number varchar(40),
  ADD COLUMN fiscal_reversals_since_daily_report varchar(4),
  ADD CONSTRAINT pos_return_datecs_evidence_valid CHECK (
    (fiscal_adapter = 'datecs-fp2000'
      AND fiscal_document_number IS NOT NULL
      AND fiscal_document_number ~ '^[0-9]{1,10}$'
      AND (fiscal_reversals_since_daily_report IS NULL
        OR fiscal_reversals_since_daily_report ~ '^[0-9]{1,4}$'))
    OR (fiscal_adapter <> 'datecs-fp2000'
      AND fiscal_document_number IS NULL
      AND fiscal_reversals_since_daily_report IS NULL)
  );

CREATE TABLE pos.fiscal_return_preparations (
  id uuid PRIMARY KEY,
  shift_id uuid NOT NULL REFERENCES pos.shifts(id) ON DELETE RESTRICT,
  cash_register_id uuid NOT NULL
    REFERENCES organization.cash_registers(id) ON DELETE RESTRICT,
  operator_id uuid NOT NULL REFERENCES organization.operators(id) ON DELETE RESTRICT,
  cashier_account_id uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  original_sale_id uuid NOT NULL REFERENCES pos.sales(id) ON DELETE RESTRICT,
  device_serial varchar(8) NOT NULL,
  operator_identifier varchar(4) NOT NULL,
  original_unique_sale_id varchar(21) NOT NULL,
  original_fiscal_document_number varchar(10) NOT NULL,
  unique_reversal_id varchar(21) NOT NULL UNIQUE,
  request_digest char(64) NOT NULL,
  request_snapshot jsonb NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'prepared',
  fiscal_document_number varchar(10),
  fiscal_reversals_since_daily_report varchar(4),
  failure_reason varchar(40),
  completed_return_id uuid UNIQUE REFERENCES pos.returns(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_fiscal_return_device_serial_valid CHECK (
    device_serial ~ '^[A-Z0-9]{8}$'
  ),
  CONSTRAINT pos_fiscal_return_operator_identifier_valid CHECK (
    operator_identifier ~ '^[A-Z0-9]{4}$'
  ),
  CONSTRAINT pos_fiscal_return_source_unp_valid CHECK (
    original_unique_sale_id ~ '^[A-Z0-9]{8}-[A-Z0-9]{4}-[0-9]{7}$'
  ),
  CONSTRAINT pos_fiscal_return_unp_valid CHECK (
    unique_reversal_id ~ '^[A-Z0-9]{8}-[A-Z0-9]{4}-[0-9]{7}$'
    AND unique_reversal_id = device_serial || '-' || operator_identifier || '-'
      || substring(unique_reversal_id from 15 for 7)
  ),
  CONSTRAINT pos_fiscal_return_source_document_valid CHECK (
    original_fiscal_document_number ~ '^[0-9]{1,10}$'
  ),
  CONSTRAINT pos_fiscal_return_status_valid CHECK (
    status IN ('prepared', 'printing', 'outcome_unknown', 'rejected', 'cancelled', 'completed')
  ),
  CONSTRAINT pos_fiscal_return_result_lifecycle_valid CHECK (
    (status = 'completed'
      AND fiscal_document_number IS NOT NULL
      AND fiscal_document_number ~ '^[0-9]{1,10}$'
      AND completed_return_id IS NOT NULL
      AND (fiscal_reversals_since_daily_report IS NULL
        OR fiscal_reversals_since_daily_report ~ '^[0-9]{1,4}$')
      AND failure_reason IS NULL)
    OR (status <> 'completed'
      AND fiscal_document_number IS NULL
      AND fiscal_reversals_since_daily_report IS NULL
      AND completed_return_id IS NULL
      AND ((status = 'rejected' AND failure_reason = 'printer_rejected')
        OR (status = 'cancelled' AND failure_reason = 'before_printing')
        OR (status NOT IN ('rejected', 'cancelled') AND failure_reason IS NULL)))
  ),
  CONSTRAINT pos_fiscal_return_request_object_valid CHECK (
    jsonb_typeof(request_snapshot) = 'object'
  )
);

CREATE UNIQUE INDEX pos_fiscal_return_one_unresolved_per_register
  ON pos.fiscal_return_preparations (cash_register_id)
  WHERE status IN ('prepared', 'printing', 'outcome_unknown');
CREATE UNIQUE INDEX pos_fiscal_return_one_unresolved_per_sale
  ON pos.fiscal_return_preparations (original_sale_id)
  WHERE status IN ('prepared', 'printing', 'outcome_unknown');
CREATE INDEX pos_fiscal_return_operator_history_idx
  ON pos.fiscal_return_preparations (cashier_account_id, created_at DESC, id DESC);

COMMENT ON TABLE pos.fiscal_return_preparations IS
  'Durable DATECS full-receipt storno saga. Uncertain printer outcomes block retry until reconciled.';
