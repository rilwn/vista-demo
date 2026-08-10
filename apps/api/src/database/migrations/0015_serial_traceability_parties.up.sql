ALTER TABLE inventory.stock_movements
  ADD COLUMN supplier_partner_id uuid REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  ADD COLUMN customer_partner_id uuid REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  ADD COLUMN technician_account_id uuid REFERENCES identity.user_accounts(id) ON DELETE RESTRICT;

CREATE INDEX stock_movements_supplier_idx
  ON inventory.stock_movements (supplier_partner_id, occurred_at)
  WHERE supplier_partner_id IS NOT NULL;
CREATE INDEX stock_movements_customer_idx
  ON inventory.stock_movements (customer_partner_id, occurred_at)
  WHERE customer_partner_id IS NOT NULL;
CREATE INDEX stock_movements_technician_idx
  ON inventory.stock_movements (technician_account_id, occurred_at)
  WHERE technician_account_id IS NOT NULL;
