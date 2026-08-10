ALTER TABLE inventory.stock_movements
  DROP CONSTRAINT stock_movement_type_valid,
  ADD CONSTRAINT stock_movement_type_valid CHECK (movement_type IN ('receipt', 'issue', 'transfer_out', 'transfer_in'));

CREATE TABLE inventory.serial_item_transfer_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serialized_item_id uuid NOT NULL REFERENCES inventory.serialized_items(id) ON DELETE RESTRICT,
  transfer_out_movement_id uuid NOT NULL REFERENCES inventory.stock_movements(id) ON DELETE RESTRICT,
  transfer_in_movement_id uuid NOT NULL REFERENCES inventory.stock_movements(id) ON DELETE RESTRICT,
  from_warehouse_id uuid NOT NULL REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  to_warehouse_id uuid NOT NULL REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT serial_transfer_distinct_warehouses CHECK (from_warehouse_id <> to_warehouse_id)
);

CREATE INDEX serial_item_transfer_events_serial_idx
  ON inventory.serial_item_transfer_events (serialized_item_id, created_at, id);
