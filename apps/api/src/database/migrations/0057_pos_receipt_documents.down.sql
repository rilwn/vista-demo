DROP INDEX IF EXISTS finance.finance_financial_document_pos_receipt_idx;
DROP INDEX IF EXISTS finance.finance_financial_document_pos_sale_unique;

ALTER TABLE finance.financial_documents
  DROP CONSTRAINT IF EXISTS finance_document_pos_source_valid,
  DROP COLUMN IF EXISTS source_fiscal_receipt_number,
  DROP COLUMN IF EXISTS source_pos_sale_id;

ALTER TABLE pos.sale_lines
  DROP CONSTRAINT IF EXISTS pos_sale_line_unit_code_valid,
  DROP COLUMN IF EXISTS unit_code;
