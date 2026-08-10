DROP INDEX IF EXISTS inventory.serialized_items_issued_movement_idx;

ALTER TABLE inventory.serialized_items
  DROP CONSTRAINT serialized_item_status_valid,
  DROP COLUMN issued_movement_id,
  ADD CONSTRAINT serialized_item_status_valid CHECK (status IN ('available'));

ALTER TABLE inventory.stock_movements
  DROP CONSTRAINT stock_movement_type_valid,
  ADD CONSTRAINT stock_movement_type_valid CHECK (movement_type IN ('receipt'));
