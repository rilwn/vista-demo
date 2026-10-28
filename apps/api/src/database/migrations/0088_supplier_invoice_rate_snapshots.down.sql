DROP TRIGGER supplier_invoice_rate_snapshot_immutable ON procurement.supplier_invoices;
DROP FUNCTION procurement.prevent_supplier_invoice_rate_rewrite();

ALTER TABLE procurement.supplier_invoices
  DROP CONSTRAINT supplier_invoice_rate_snapshot_valid,
  DROP COLUMN rate_source,
  DROP COLUMN rate_date,
  DROP COLUMN exchange_rate;
