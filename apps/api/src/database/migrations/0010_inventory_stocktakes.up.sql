CREATE TABLE inventory.stocktakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  status varchar(20) NOT NULL DEFAULT 'open',
  reference_id varchar(120) NOT NULL,
  opened_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  completed_by uuid REFERENCES identity.user_accounts(id),
  completed_at timestamptz,
  CONSTRAINT stocktake_status_valid CHECK (status IN ('open', 'completed', 'cancelled')),
  CONSTRAINT stocktake_reference_trimmed CHECK (reference_id = btrim(reference_id) AND char_length(reference_id) > 0),
  CONSTRAINT stocktake_completion_consistent CHECK (
    (status = 'open' AND completed_by IS NULL AND completed_at IS NULL)
    OR (status IN ('completed', 'cancelled') AND completed_by IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX stocktakes_open_warehouse_unique
  ON inventory.stocktakes (warehouse_id)
  WHERE status = 'open';

CREATE TABLE inventory.stocktake_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stocktake_id uuid NOT NULL REFERENCES inventory.stocktakes(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES master_data.products(id) ON DELETE RESTRICT,
  expected_quantity numeric(18, 4) NOT NULL,
  counted_quantity numeric(18, 4) NOT NULL,
  counted_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  counted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stocktake_count_quantities_nonnegative CHECK (expected_quantity >= 0 AND counted_quantity >= 0),
  CONSTRAINT stocktake_count_unique_product UNIQUE (stocktake_id, product_id)
);
