DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM finance.financial_documents WHERE status = 'issued') THEN
    RAISE EXCEPTION 'Cannot roll back issued financial documents; preserve statutory records.';
  END IF;
END $$;

ALTER TABLE pos.sales DROP COLUMN invoice_financial_document_id;
DROP INDEX finance.finance_financial_document_conversion_unique;
ALTER TABLE finance.financial_documents
  DROP CONSTRAINT finance_document_issue_state_valid,
  DROP CONSTRAINT finance_document_cancellation_valid,
  DROP CONSTRAINT finance_document_status_valid,
  ADD CONSTRAINT finance_document_status_valid CHECK (status IN ('draft', 'cancelled')),
  ADD CONSTRAINT finance_document_cancellation_valid CHECK (
    (status = 'draft' AND cancellation_reason IS NULL AND cancelled_at IS NULL AND cancelled_by IS NULL)
    OR (status = 'cancelled' AND cancellation_reason IS NOT NULL
      AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
  ),
  DROP COLUMN converted_from_document_id,
  DROP COLUMN issued_by,
  DROP COLUMN issued_at;
DROP TABLE finance.official_document_sequences;
