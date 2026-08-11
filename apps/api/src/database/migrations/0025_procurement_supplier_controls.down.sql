DROP TABLE IF EXISTS procurement.supplier_claim_status_history;
DROP TABLE IF EXISTS procurement.supplier_claims;
DROP TABLE IF EXISTS procurement.supplier_invoice_lines;
DROP TABLE IF EXISTS procurement.supplier_invoices;
DROP TABLE IF EXISTS procurement.supplier_evaluations;
DROP TABLE IF EXISTS procurement.supplier_profiles;

ALTER TABLE procurement.goods_receipt_lines
  DROP CONSTRAINT IF EXISTS goods_receipt_lines_identity_unique;
ALTER TABLE procurement.goods_receipts
  DROP CONSTRAINT IF EXISTS goods_receipts_identity_unique;
ALTER TABLE procurement.purchase_order_lines
  DROP CONSTRAINT IF EXISTS purchase_order_lines_id_order_unique;
