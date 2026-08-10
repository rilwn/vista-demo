ALTER TABLE inventory.serialized_items
  DROP CONSTRAINT serialized_item_status_valid,
  ADD CONSTRAINT serialized_item_status_valid CHECK (status IN ('available', 'issued', 'missing')),
  ADD COLUMN stocktake_movement_id uuid REFERENCES inventory.stock_movements(id) ON DELETE RESTRICT;

CREATE TABLE inventory.stocktake_serial_counts (
  stocktake_count_id uuid NOT NULL REFERENCES inventory.stocktake_counts(id) ON DELETE CASCADE,
  serialized_item_id uuid NOT NULL REFERENCES inventory.serialized_items(id) ON DELETE RESTRICT,
  PRIMARY KEY (stocktake_count_id, serialized_item_id)
);

CREATE TABLE inventory.stocktake_batch_counts (
  stocktake_count_id uuid NOT NULL REFERENCES inventory.stocktake_counts(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES inventory.batches(id) ON DELETE RESTRICT,
  counted_quantity numeric(18, 4) NOT NULL,
  PRIMARY KEY (stocktake_count_id, batch_id),
  CONSTRAINT stocktake_batch_count_nonnegative CHECK (counted_quantity >= 0)
);
