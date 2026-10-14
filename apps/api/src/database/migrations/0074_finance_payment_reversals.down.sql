DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM finance.payment_reversals)
    OR EXISTS (
      SELECT 1 FROM finance.customer_advance_entries WHERE entry_type = 'reversed'
    ) THEN
    RAISE EXCEPTION
      'Refusing to remove payment reversal history; export and preserve reversal records before rolling back 0074.';
  END IF;
END
$$;

DELETE FROM finance.internal_document_sequences WHERE document_type = 'payment_reversal';

DROP TABLE finance.payment_reversals;
DROP INDEX finance.customer_advance_reversal_source_unique;

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

ALTER TABLE finance.customer_advance_entries
  DROP CONSTRAINT customer_advance_entry_source_valid,
  DROP CONSTRAINT customer_advance_entry_type_valid,
  ADD CONSTRAINT customer_advance_entry_type_valid CHECK (
    entry_type IN ('received', 'applied', 'restored')
  ),
  ADD CONSTRAINT customer_advance_entry_source_valid CHECK (
    (entry_type = 'received' AND pos_sale_id IS NULL AND pos_return_id IS NULL
      AND source_entry_id IS NULL AND customer_document_id IS NULL)
    OR (entry_type = 'applied' AND pos_return_id IS NULL AND source_entry_id IS NULL
      AND num_nonnulls(pos_sale_id, customer_document_id) = 1)
    OR (entry_type = 'restored' AND pos_sale_id IS NOT NULL
      AND pos_return_id IS NOT NULL AND source_entry_id IS NOT NULL
      AND customer_document_id IS NULL)
  );

ALTER TABLE finance.payments DROP COLUMN source_customer_advance_entry_id;
