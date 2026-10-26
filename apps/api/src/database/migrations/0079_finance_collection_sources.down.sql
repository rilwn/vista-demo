-- Older application versions cannot represent a collection without a Sales
-- source. Refuse a destructive downgrade once these records have been used.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM finance.customer_documents WHERE source_sales_invoice_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot downgrade Finance while non-Sales collection records exist';
  END IF;
END;
$$;
ALTER TABLE finance.financial_documents DROP COLUMN official_number_series_id;
DROP TABLE finance.official_number_series;
ALTER TABLE finance.customer_documents
  DROP CONSTRAINT finance_collection_source_required,
  ALTER COLUMN source_sales_invoice_id SET NOT NULL;
