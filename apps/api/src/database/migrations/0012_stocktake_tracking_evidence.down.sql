DROP TABLE inventory.stocktake_batch_counts;
DROP TABLE inventory.stocktake_serial_counts;

ALTER TABLE inventory.serialized_items
  DROP COLUMN stocktake_movement_id,
  DROP CONSTRAINT serialized_item_status_valid,
  ADD CONSTRAINT serialized_item_status_valid CHECK (status IN ('available', 'issued'));
