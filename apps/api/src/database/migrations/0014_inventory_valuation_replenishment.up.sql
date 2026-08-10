ALTER TABLE inventory.stock_movements
  ADD COLUMN unit_cost_bgn numeric(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN total_cost_bgn numeric(18, 4) GENERATED ALWAYS AS (round(quantity * unit_cost_bgn, 4)) STORED,
  ADD CONSTRAINT stock_movement_unit_cost_nonnegative CHECK (unit_cost_bgn >= 0);

ALTER TABLE inventory.stock_balances
  ADD COLUMN average_unit_cost_bgn numeric(18, 4) NOT NULL DEFAULT 0,
  ADD CONSTRAINT stock_balance_average_cost_nonnegative CHECK (average_unit_cost_bgn >= 0);

CREATE TABLE inventory.stock_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES master_data.products(id) ON DELETE RESTRICT,
  minimum_quantity numeric(18, 4) NOT NULL DEFAULT 0,
  target_quantity numeric(18, 4) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_settings_warehouse_product_unique UNIQUE (warehouse_id, product_id),
  CONSTRAINT stock_settings_quantities_valid CHECK (
    minimum_quantity >= 0 AND target_quantity >= minimum_quantity
  ),
  CONSTRAINT stock_settings_version_positive CHECK (version > 0)
);

CREATE VIEW inventory.stock_replenishment_status AS
WITH reserved AS (
  SELECT warehouse_id, product_id, sum(remaining_quantity) AS quantity
  FROM inventory.stock_reservations
  WHERE status = 'active'
  GROUP BY warehouse_id, product_id
), status AS (
  SELECT
    settings.warehouse_id,
    settings.product_id,
    COALESCE(balance.quantity, 0)::numeric(18, 4) AS physical_quantity,
    COALESCE(reserved.quantity, 0)::numeric(18, 4) AS reserved_quantity,
    GREATEST(COALESCE(balance.quantity, 0) - COALESCE(reserved.quantity, 0), 0)::numeric(18, 4) AS available_quantity,
    settings.minimum_quantity,
    settings.target_quantity
  FROM inventory.stock_settings settings
  LEFT JOIN inventory.stock_balances balance
    ON balance.warehouse_id = settings.warehouse_id AND balance.product_id = settings.product_id
  LEFT JOIN reserved
    ON reserved.warehouse_id = settings.warehouse_id AND reserved.product_id = settings.product_id
  WHERE settings.active
)
SELECT
  warehouse_id,
  product_id,
  physical_quantity,
  reserved_quantity,
  available_quantity,
  minimum_quantity,
  target_quantity,
  available_quantity <= minimum_quantity AS low_stock,
  GREATEST(target_quantity - available_quantity, 0)::numeric(18, 4) AS recommended_quantity
FROM status;
