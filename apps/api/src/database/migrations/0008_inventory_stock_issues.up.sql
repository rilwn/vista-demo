ALTER TABLE inventory.stock_movements
  DROP CONSTRAINT stock_movement_type_valid,
  ADD CONSTRAINT stock_movement_type_valid CHECK (movement_type IN ('receipt', 'issue'));

ALTER TABLE inventory.serialized_items
  ADD COLUMN issued_movement_id uuid REFERENCES inventory.stock_movements(id) ON DELETE RESTRICT,
  DROP CONSTRAINT serialized_item_status_valid,
  ADD CONSTRAINT serialized_item_status_valid CHECK (status IN ('available', 'issued'));

CREATE INDEX serialized_items_issued_movement_idx
  ON inventory.serialized_items (issued_movement_id)
  WHERE issued_movement_id IS NOT NULL;
