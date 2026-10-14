ALTER TABLE finance.customer_documents
  ADD COLUMN financial_document_id uuid
    REFERENCES finance.financial_documents(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX finance_customer_document_financial_document_unique
  ON finance.customer_documents (financial_document_id)
  WHERE financial_document_id IS NOT NULL;

COMMENT ON COLUMN finance.customer_documents.financial_document_id IS
  'Issued proforma or converted invoice associated with this collection record.';
