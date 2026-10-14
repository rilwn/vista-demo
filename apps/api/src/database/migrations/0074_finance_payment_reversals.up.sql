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
      'customer_advance',
      'payment_reversal'
    )
  );

ALTER TABLE finance.payments
  ADD COLUMN source_customer_advance_entry_id uuid
    REFERENCES finance.customer_advance_entries(id) ON DELETE RESTRICT;

ALTER TABLE finance.customer_advance_entries
  DROP CONSTRAINT customer_advance_entry_type_valid,
  DROP CONSTRAINT customer_advance_entry_source_valid,
  ADD CONSTRAINT customer_advance_entry_type_valid CHECK (
    entry_type IN ('received', 'applied', 'restored', 'reversed')
  ),
  ADD CONSTRAINT customer_advance_entry_source_valid CHECK (
    (entry_type = 'received' AND pos_sale_id IS NULL AND pos_return_id IS NULL
      AND source_entry_id IS NULL AND customer_document_id IS NULL)
    OR (entry_type = 'applied' AND pos_return_id IS NULL AND source_entry_id IS NULL
      AND num_nonnulls(pos_sale_id, customer_document_id) = 1)
    OR (entry_type = 'restored' AND pos_sale_id IS NOT NULL
      AND pos_return_id IS NOT NULL AND source_entry_id IS NOT NULL
      AND customer_document_id IS NULL)
    OR (entry_type = 'reversed' AND pos_sale_id IS NULL AND pos_return_id IS NULL
      AND source_entry_id IS NOT NULL AND customer_document_id IS NOT NULL)
  );

CREATE UNIQUE INDEX customer_advance_reversal_source_unique
  ON finance.customer_advance_entries (source_entry_id)
  WHERE entry_type = 'reversed';

CREATE TABLE finance.payment_reversals (
  payment_id uuid PRIMARY KEY REFERENCES finance.payments(id) ON DELETE RESTRICT,
  reversal_number varchar(40) NOT NULL UNIQUE,
  reason varchar(1000) NOT NULL,
  reversed_on date NOT NULL,
  recorded_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_payment_reversal_reason_valid CHECK (
    reason = btrim(reason) AND char_length(reason) BETWEEN 10 AND 1000
  )
);

COMMENT ON TABLE finance.payment_reversals IS
  'Append-only correction record for a full payment reversal. Original payments and allocations remain linked and unchanged.';
