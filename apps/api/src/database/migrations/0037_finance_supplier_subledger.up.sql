ALTER TABLE finance.internal_document_sequences
  DROP CONSTRAINT finance_internal_sequence_type_valid;
ALTER TABLE finance.internal_document_sequences
  ADD CONSTRAINT finance_internal_sequence_type_valid CHECK (
    document_type IN (
      'collection_review',
      'payment',
      'bank_statement',
      'supplier_payable',
      'supplier_payment',
      'supplier_advance',
      'supplier_offset'
    )
  );

CREATE TABLE finance.supplier_payables (
  id uuid PRIMARY KEY,
  payable_number varchar(40) NOT NULL UNIQUE,
  source_supplier_invoice_id uuid NOT NULL UNIQUE
    REFERENCES procurement.supplier_invoices(id) ON DELETE RESTRICT,
  supplier_partner_id uuid NOT NULL
    REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  document_date date NOT NULL,
  due_date date NOT NULL,
  currency_code char(3) NOT NULL,
  exchange_rate numeric(18, 8) NOT NULL,
  rate_date date NOT NULL,
  rate_source varchar(40) NOT NULL,
  total numeric(18, 4) NOT NULL,
  allocated_total numeric(18, 4) NOT NULL DEFAULT 0,
  outstanding_total numeric(18, 4) NOT NULL,
  bgn_total numeric(18, 4) NOT NULL,
  payment_status varchar(20) NOT NULL DEFAULT 'unpaid',
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_supplier_payable_dates_valid CHECK (due_date >= document_date),
  CONSTRAINT finance_supplier_payable_bgn_only CHECK (
    currency_code = 'BGN' AND exchange_rate = 1
    AND bgn_total = total AND rate_source = 'internal_bgn_review'
  ),
  CONSTRAINT finance_supplier_payable_amounts_valid CHECK (
    total > 0 AND allocated_total >= 0 AND allocated_total <= total
    AND outstanding_total = total - allocated_total
  ),
  CONSTRAINT finance_supplier_payable_status_valid CHECK (
    payment_status IN ('unpaid', 'partially_paid', 'paid', 'overdue')
  ),
  CONSTRAINT finance_supplier_payable_version_positive CHECK (version > 0)
);

CREATE INDEX finance_supplier_payables_register_idx
  ON finance.supplier_payables (supplier_partner_id, payment_status, due_date, id);
CREATE INDEX finance_supplier_payables_due_idx
  ON finance.supplier_payables (due_date, id)
  WHERE outstanding_total > 0;

