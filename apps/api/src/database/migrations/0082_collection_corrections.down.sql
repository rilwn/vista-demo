DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM finance.collection_corrections) OR
    EXISTS(SELECT 1 FROM finance.customer_documents WHERE credit_total<>0 OR debit_total<>0 OR overpaid_total<>0) THEN
    RAISE EXCEPTION 'Cannot downgrade collection corrections while issued adjustments or customer credit exist';
  END IF;
END $$;
DROP FUNCTION finance.refresh_collection_corrections(uuid,uuid,text,date);
DROP TABLE finance.collection_corrections;
DROP FUNCTION finance.validate_collection_correction();
DROP FUNCTION finance.protect_collection_correction();
ALTER TABLE finance.customer_documents DROP CONSTRAINT finance_document_amounts_valid;
ALTER TABLE finance.customer_documents DROP COLUMN overpaid_total, DROP COLUMN adjusted_total,
  DROP COLUMN credit_total,DROP COLUMN debit_total;
ALTER TABLE finance.customer_documents ADD CONSTRAINT finance_document_amounts_valid CHECK(
  total>=0 AND allocated_total>=0 AND allocated_total<=total AND outstanding_total=total-allocated_total
);
