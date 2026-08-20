DROP INDEX IF EXISTS finance.finance_bank_transactions_supplier_payable_idx;

ALTER TABLE finance.bank_transactions
  DROP CONSTRAINT IF EXISTS finance_bank_transaction_match_state_valid;
ALTER TABLE finance.bank_transactions
  DROP COLUMN IF EXISTS matched_supplier_payment_id,
  DROP COLUMN IF EXISTS matched_supplier_payable_id;
ALTER TABLE finance.bank_transactions
  ADD CONSTRAINT finance_bank_transaction_match_state_valid CHECK (
    (
      match_status = 'unmatched' AND match_method IS NULL
      AND matched_customer_document_id IS NULL AND matched_payment_id IS NULL
      AND matched_by IS NULL AND matched_at IS NULL
    ) OR (
      match_status = 'matched' AND direction = 'incoming' AND match_method IS NOT NULL
      AND matched_customer_document_id IS NOT NULL AND matched_payment_id IS NOT NULL
      AND matched_at IS NOT NULL
    )
  );

DROP TABLE IF EXISTS finance.supplier_offsets;
DROP TABLE IF EXISTS finance.supplier_payment_status_history;
DROP TABLE IF EXISTS finance.supplier_payment_allocations;
DROP TABLE IF EXISTS finance.supplier_payments;
DROP TABLE IF EXISTS finance.supplier_payables;

ALTER TABLE finance.internal_document_sequences
  DROP CONSTRAINT finance_internal_sequence_type_valid;
ALTER TABLE finance.internal_document_sequences
  ADD CONSTRAINT finance_internal_sequence_type_valid CHECK (
    document_type IN ('collection_review', 'payment', 'bank_statement')
  );
