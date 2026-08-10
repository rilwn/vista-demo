ALTER TABLE inventory.stock_movements
  DROP CONSTRAINT stock_movement_type_valid,
  ADD CONSTRAINT stock_movement_type_valid CHECK (movement_type IN ('receipt', 'issue', 'transfer_out', 'transfer_in'));
