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
      'supplier_offset',
      'customer_advance'
    )
  );

CREATE TABLE sales.customer_payment_terms (
  id uuid PRIMARY KEY,
  customer_partner_id uuid NOT NULL UNIQUE
    REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  on_account_enabled boolean NOT NULL DEFAULT false,
  credit_limit_bgn numeric(18, 4) NOT NULL DEFAULT 0,
  payment_terms_days integer NOT NULL DEFAULT 0,
  valid_from date NOT NULL,
  valid_to date,
  status varchar(20) NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_payment_terms_limit_valid CHECK (
    credit_limit_bgn >= 0
      AND (NOT on_account_enabled OR credit_limit_bgn > 0)
  ),
  CONSTRAINT customer_payment_terms_days_valid CHECK (
    payment_terms_days BETWEEN 0 AND 365
  ),
  CONSTRAINT customer_payment_terms_period_valid CHECK (
    valid_to IS NULL OR valid_to >= valid_from
  ),
  CONSTRAINT customer_payment_terms_status_valid CHECK (
    status IN ('active', 'suspended')
  ),
  CONSTRAINT customer_payment_terms_version_positive CHECK (version > 0)
);

CREATE INDEX customer_payment_terms_active_idx
  ON sales.customer_payment_terms (status, valid_from, valid_to, customer_partner_id);

CREATE TABLE finance.customer_advances (
  id uuid PRIMARY KEY,
  advance_number varchar(40) NOT NULL UNIQUE,
  customer_partner_id uuid NOT NULL
    REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  currency_code char(3) NOT NULL DEFAULT 'BGN',
  amount numeric(18, 4) NOT NULL,
  received_on date NOT NULL,
  payment_method varchar(20) NOT NULL,
  payment_reference varchar(255),
  recorded_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_advance_currency_bgn CHECK (currency_code = 'BGN'),
  CONSTRAINT customer_advance_amount_positive CHECK (amount > 0),
  CONSTRAINT customer_advance_method_valid CHECK (
    payment_method IN ('cash', 'bank_transfer', 'pos_terminal', 'card')
  ),
  CONSTRAINT customer_advance_reference_trimmed CHECK (
    payment_reference IS NULL
      OR (payment_reference = btrim(payment_reference)
        AND char_length(payment_reference) > 0)
  )
);

CREATE INDEX customer_advances_customer_idx
  ON finance.customer_advances (customer_partner_id, received_on DESC, id DESC);

