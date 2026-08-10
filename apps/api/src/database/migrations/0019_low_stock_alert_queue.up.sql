CREATE TABLE inventory.stock_alert_subscriptions (
  warehouse_id uuid NOT NULL REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES master_data.products(id) ON DELETE RESTRICT,
  recipient_account_id uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  configured_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  configured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, product_id, recipient_account_id),
  FOREIGN KEY (warehouse_id, product_id)
    REFERENCES inventory.stock_settings(warehouse_id, product_id) ON DELETE CASCADE
);

CREATE INDEX stock_alert_subscription_recipient_idx
  ON inventory.stock_alert_subscriptions (recipient_account_id)
  WHERE active;

CREATE TABLE inventory.low_stock_alert_state (
  warehouse_id uuid NOT NULL REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES master_data.products(id) ON DELETE RESTRICT,
  is_low_stock boolean NOT NULL DEFAULT false,
  cycle_number bigint NOT NULL DEFAULT 0,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, product_id),
  FOREIGN KEY (warehouse_id, product_id)
    REFERENCES inventory.stock_settings(warehouse_id, product_id) ON DELETE CASCADE,
  CONSTRAINT low_stock_alert_cycle_nonnegative CHECK (cycle_number >= 0)
);
