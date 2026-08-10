DROP INDEX inventory.stock_movements_technician_idx;
DROP INDEX inventory.stock_movements_customer_idx;
DROP INDEX inventory.stock_movements_supplier_idx;

ALTER TABLE inventory.stock_movements
  DROP COLUMN technician_account_id,
  DROP COLUMN customer_partner_id,
  DROP COLUMN supplier_partner_id;
