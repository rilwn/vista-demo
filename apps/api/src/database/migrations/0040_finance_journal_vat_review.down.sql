DELETE FROM reporting.export_jobs
WHERE report_definition_id IN (
  'f3d30223-e14d-4f0c-bc66-57ce06ff55b0',
  'b4982925-287e-42af-8b65-7f5020598e1b',
  '38a05993-b60f-46c4-a1ed-3f9cb43e9720'
);

DELETE FROM reporting.report_definitions
WHERE id IN (
  'f3d30223-e14d-4f0c-bc66-57ce06ff55b0',
  'b4982925-287e-42af-8b65-7f5020598e1b',
  '38a05993-b60f-46c4-a1ed-3f9cb43e9720'
);

ALTER TABLE procurement.supplier_invoice_lines
  DROP CONSTRAINT supplier_invoice_line_vat_snapshot_complete,
  DROP COLUMN gross_total,
  DROP COLUMN vat_amount,
  DROP COLUMN vat_rate,
  DROP COLUMN vat_treatment;
