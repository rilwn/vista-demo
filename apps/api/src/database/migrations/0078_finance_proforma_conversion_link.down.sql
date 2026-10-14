DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM finance.customer_documents WHERE financial_document_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot remove financial-document links while collection records use them.';
  END IF;
END;
$$;

DROP INDEX finance.finance_customer_document_financial_document_unique;
ALTER TABLE finance.customer_documents DROP COLUMN financial_document_id;
