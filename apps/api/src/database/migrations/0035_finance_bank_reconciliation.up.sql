ALTER TABLE finance.internal_document_sequences
  DROP CONSTRAINT finance_internal_sequence_type_valid;
ALTER TABLE finance.internal_document_sequences
  ADD CONSTRAINT finance_internal_sequence_type_valid CHECK (
    document_type IN ('collection_review', 'payment', 'bank_statement')
  );

CREATE TABLE finance.bank_statements (
  id uuid PRIMARY KEY,
  statement_number varchar(40) NOT NULL UNIQUE,
  statement_reference varchar(120) NOT NULL,
  bank_name varchar(160) NOT NULL,
  account_iban varchar(34) NOT NULL,
  statement_date date NOT NULL,
  currency_code char(3) NOT NULL,
  opening_balance numeric(18, 4) NOT NULL,
  closing_balance numeric(18, 4) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_bank_statement_source_unique UNIQUE (account_iban, statement_reference),
  CONSTRAINT finance_bank_statement_reference_trimmed CHECK (
    statement_reference = btrim(statement_reference) AND char_length(statement_reference) > 0
  ),
  CONSTRAINT finance_bank_statement_bank_name_trimmed CHECK (
    bank_name = btrim(bank_name) AND char_length(bank_name) > 0
  ),
  CONSTRAINT finance_bank_statement_iban_valid CHECK (
    account_iban = upper(account_iban) AND account_iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'
  ),
  CONSTRAINT finance_bank_statement_bgn_only CHECK (currency_code = 'BGN'),
  CONSTRAINT finance_bank_statement_version_positive CHECK (version > 0)
);

CREATE INDEX finance_bank_statements_date_idx
  ON finance.bank_statements (statement_date DESC, created_at DESC, id DESC);

CREATE TABLE finance.bank_transactions (
  id uuid PRIMARY KEY,
  bank_statement_id uuid NOT NULL
    REFERENCES finance.bank_statements(id) ON DELETE RESTRICT,
  line_number integer NOT NULL,
  transaction_date date NOT NULL,
  value_date date NOT NULL,
  direction varchar(10) NOT NULL,
  amount numeric(18, 4) NOT NULL,
  counterparty_name varchar(255) NOT NULL,
  counterparty_iban varchar(34),
  payment_reference varchar(500) NOT NULL,
  match_status varchar(20) NOT NULL DEFAULT 'unmatched',
  match_method varchar(20),
  matched_customer_document_id uuid
    REFERENCES finance.customer_documents(id) ON DELETE RESTRICT,
  matched_payment_id uuid UNIQUE REFERENCES finance.payments(id) ON DELETE RESTRICT,
  matched_by uuid REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  matched_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_bank_transaction_line_unique UNIQUE (bank_statement_id, line_number),
  CONSTRAINT finance_bank_transaction_line_positive CHECK (line_number > 0),
  CONSTRAINT finance_bank_transaction_dates_valid CHECK (value_date >= transaction_date),
  CONSTRAINT finance_bank_transaction_direction_valid CHECK (
    direction IN ('incoming', 'outgoing')
  ),
  CONSTRAINT finance_bank_transaction_amount_positive CHECK (amount > 0),
  CONSTRAINT finance_bank_transaction_counterparty_trimmed CHECK (
    counterparty_name = btrim(counterparty_name) AND char_length(counterparty_name) > 0
  ),
  CONSTRAINT finance_bank_transaction_iban_valid CHECK (
    counterparty_iban IS NULL OR (
      counterparty_iban = upper(counterparty_iban)
      AND counterparty_iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'
    )
  ),
  CONSTRAINT finance_bank_transaction_reference_trimmed CHECK (
    payment_reference = btrim(payment_reference) AND char_length(payment_reference) > 0
  ),
  CONSTRAINT finance_bank_transaction_match_status_valid CHECK (
    match_status IN ('unmatched', 'matched')
  ),
  CONSTRAINT finance_bank_transaction_match_method_valid CHECK (
    match_method IS NULL OR match_method IN ('automatic_reference', 'manual')
  ),
  CONSTRAINT finance_bank_transaction_match_state_valid CHECK (
    (
      match_status = 'unmatched' AND match_method IS NULL
      AND matched_customer_document_id IS NULL AND matched_payment_id IS NULL
      AND matched_by IS NULL AND matched_at IS NULL
    ) OR (
      match_status = 'matched' AND direction = 'incoming' AND match_method IS NOT NULL
      AND matched_customer_document_id IS NOT NULL AND matched_payment_id IS NOT NULL
      AND matched_at IS NOT NULL
    )
  ),
  CONSTRAINT finance_bank_transaction_version_positive CHECK (version > 0)
);

CREATE INDEX finance_bank_transactions_statement_idx
  ON finance.bank_transactions (bank_statement_id, line_number);
CREATE INDEX finance_bank_transactions_queue_idx
  ON finance.bank_transactions (match_status, transaction_date, id)
  WHERE direction = 'incoming';
CREATE INDEX finance_bank_transactions_document_idx
  ON finance.bank_transactions (matched_customer_document_id)
  WHERE matched_customer_document_id IS NOT NULL;

COMMENT ON TABLE finance.bank_statements IS
  'Auditable BGN bank-statement headers entered manually. Bank-specific import adapters remain disabled until FIN-003 is approved.';
COMMENT ON TABLE finance.bank_transactions IS
  'Immutable statement lines with explicit, retry-safe matching to collection records and generated payment evidence.';
