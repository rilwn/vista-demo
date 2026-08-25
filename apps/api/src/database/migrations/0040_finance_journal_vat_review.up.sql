ALTER TABLE procurement.supplier_invoice_lines
  ADD COLUMN vat_treatment varchar(20),
  ADD COLUMN vat_rate numeric(7, 4),
  ADD COLUMN vat_amount numeric(18, 4) GENERATED ALWAYS AS (
    CASE
      WHEN vat_rate IS NULL THEN NULL
      ELSE round(quantity * unit_price * vat_rate / 100, 4)
    END
  ) STORED,
  ADD COLUMN gross_total numeric(18, 4) GENERATED ALWAYS AS (
    quantity * unit_price
      + coalesce(round(quantity * unit_price * vat_rate / 100, 4), 0)
  ) STORED,
  ADD CONSTRAINT supplier_invoice_line_vat_snapshot_complete CHECK (
    (vat_treatment IS NULL AND vat_rate IS NULL)
    OR
    (
      vat_treatment IS NOT NULL AND vat_rate IS NOT NULL
      AND vat_treatment IN ('standard_20', 'reduced_9', 'zero', 'exempt', 'ica')
      AND vat_rate >= 0 AND vat_rate <= 100
      AND (
        (vat_treatment = 'standard_20' AND vat_rate = 20)
        OR (vat_treatment = 'reduced_9' AND vat_rate = 9)
        OR (vat_treatment IN ('zero', 'exempt') AND vat_rate = 0)
        OR vat_treatment = 'ica'
      )
    )
  );

COMMENT ON COLUMN procurement.supplier_invoice_lines.vat_treatment IS
  'Recorded supplier tax treatment. Null identifies historical rows whose VAT breakdown was not captured and must not be presented as deductible VAT.';
COMMENT ON COLUMN procurement.supplier_invoice_lines.vat_amount IS
  'Recorded input-VAT amount calculated from the supplier invoice line snapshot. Deductibility remains subject to FIN-001 approval and Finance review.';

INSERT INTO reporting.report_definitions (
  id, definition_key, name, description, implementation_key, available_formats, filter_schema
) VALUES
  (
    'f3d30223-e14d-4f0c-bc66-57ce06ff55b0',
    'finance.sales-journal',
    'Sales journal review',
    'Recorded Sales financial-document drafts for a selected period. Not an official filed journal.',
    'finance.sales-journal.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"required":["dateFrom","dateTo"],"properties":{"dateFrom":{"type":"string","format":"date"},"dateTo":{"type":"string","format":"date"}}}'::jsonb
  ),
  (
    'b4982925-287e-42af-8b65-7f5020598e1b',
    'finance.purchase-journal',
    'Purchase journal review',
    'Recorded supplier invoices and their captured tax breakdown for a selected period.',
    'finance.purchase-journal.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"required":["dateFrom","dateTo"],"properties":{"dateFrom":{"type":"string","format":"date"},"dateTo":{"type":"string","format":"date"}}}'::jsonb
  ),
  (
    '38a05993-b60f-46c4-a1ed-3f9cb43e9720',
    'finance.vat-review',
    'VAT review',
    'Recorded output and input VAT snapshots with incomplete purchase-tax records identified.',
    'finance.vat-review.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"required":["dateFrom","dateTo"],"properties":{"dateFrom":{"type":"string","format":"date"},"dateTo":{"type":"string","format":"date"}}}'::jsonb
  );
