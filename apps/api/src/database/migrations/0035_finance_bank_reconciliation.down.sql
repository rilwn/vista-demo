DROP TABLE IF EXISTS finance.bank_transactions;
DROP TABLE IF EXISTS finance.bank_statements;

ALTER TABLE finance.internal_document_sequences
  DROP CONSTRAINT finance_internal_sequence_type_valid;
ALTER TABLE finance.internal_document_sequences
  ADD CONSTRAINT finance_internal_sequence_type_valid CHECK (
    document_type IN ('collection_review', 'payment')
  );
