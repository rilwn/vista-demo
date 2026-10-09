ALTER TABLE finance.customer_advance_entries
  ADD COLUMN customer_document_id uuid
    REFERENCES finance.customer_documents(id) ON DELETE RESTRICT;

ALTER TABLE finance.customer_advance_entries
  DROP CONSTRAINT customer_advance_entry_source_valid,
  ADD CONSTRAINT customer_advance_entry_source_valid CHECK (
    (entry_type = 'received' AND pos_sale_id IS NULL AND pos_return_id IS NULL
      AND source_entry_id IS NULL AND customer_document_id IS NULL)
    OR (entry_type = 'applied' AND pos_return_id IS NULL AND source_entry_id IS NULL
      AND num_nonnulls(pos_sale_id, customer_document_id) = 1)
    OR (entry_type = 'restored' AND pos_sale_id IS NOT NULL
      AND pos_return_id IS NOT NULL AND source_entry_id IS NOT NULL
      AND customer_document_id IS NULL)
  );

ALTER TABLE finance.payments
  ADD COLUMN source_customer_advance_id uuid
    REFERENCES finance.customer_advances(id) ON DELETE RESTRICT;

CREATE INDEX customer_advance_document_allocation_idx
  ON finance.customer_advance_entries (advance_id, customer_document_id, occurred_at, id)
  WHERE entry_type = 'applied' AND customer_document_id IS NOT NULL;

CREATE INDEX finance_payments_customer_advance_source_idx
  ON finance.payments (source_customer_advance_id)
  WHERE source_customer_advance_id IS NOT NULL;

COMMENT ON COLUMN finance.customer_advance_entries.customer_document_id IS
  'Open Finance collection record that consumed this append-only advance allocation.';
COMMENT ON COLUMN finance.payments.source_customer_advance_id IS
  'Customer advance used as the source of this payment allocation.';
