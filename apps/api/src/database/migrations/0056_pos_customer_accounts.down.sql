ALTER TABLE pos.return_refunds
  DROP CONSTRAINT pos_return_refund_adapter_valid,
  DROP CONSTRAINT pos_return_refund_method_valid,
  DROP CONSTRAINT pos_return_refund_payment_unique;

ALTER TABLE pos.return_refunds
  ADD CONSTRAINT pos_return_refund_method_unique UNIQUE (return_id, refund_method),
  ADD CONSTRAINT pos_return_refund_method_valid CHECK (refund_method IN ('cash', 'card')),
  ADD CONSTRAINT pos_return_refund_adapter_valid CHECK (
    (refund_method = 'cash' AND adapter = 'cash-drawer'
      AND status = 'completed' AND provider_reference IS NULL)
    OR (refund_method = 'card'
      AND adapter IN ('development-card-simulator', 'pin-pad')
      AND provider_reference IS NOT NULL)
  );

ALTER TABLE pos.return_refunds DROP COLUMN original_payment_id;

ALTER TABLE pos.payments
  DROP CONSTRAINT pos_payment_customer_source_valid,
  DROP COLUMN account_due_on,
  DROP COLUMN customer_advance_id;

DROP TRIGGER customer_account_entries_append_only ON finance.customer_account_entries;
DROP TRIGGER customer_advance_entries_append_only ON finance.customer_advance_entries;
DROP FUNCTION finance.reject_customer_ledger_mutation();
DROP TABLE finance.customer_account_entries;
DROP TABLE finance.customer_advance_entries;
DROP TABLE finance.customer_advances;
DROP TABLE sales.customer_payment_terms;

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
