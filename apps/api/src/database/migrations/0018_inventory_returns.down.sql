DROP TABLE IF EXISTS inventory.serial_item_return_events;
DROP TABLE IF EXISTS inventory.stock_returns;

DROP INDEX IF EXISTS inventory.stock_movements_batch_idx;

ALTER TABLE inventory.stock_movements
  DROP COLUMN batch_id,
  DROP CONSTRAINT stock_movement_type_valid,
  ADD CONSTRAINT stock_movement_type_valid CHECK (
    movement_type IN (
      'receipt', 'issue', 'transfer_out', 'transfer_in',
      'stocktake_in', 'stocktake_out'
    )
  );
