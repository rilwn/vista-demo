CREATE TABLE finance.cash_voucher_sequences (
  business_location_id uuid NOT NULL,
  cash_register_id uuid NOT NULL,
  operator_id uuid NOT NULL,
  direction varchar(10) NOT NULL,
  sequence_year integer NOT NULL,
  next_value bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (
    business_location_id,
    cash_register_id,
    operator_id,
    direction,
    sequence_year
  ),
  CONSTRAINT finance_cash_sequence_register_location_fk
    FOREIGN KEY (cash_register_id, business_location_id)
    REFERENCES organization.cash_registers(id, business_location_id) ON DELETE RESTRICT,
  CONSTRAINT finance_cash_sequence_operator_location_fk
    FOREIGN KEY (operator_id, business_location_id)
    REFERENCES organization.operators(id, business_location_id) ON DELETE RESTRICT,
  CONSTRAINT finance_cash_sequence_direction_valid CHECK (
    direction IN ('receipt', 'payment')
  ),
  CONSTRAINT finance_cash_sequence_year_valid CHECK (sequence_year BETWEEN 2000 AND 9999),
  CONSTRAINT finance_cash_sequence_next_positive CHECK (next_value > 0)
);

CREATE TABLE finance.cash_vouchers (
  id uuid PRIMARY KEY,
  voucher_number varchar(80) NOT NULL UNIQUE,
  direction varchar(10) NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'issued',
  business_location_id uuid NOT NULL,
  cash_register_id uuid NOT NULL,
  operator_id uuid NOT NULL,
  voucher_date date NOT NULL,
  currency_code char(3) NOT NULL DEFAULT 'BGN',
  amount numeric(18, 4) NOT NULL,
  counterparty_partner_id uuid REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  counterparty_name varchar(255) NOT NULL,
  customer_document_id uuid
    REFERENCES finance.customer_documents(id) ON DELETE RESTRICT,
  generated_payment_id uuid UNIQUE REFERENCES finance.payments(id) ON DELETE RESTRICT,
  purpose varchar(500) NOT NULL,
  payment_reference varchar(255),
  notes varchar(2000),
  cancellation_reason varchar(1000),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  issued_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_cash_voucher_register_location_fk
    FOREIGN KEY (cash_register_id, business_location_id)
    REFERENCES organization.cash_registers(id, business_location_id) ON DELETE RESTRICT,
  CONSTRAINT finance_cash_voucher_operator_location_fk
    FOREIGN KEY (operator_id, business_location_id)
    REFERENCES organization.operators(id, business_location_id) ON DELETE RESTRICT,
  CONSTRAINT finance_cash_voucher_direction_valid CHECK (
    direction IN ('receipt', 'payment')
  ),
  CONSTRAINT finance_cash_voucher_status_valid CHECK (status IN ('issued', 'cancelled')),
  CONSTRAINT finance_cash_voucher_bgn_only CHECK (currency_code = 'BGN'),
  CONSTRAINT finance_cash_voucher_amount_positive CHECK (amount > 0),
  CONSTRAINT finance_cash_voucher_counterparty_trimmed CHECK (
    counterparty_name = btrim(counterparty_name) AND char_length(counterparty_name) > 0
  ),
  CONSTRAINT finance_cash_voucher_purpose_trimmed CHECK (
    purpose = btrim(purpose) AND char_length(purpose) > 0
  ),
  CONSTRAINT finance_cash_voucher_reference_trimmed CHECK (
    payment_reference IS NULL OR (
      payment_reference = btrim(payment_reference) AND char_length(payment_reference) > 0
    )
  ),
  CONSTRAINT finance_cash_voucher_notes_trimmed CHECK (
    notes IS NULL OR (notes = btrim(notes) AND char_length(notes) > 0)
  ),
  CONSTRAINT finance_cash_voucher_collection_link_valid CHECK (
    (
      customer_document_id IS NULL AND generated_payment_id IS NULL
    ) OR (
      direction = 'receipt' AND counterparty_partner_id IS NOT NULL
      AND customer_document_id IS NOT NULL AND generated_payment_id IS NOT NULL
    )
  ),
  CONSTRAINT finance_cash_voucher_cancellation_valid CHECK (
    (
      status = 'issued' AND cancellation_reason IS NULL
      AND cancelled_at IS NULL AND cancelled_by IS NULL
    ) OR (
      status = 'cancelled' AND cancellation_reason IS NOT NULL
      AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
    )
  ),
  CONSTRAINT finance_cash_voucher_version_positive CHECK (version > 0)
);

CREATE INDEX finance_cash_vouchers_register_date_idx
  ON finance.cash_vouchers (cash_register_id, voucher_date DESC, created_at DESC, id DESC);
CREATE INDEX finance_cash_vouchers_partner_idx
  ON finance.cash_vouchers (counterparty_partner_id, voucher_date DESC, id DESC)
  WHERE counterparty_partner_id IS NOT NULL;
CREATE INDEX finance_cash_vouchers_collection_idx
  ON finance.cash_vouchers (customer_document_id)
  WHERE customer_document_id IS NOT NULL;

COMMENT ON TABLE finance.cash_vouchers IS
  'Auditable BGN cash receipt and payment vouchers scoped to a location, register, and assigned operator. Linked receipts create customer payment allocations transactionally.';
COMMENT ON TABLE finance.cash_voucher_sequences IS
  'Concurrency-safe annual cash-voucher numbering scoped by location, cash register, operator, and direction.';
