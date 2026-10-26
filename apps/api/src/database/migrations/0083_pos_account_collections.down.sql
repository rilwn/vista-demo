DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM finance.payments WHERE source_pos_sale_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM finance.customer_account_entries WHERE payment_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot discard posted POS account collections';
  END IF;
END; $$;
DROP TRIGGER finance_pos_allocation_forbidden ON finance.payment_allocations;
DROP TRIGGER finance_pos_reversal_immutable ON finance.payment_reversals;
DROP TRIGGER finance_pos_payment_immutable ON finance.payments;
DROP FUNCTION finance.protect_pos_collection_payment();
DROP TRIGGER finance_pos_reversal_entry ON finance.payment_reversals;
DROP TRIGGER finance_pos_payment_entry ON finance.payments;
DROP FUNCTION finance.require_pos_collection_entry();
DROP TRIGGER customer_account_collection_valid ON finance.customer_account_entries;
DROP FUNCTION finance.validate_pos_account_collection();
DROP INDEX finance.customer_account_entries_sale_idx;
DROP INDEX finance.customer_account_payment_unique;
ALTER TABLE finance.customer_account_entries
  DROP CONSTRAINT customer_account_entry_source_valid,
  DROP CONSTRAINT customer_account_entry_type_valid,
  DROP COLUMN payment_id,
  ADD CONSTRAINT customer_account_entry_type_valid CHECK (entry_type IN ('charge','return_credit')),
  ADD CONSTRAINT customer_account_entry_source_valid CHECK (
    (entry_type='charge' AND pos_sale_id IS NOT NULL AND pos_return_id IS NULL AND source_entry_id IS NULL)
    OR (entry_type='return_credit' AND pos_sale_id IS NOT NULL AND pos_return_id IS NOT NULL AND source_entry_id IS NOT NULL));
ALTER TABLE finance.payments DROP COLUMN source_pos_sale_id;
