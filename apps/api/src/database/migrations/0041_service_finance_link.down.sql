DROP INDEX IF EXISTS finance.finance_financial_document_service_source_idx;
DROP INDEX IF EXISTS finance.finance_financial_document_service_source_type_unique;

ALTER TABLE finance.financial_documents
  DROP CONSTRAINT IF EXISTS finance_document_single_operational_source;

ALTER TABLE finance.financial_documents
  DROP COLUMN IF EXISTS source_service_work_order_id;