CREATE TABLE finance.customer_advance_entries (
  id uuid PRIMARY KEY,
  advance_id uuid NOT NULL
    REFERENCES finance.customer_advances(id) ON DELETE RESTRICT,
  entry_type varchar(20) NOT NULL,
  amount numeric(18, 4) NOT NULL,
  pos_sale_id uuid REFERENCES pos.sales(id) ON DELETE RESTRICT,
  pos_return_id uuid REFERENCES pos.returns(id) ON DELETE RESTRICT,
  source_entry_id uuid
    REFERENCES finance.customer_advance_entries(id) ON DELETE RESTRICT,
  actor_account_id uuid NOT NULL
    REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  correlation_id varchar(128) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_advance_entry_type_valid CHECK (
    entry_type IN ('received', 'applied', 'restored')
  ),
  CONSTRAINT customer_advance_entry_amount_positive CHECK (amount > 0),
  CONSTRAINT customer_advance_entry_source_valid CHECK (
    (entry_type = 'received' AND pos_sale_id IS NULL
      AND pos_return_id IS NULL AND source_entry_id IS NULL)
    OR (entry_type = 'applied' AND pos_sale_id IS NOT NULL
      AND pos_return_id IS NULL AND source_entry_id IS NULL)
    OR (entry_type = 'restored' AND pos_sale_id IS NOT NULL
      AND pos_return_id IS NOT NULL AND source_entry_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX customer_advance_received_unique
  ON finance.customer_advance_entries (advance_id)
  WHERE entry_type = 'received';
CREATE UNIQUE INDEX customer_advance_sale_application_unique
  ON finance.customer_advance_entries (advance_id, pos_sale_id)
  WHERE entry_type = 'applied';
CREATE UNIQUE INDEX customer_advance_return_restoration_unique
  ON finance.customer_advance_entries (advance_id, pos_return_id)
  WHERE entry_type = 'restored';
CREATE INDEX customer_advance_entries_advance_idx
  ON finance.customer_advance_entries (advance_id, occurred_at, id);

CREATE TABLE finance.customer_account_entries (
  id uuid PRIMARY KEY,
  customer_partner_id uuid NOT NULL
    REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  payment_terms_id uuid NOT NULL
    REFERENCES sales.customer_payment_terms(id) ON DELETE RESTRICT,
  entry_type varchar(20) NOT NULL,
  amount numeric(18, 4) NOT NULL,
  due_on date NOT NULL,
  credit_limit_bgn numeric(18, 4) NOT NULL,
  payment_terms_days integer NOT NULL,
  pos_sale_id uuid REFERENCES pos.sales(id) ON DELETE RESTRICT,
  pos_return_id uuid REFERENCES pos.returns(id) ON DELETE RESTRICT,
  source_entry_id uuid
    REFERENCES finance.customer_account_entries(id) ON DELETE RESTRICT,
  actor_account_id uuid NOT NULL
    REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  correlation_id varchar(128) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_account_entry_type_valid CHECK (
    entry_type IN ('charge', 'return_credit')
  ),
  CONSTRAINT customer_account_entry_amount_positive CHECK (amount > 0),
  CONSTRAINT customer_account_entry_snapshot_valid CHECK (
    credit_limit_bgn > 0 AND payment_terms_days BETWEEN 0 AND 365
  ),
  CONSTRAINT customer_account_entry_source_valid CHECK (
    (entry_type = 'charge' AND pos_sale_id IS NOT NULL
      AND pos_return_id IS NULL AND source_entry_id IS NULL)
    OR (entry_type = 'return_credit' AND pos_sale_id IS NOT NULL
      AND pos_return_id IS NOT NULL AND source_entry_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX customer_account_sale_charge_unique
  ON finance.customer_account_entries (pos_sale_id)
  WHERE entry_type = 'charge';
CREATE UNIQUE INDEX customer_account_return_credit_unique
  ON finance.customer_account_entries (pos_return_id)
  WHERE entry_type = 'return_credit';
CREATE INDEX customer_account_customer_idx
  ON finance.customer_account_entries (customer_partner_id, occurred_at, id);

CREATE FUNCTION finance.reject_customer_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Customer account and advance ledger entries are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER customer_advance_entries_append_only
BEFORE UPDATE OR DELETE ON finance.customer_advance_entries
FOR EACH ROW EXECUTE FUNCTION finance.reject_customer_ledger_mutation();

CREATE TRIGGER customer_account_entries_append_only
BEFORE UPDATE OR DELETE ON finance.customer_account_entries
FOR EACH ROW EXECUTE FUNCTION finance.reject_customer_ledger_mutation();

ALTER TABLE pos.payments
  ADD COLUMN customer_advance_id uuid
    REFERENCES finance.customer_advances(id) ON DELETE RESTRICT,
  ADD COLUMN account_due_on date,
  ADD CONSTRAINT pos_payment_customer_source_valid CHECK (
    (payment_method = 'advance' AND customer_advance_id IS NOT NULL
      AND account_due_on IS NULL)
    OR (payment_method = 'on_account' AND customer_advance_id IS NULL
      AND account_due_on IS NOT NULL)
    OR (payment_method IN ('cash', 'card') AND customer_advance_id IS NULL
      AND account_due_on IS NULL)
  );

ALTER TABLE pos.return_refunds
  ADD COLUMN original_payment_id uuid
    REFERENCES pos.payments(id) ON DELETE RESTRICT;

UPDATE pos.return_refunds refund
SET original_payment_id = (
  SELECT payment.id
  FROM pos.returns pos_return
  JOIN pos.payments payment
    ON payment.sale_id = pos_return.original_sale_id
   AND payment.payment_method = refund.refund_method
  WHERE pos_return.id = refund.return_id
  ORDER BY payment.recorded_at, payment.id
  LIMIT 1
);

ALTER TABLE pos.return_refunds
  ALTER COLUMN original_payment_id SET NOT NULL,
  DROP CONSTRAINT pos_return_refund_method_unique,
  DROP CONSTRAINT pos_return_refund_method_valid,
  DROP CONSTRAINT pos_return_refund_adapter_valid,
  ADD CONSTRAINT pos_return_refund_payment_unique
    UNIQUE (return_id, original_payment_id),
  ADD CONSTRAINT pos_return_refund_method_valid CHECK (
    refund_method IN ('cash', 'card', 'on_account', 'advance')
  ),
  ADD CONSTRAINT pos_return_refund_adapter_valid CHECK (
    (refund_method = 'cash' AND adapter = 'cash-drawer'
      AND status = 'completed' AND provider_reference IS NULL)
    OR (refund_method = 'card'
      AND adapter IN ('development-card-simulator', 'pin-pad')
      AND provider_reference IS NOT NULL)
    OR (refund_method = 'on_account' AND adapter = 'customer-account'
      AND status = 'completed' AND provider_reference IS NULL)
    OR (refund_method = 'advance' AND adapter = 'customer-advance'
      AND status = 'completed' AND provider_reference IS NULL)
  );

COMMENT ON TABLE sales.customer_payment_terms IS
  'Approved, dated customer credit terms used by POS on-account sales.';
COMMENT ON TABLE finance.customer_advance_entries IS
  'Append-only customer-advance ledger; available balances are derived from entries.';
COMMENT ON TABLE finance.customer_account_entries IS
  'Append-only POS customer-account charge and return-credit ledger with terms snapshots.';
COMMENT ON COLUMN pos.return_refunds.original_payment_id IS
  'The exact original payment reversed by this linked return.';