CREATE TABLE finance.supplier_payments (
  id uuid PRIMARY KEY,
  payment_number varchar(40) NOT NULL UNIQUE,
  supplier_partner_id uuid NOT NULL
    REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  payment_date date NOT NULL,
  payment_kind varchar(20) NOT NULL,
  payment_method varchar(30) NOT NULL,
  currency_code char(3) NOT NULL,
  amount numeric(18, 4) NOT NULL,
  allocated_total numeric(18, 4) NOT NULL DEFAULT 0,
  available_total numeric(18, 4) NOT NULL,
  payment_reference varchar(255),
  notes varchar(2000),
  source_bank_transaction_id uuid UNIQUE
    REFERENCES finance.bank_transactions(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  recorded_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_supplier_payment_kind_valid CHECK (
    payment_kind IN ('payment', 'advance', 'offset')
  ),
  CONSTRAINT finance_supplier_payment_method_valid CHECK (
    payment_method IN ('cash', 'bank_transfer', 'pos_terminal', 'card', 'offset')
  ),
  CONSTRAINT finance_supplier_payment_bgn_only CHECK (currency_code = 'BGN'),
  CONSTRAINT finance_supplier_payment_amounts_valid CHECK (
    amount > 0 AND allocated_total >= 0 AND allocated_total <= amount
    AND available_total = amount - allocated_total
  ),
  CONSTRAINT finance_supplier_payment_kind_state_valid CHECK (
    (payment_kind = 'advance' AND available_total >= 0)
    OR (payment_kind IN ('payment', 'offset') AND available_total = 0)
  ),
  CONSTRAINT finance_supplier_payment_method_kind_valid CHECK (
    (payment_kind = 'offset' AND payment_method = 'offset')
    OR (payment_kind <> 'offset' AND payment_method <> 'offset')
  ),
  CONSTRAINT finance_supplier_payment_reference_trimmed CHECK (
    payment_reference IS NULL OR (
      payment_reference = btrim(payment_reference) AND char_length(payment_reference) > 0
    )
  ),
  CONSTRAINT finance_supplier_payment_notes_trimmed CHECK (
    notes IS NULL OR (notes = btrim(notes) AND char_length(notes) > 0)
  ),
  CONSTRAINT finance_supplier_payment_version_positive CHECK (version > 0)
);

CREATE INDEX finance_supplier_payments_supplier_date_idx
  ON finance.supplier_payments (supplier_partner_id, payment_date DESC, id DESC);
CREATE INDEX finance_supplier_advances_available_idx
  ON finance.supplier_payments (supplier_partner_id, payment_date, id)
  WHERE payment_kind = 'advance' AND available_total > 0;

CREATE TABLE finance.supplier_payment_allocations (
  id uuid PRIMARY KEY,
  supplier_payment_id uuid NOT NULL
    REFERENCES finance.supplier_payments(id) ON DELETE RESTRICT,
  supplier_payable_id uuid NOT NULL
    REFERENCES finance.supplier_payables(id) ON DELETE RESTRICT,
  amount numeric(18, 4) NOT NULL,
  allocated_at timestamptz NOT NULL DEFAULT now(),
  allocated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT finance_supplier_payment_allocation_unique
    UNIQUE (supplier_payment_id, supplier_payable_id),
  CONSTRAINT finance_supplier_payment_allocation_amount_positive CHECK (amount > 0)
);

CREATE INDEX finance_supplier_payment_allocations_payable_idx
  ON finance.supplier_payment_allocations (supplier_payable_id, allocated_at DESC, id DESC);

CREATE TABLE finance.supplier_payment_status_history (
  id uuid PRIMARY KEY,
  supplier_payable_id uuid NOT NULL
    REFERENCES finance.supplier_payables(id) ON DELETE RESTRICT,
  previous_status varchar(20),
  next_status varchar(20) NOT NULL,
  reason varchar(100) NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT finance_supplier_payment_history_next_valid CHECK (
    next_status IN ('unpaid', 'partially_paid', 'paid', 'overdue')
  ),
  CONSTRAINT finance_supplier_payment_history_previous_valid CHECK (
    previous_status IS NULL OR previous_status IN ('unpaid', 'partially_paid', 'paid', 'overdue')
  )
);

CREATE INDEX finance_supplier_payment_status_history_payable_idx
  ON finance.supplier_payment_status_history (supplier_payable_id, changed_at DESC, id DESC);

CREATE TABLE finance.supplier_offsets (
  id uuid PRIMARY KEY,
  offset_number varchar(40) NOT NULL UNIQUE,
  partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  customer_document_id uuid NOT NULL
    REFERENCES finance.customer_documents(id) ON DELETE RESTRICT,
  supplier_payable_id uuid NOT NULL
    REFERENCES finance.supplier_payables(id) ON DELETE RESTRICT,
  customer_payment_id uuid NOT NULL UNIQUE
    REFERENCES finance.payments(id) ON DELETE RESTRICT,
  supplier_payment_id uuid NOT NULL UNIQUE
    REFERENCES finance.supplier_payments(id) ON DELETE RESTRICT,
  offset_date date NOT NULL,
  amount numeric(18, 4) NOT NULL,
  reason varchar(1000) NOT NULL,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_supplier_offset_amount_positive CHECK (amount > 0),
  CONSTRAINT finance_supplier_offset_reason_trimmed CHECK (
    reason = btrim(reason) AND char_length(reason) > 0
  )
);

CREATE INDEX finance_supplier_offsets_partner_date_idx
  ON finance.supplier_offsets (partner_id, offset_date DESC, id DESC);

ALTER TABLE finance.bank_transactions
  ADD COLUMN matched_supplier_payable_id uuid
    REFERENCES finance.supplier_payables(id) ON DELETE RESTRICT,
  ADD COLUMN matched_supplier_payment_id uuid UNIQUE
    REFERENCES finance.supplier_payments(id) ON DELETE RESTRICT;

ALTER TABLE finance.bank_transactions
  DROP CONSTRAINT finance_bank_transaction_match_state_valid;
ALTER TABLE finance.bank_transactions
  ADD CONSTRAINT finance_bank_transaction_match_state_valid CHECK (
    (
      match_status = 'unmatched' AND match_method IS NULL
      AND matched_customer_document_id IS NULL AND matched_payment_id IS NULL
      AND matched_supplier_payable_id IS NULL AND matched_supplier_payment_id IS NULL
      AND matched_by IS NULL AND matched_at IS NULL
    ) OR (
      match_status = 'matched' AND direction = 'incoming' AND match_method IS NOT NULL
      AND matched_customer_document_id IS NOT NULL AND matched_payment_id IS NOT NULL
      AND matched_supplier_payable_id IS NULL AND matched_supplier_payment_id IS NULL
      AND matched_at IS NOT NULL
    ) OR (
      match_status = 'matched' AND direction = 'outgoing' AND match_method IS NOT NULL
      AND matched_customer_document_id IS NULL AND matched_payment_id IS NULL
      AND matched_supplier_payment_id IS NOT NULL AND matched_at IS NOT NULL
    )
  );

CREATE INDEX finance_bank_transactions_supplier_payable_idx
  ON finance.bank_transactions (matched_supplier_payable_id)
  WHERE matched_supplier_payable_id IS NOT NULL;

COMMENT ON TABLE finance.supplier_payables IS
  'BGN supplier payable review records sourced from procurement invoice evidence. Legal accounting posting and deductible-VAT treatment remain separate approved workflows.';
COMMENT ON TABLE finance.supplier_payments IS
  'Auditable supplier payment evidence. Unallocated advance value remains explicit and can only be consumed by allocation records.';
COMMENT ON TABLE finance.supplier_offsets IS
  'Atomic bilateral compensation records that reduce one customer receivable and one supplier payable for the same partner.';
