ALTER TABLE pos.sale_lines
  ADD COLUMN unit_code varchar(30);

UPDATE pos.sale_lines line
SET unit_code = unit.code
FROM master_data.products product
JOIN master_data.units unit ON unit.id = product.unit_id
WHERE product.id = line.product_id;

ALTER TABLE pos.sale_lines
  ALTER COLUMN unit_code SET NOT NULL,
  ADD CONSTRAINT pos_sale_line_unit_code_valid CHECK (
    unit_code = upper(btrim(unit_code)) AND char_length(unit_code) > 0
  );

ALTER TABLE finance.financial_documents
  ADD COLUMN source_pos_sale_id uuid REFERENCES pos.sales(id) ON DELETE RESTRICT,
  ADD COLUMN source_fiscal_receipt_number varchar(100),
  ADD CONSTRAINT finance_document_pos_source_valid CHECK (
    (source_pos_sale_id IS NULL AND source_fiscal_receipt_number IS NULL)
    OR (source_pos_sale_id IS NOT NULL
      AND source_fiscal_receipt_number IS NOT NULL
      AND document_type = 'invoice')
  );

CREATE UNIQUE INDEX finance_financial_document_pos_sale_unique
  ON finance.financial_documents (source_pos_sale_id)
  WHERE source_pos_sale_id IS NOT NULL AND status <> 'cancelled';

CREATE INDEX finance_financial_document_pos_receipt_idx
  ON finance.financial_documents (source_fiscal_receipt_number)
  WHERE source_fiscal_receipt_number IS NOT NULL;

COMMENT ON COLUMN pos.sale_lines.unit_code IS
  'Unit snapshot retained with the completed sale for later receipt-linked documents.';
COMMENT ON COLUMN finance.financial_documents.source_pos_sale_id IS
  'Bidirectional link from a Finance invoice draft to its source POS sale.';
COMMENT ON COLUMN finance.financial_documents.source_fiscal_receipt_number IS
  'Fiscal receipt reference captured from the source POS sale. Simulator references remain test evidence only.';
