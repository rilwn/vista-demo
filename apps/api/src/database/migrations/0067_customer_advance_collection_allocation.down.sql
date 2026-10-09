DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM finance.customer_advance_entries
    WHERE customer_document_id IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM finance.payments
    WHERE source_customer_advance_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot roll back customer advance allocations while Finance allocation records exist.';
  END IF;
END
$$;

DROP INDEX finance.finance_payments_customer_advance_source_idx;
DROP INDEX finance.customer_advance_document_allocation_idx;

ALTER TABLE finance.payments DROP COLUMN source_customer_advance_id;

ALTER TABLE finance.customer_advance_entries
  DROP CONSTRAINT customer_advance_entry_source_valid,
  DROP COLUMN customer_document_id,
  ADD CONSTRAINT customer_advance_entry_source_valid CHECK (
    (entry_type = 'received' AND pos_sale_id IS NULL
      AND pos_return_id IS NULL AND source_entry_id IS NULL)
    OR (entry_type = 'applied' AND pos_sale_id IS NOT NULL
      AND pos_return_id IS NULL AND source_entry_id IS NULL)
    OR (entry_type = 'restored' AND pos_sale_id IS NOT NULL
      AND pos_return_id IS NOT NULL AND source_entry_id IS NOT NULL)
  );
