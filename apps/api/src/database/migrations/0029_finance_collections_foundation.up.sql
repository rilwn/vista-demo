CREATE SCHEMA IF NOT EXISTS finance;

CREATE TABLE finance.internal_document_sequences (
  document_type varchar(30) PRIMARY KEY,
  next_value bigint NOT NULL DEFAULT 1,
  CONSTRAINT finance_internal_sequence_type_valid CHECK (
    document_type IN ('collection_review', 'payment')
  ),
  CONSTRAINT finance_internal_sequence_positive CHECK (next_value > 0)
);

CREATE TABLE finance.customer_documents (
  id uuid PRIMARY KEY,
  document_number varchar(40) NOT NULL UNIQUE,
  source_sales_invoice_id uuid NOT NULL UNIQUE
    REFERENCES sales.invoices(id) ON DELETE RESTRICT,
  customer_partner_id uuid NOT NULL
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
  review_state varchar(30) NOT NULL DEFAULT 'pending_finance_review',
  cancellation_reason varchar(1000),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_document_dates_valid CHECK (due_date >= document_date),
  CONSTRAINT finance_document_currency_uppercase CHECK (currency_code = upper(currency_code)),
  CONSTRAINT finance_document_bgn_only CHECK (
    currency_code = 'BGN' AND exchange_rate = 1 AND bgn_total = total AND rate_source = 'internal_bgn_review'
  ),
  CONSTRAINT finance_document_amounts_valid CHECK (
    total >= 0 AND allocated_total >= 0 AND allocated_total <= total
    AND outstanding_total = total - allocated_total
  ),
  CONSTRAINT finance_document_payment_status_valid CHECK (
    payment_status IN ('unpaid', 'partially_paid', 'paid', 'overdue', 'cancelled')
  ),
  CONSTRAINT finance_document_review_state_valid CHECK (
    review_state IN ('pending_finance_review', 'cancelled')
  ),
  CONSTRAINT finance_document_cancelled_state_valid CHECK (
    (review_state = 'pending_finance_review' AND cancelled_at IS NULL AND cancelled_by IS NULL
      AND cancellation_reason IS NULL AND payment_status <> 'cancelled')
    OR
    (review_state = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
      AND cancellation_reason IS NOT NULL AND payment_status = 'cancelled'
      AND allocated_total = 0 AND outstanding_total = total)
  ),
  CONSTRAINT finance_document_version_positive CHECK (version > 0)
);

CREATE INDEX finance_customer_documents_register_idx
  ON finance.customer_documents (customer_partner_id, payment_status, due_date, id);
CREATE INDEX finance_customer_documents_due_idx
  ON finance.customer_documents (due_date, id)
  WHERE review_state = 'pending_finance_review' AND outstanding_total > 0;

CREATE TABLE finance.payments (
  id uuid PRIMARY KEY,
  payment_number varchar(40) NOT NULL UNIQUE,
  customer_partner_id uuid NOT NULL
    REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  payment_date date NOT NULL,
  payment_method varchar(30) NOT NULL,
  currency_code char(3) NOT NULL,
  amount numeric(18, 4) NOT NULL,
  payment_reference varchar(255),
  notes varchar(2000),
  recorded_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_payment_method_valid CHECK (
    payment_method IN ('cash', 'bank_transfer', 'pos_terminal', 'card', 'offset')
  ),
  CONSTRAINT finance_payment_currency_uppercase CHECK (currency_code = upper(currency_code)),
  CONSTRAINT finance_payment_bgn_only CHECK (currency_code = 'BGN'),
  CONSTRAINT finance_payment_amount_positive CHECK (amount > 0),
  CONSTRAINT finance_payment_reference_trimmed CHECK (
    payment_reference IS NULL OR (
      payment_reference = btrim(payment_reference) AND char_length(payment_reference) > 0
    )
  ),
  CONSTRAINT finance_payment_notes_trimmed CHECK (
    notes IS NULL OR (notes = btrim(notes) AND char_length(notes) > 0)
  )
);

CREATE INDEX finance_payments_customer_date_idx
  ON finance.payments (customer_partner_id, payment_date DESC, id DESC);

CREATE TABLE finance.payment_allocations (
  id uuid PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES finance.payments(id) ON DELETE RESTRICT,
  customer_document_id uuid NOT NULL
    REFERENCES finance.customer_documents(id) ON DELETE RESTRICT,
  amount numeric(18, 4) NOT NULL,
  allocated_at timestamptz NOT NULL DEFAULT now(),
  allocated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT finance_payment_allocation_unique UNIQUE (payment_id, customer_document_id),
  CONSTRAINT finance_payment_allocation_amount_positive CHECK (amount > 0)
);

CREATE INDEX finance_payment_allocations_document_idx
  ON finance.payment_allocations (customer_document_id, allocated_at DESC, id DESC);

CREATE TABLE finance.payment_status_history (
  id uuid PRIMARY KEY,
  customer_document_id uuid NOT NULL
    REFERENCES finance.customer_documents(id) ON DELETE RESTRICT,
  previous_status varchar(20),
  next_status varchar(20) NOT NULL,
  reason varchar(100) NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT finance_payment_status_history_next_valid CHECK (
    next_status IN ('unpaid', 'partially_paid', 'paid', 'overdue', 'cancelled')
  ),
  CONSTRAINT finance_payment_status_history_previous_valid CHECK (
    previous_status IS NULL OR previous_status IN ('unpaid', 'partially_paid', 'paid', 'overdue', 'cancelled')
  )
);

CREATE INDEX finance_payment_status_history_document_idx
  ON finance.payment_status_history (customer_document_id, changed_at DESC, id DESC);

COMMENT ON TABLE finance.customer_documents IS
  'Internal BGN collection-review records sourced from sales invoice drafts. They are not legal, fiscal, accounting, or BNB-posted invoices.';
COMMENT ON TABLE finance.payments IS
  'Auditable payment evidence. This first finance slice records only BGN allocations to one review document; bank import, advance, offset matching, and legal posting follow in later finance work.';
COMMENT ON TABLE finance.internal_document_sequences IS
  'Internal review and payment references only. Official branch/location/register/operator fiscal numbering remains subject to BUS-002 approval.';
