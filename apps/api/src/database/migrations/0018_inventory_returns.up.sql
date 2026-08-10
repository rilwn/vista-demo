ALTER TABLE inventory.stock_movements
  DROP CONSTRAINT stock_movement_type_valid,
  ADD CONSTRAINT stock_movement_type_valid CHECK (
    movement_type IN (
      'receipt', 'issue', 'transfer_out', 'transfer_in',
      'stocktake_in', 'stocktake_out', 'return_in'
    )
  ),
  ADD COLUMN batch_id uuid REFERENCES inventory.batches(id) ON DELETE RESTRICT;

CREATE INDEX stock_movements_batch_idx
  ON inventory.stock_movements (batch_id) WHERE batch_id IS NOT NULL;

CREATE TABLE inventory.stock_returns (
  return_movement_id uuid PRIMARY KEY REFERENCES inventory.stock_movements(id) ON DELETE RESTRICT,
  original_issue_movement_id uuid NOT NULL REFERENCES inventory.stock_movements(id) ON DELETE RESTRICT,
  disposition varchar(20) NOT NULL,
  quantity numeric(18, 4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_return_disposition_valid CHECK (disposition IN ('restock', 'service')),
  CONSTRAINT stock_return_quantity_positive CHECK (quantity > 0),
  CONSTRAINT stock_return_distinct_movements CHECK (return_movement_id <> original_issue_movement_id)
);

CREATE INDEX stock_returns_original_issue_idx
  ON inventory.stock_returns (original_issue_movement_id, created_at, return_movement_id);

CREATE TABLE inventory.serial_item_return_events (
  serialized_item_id uuid NOT NULL REFERENCES inventory.serialized_items(id) ON DELETE RESTRICT,
  original_issue_movement_id uuid NOT NULL REFERENCES inventory.stock_movements(id) ON DELETE RESTRICT,
  return_movement_id uuid NOT NULL REFERENCES inventory.stock_movements(id) ON DELETE RESTRICT,
  destination_warehouse_id uuid NOT NULL REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (serialized_item_id, original_issue_movement_id),
  CONSTRAINT serial_return_movement_unique UNIQUE (serialized_item_id, return_movement_id)
);

CREATE INDEX serial_item_return_events_return_idx
  ON inventory.serial_item_return_events (return_movement_id);

