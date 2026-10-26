DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM finance.pos_account_return_credits) OR EXISTS(SELECT 1 FROM finance.pos_account_refunds)
    OR EXISTS(SELECT 1 FROM finance.financial_documents WHERE source_pos_return_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot discard linked POS returns, credit notes or refunds';
  END IF;
END; $$;
DROP TRIGGER pos_account_refund_allocations_complete ON finance.pos_account_refunds;
DROP FUNCTION finance.require_pos_refund_allocations();
DROP TRIGGER pos_account_refund_allocation_valid ON finance.pos_account_refund_allocations;
DROP FUNCTION finance.validate_pos_refund_allocation();
DROP TRIGGER pos_account_refund_valid ON finance.pos_account_refunds;
DROP FUNCTION finance.validate_pos_account_refund();
DROP TRIGGER financial_document_pos_return_valid ON finance.financial_documents;
DROP FUNCTION finance.validate_pos_return_document();
DROP TRIGGER finance_returned_pos_payment_reversal ON finance.payment_reversals;
DROP FUNCTION finance.prevent_returned_payment_reversal();
DROP TRIGGER pos_account_return_credit_valid ON finance.pos_account_return_credits;
DROP FUNCTION finance.validate_pos_return_credit();
DROP TABLE finance.pos_account_refund_allocations;
DROP TABLE finance.pos_account_refunds;
DROP TABLE finance.pos_account_return_credits;
DROP FUNCTION finance.protect_pos_refund_evidence();
ALTER TABLE finance.financial_documents DROP COLUMN source_pos_return_id;
DELETE FROM finance.internal_document_sequences WHERE document_type='pos_account_refund';
ALTER TABLE finance.internal_document_sequences DROP CONSTRAINT finance_internal_sequence_type_valid;
ALTER TABLE finance.internal_document_sequences ADD CONSTRAINT finance_internal_sequence_type_valid CHECK(
  document_type IN ('collection_review','payment','bank_statement','supplier_payable','supplier_payment',
    'supplier_advance','supplier_offset','customer_advance','payment_reversal'));
