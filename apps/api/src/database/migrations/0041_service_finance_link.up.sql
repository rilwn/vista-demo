ALTER TABLE finance.financial_documents
  ADD COLUMN source_service_work_order_id uuid
    REFERENCES service.work_orders(id) ON DELETE RESTRICT;

ALTER TABLE finance.financial_documents
  ADD CONSTRAINT finance_document_single_operational_source CHECK (
    num_nonnulls(source_sales_invoice_id, source_service_work_order_id) <= 1
  );

CREATE UNIQUE INDEX finance_financial_document_service_source_type_unique
  ON finance.financial_documents (source_service_work_order_id, document_type)
  WHERE source_service_work_order_id IS NOT NULL AND status <> 'cancelled';

CREATE INDEX finance_financial_document_service_source_idx
  ON finance.financial_documents (source_service_work_order_id)
  WHERE source_service_work_order_id IS NOT NULL;

COMMENT ON COLUMN finance.financial_documents.source_service_work_order_id IS
  'Completed Service work order whose calculated charges were used as the immutable basis for this Finance draft.';
