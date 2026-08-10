DROP VIEW inventory.stock_replenishment_status;
DROP TABLE inventory.stock_settings;

ALTER TABLE inventory.stock_balances
  DROP CONSTRAINT stock_balance_average_cost_nonnegative,
  DROP COLUMN average_unit_cost_bgn;

ALTER TABLE inventory.stock_movements
  DROP CONSTRAINT stock_movement_unit_cost_nonnegative,
  DROP COLUMN total_cost_bgn,
  DROP COLUMN unit_cost_bgn;
