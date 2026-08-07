CREATE SCHEMA IF NOT EXISTS inventory;

CREATE TABLE master_data.warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(30) NOT NULL,
  name varchar(120) NOT NULL,
  warehouse_type varchar(20) NOT NULL DEFAULT 'standard',
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_code_trimmed CHECK (code = btrim(code) AND char_length(code) > 0),
  CONSTRAINT warehouse_name_trimmed CHECK (name = btrim(name) AND char_length(name) > 0),
  CONSTRAINT warehouse_type_valid CHECK (warehouse_type IN ('standard', 'technician')),
  CONSTRAINT warehouse_version_positive CHECK (version > 0)
);

CREATE UNIQUE INDEX warehouses_code_unique ON master_data.warehouses (upper(code));

CREATE TABLE inventory.stock_movements (
  id uuid PRIMARY KEY,
  warehouse_id uuid NOT NULL REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES master_data.products(id) ON DELETE RESTRICT,
  movement_type varchar(30) NOT NULL,
  quantity numeric(18, 4) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  reference_type varchar(60) NOT NULL,
  reference_id varchar(120) NOT NULL,
  actor_account_id uuid NOT NULL REFERENCES identity.user_accounts(id),
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_movement_type_valid CHECK (movement_type IN ('receipt')),
  CONSTRAINT stock_movement_quantity_positive CHECK (quantity > 0),
  CONSTRAINT stock_movement_reference_nonempty CHECK (reference_id = btrim(reference_id) AND char_length(reference_id) > 0)
);

CREATE INDEX stock_movements_warehouse_product_idx ON inventory.stock_movements (warehouse_id, product_id, occurred_at, id);
CREATE UNIQUE INDEX stock_movements_reference_unique ON inventory.stock_movements (reference_type, reference_id, product_id, warehouse_id);

CREATE TABLE inventory.stock_balances (
  warehouse_id uuid NOT NULL REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES master_data.products(id) ON DELETE RESTRICT,
  quantity numeric(18, 4) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, product_id),
  CONSTRAINT stock_balance_nonnegative CHECK (quantity >= 0)
);

CREATE TABLE inventory.batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES master_data.products(id) ON DELETE RESTRICT,
  batch_number varchar(100) NOT NULL,
  expires_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT batch_number_trimmed CHECK (batch_number = btrim(batch_number) AND char_length(batch_number) > 0)
);

CREATE UNIQUE INDEX batches_product_number_unique ON inventory.batches (product_id, batch_number);

CREATE TABLE inventory.batch_stock_balances (
  warehouse_id uuid NOT NULL REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES inventory.batches(id) ON DELETE RESTRICT,
  quantity numeric(18, 4) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, batch_id),
  CONSTRAINT batch_stock_balance_nonnegative CHECK (quantity >= 0)
);

CREATE TABLE inventory.serialized_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES master_data.products(id) ON DELETE RESTRICT,
  serial_number varchar(120) NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  received_movement_id uuid NOT NULL REFERENCES inventory.stock_movements(id) ON DELETE RESTRICT,
  status varchar(20) NOT NULL DEFAULT 'available',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT serialized_item_number_trimmed CHECK (serial_number = btrim(serial_number) AND char_length(serial_number) > 0),
  CONSTRAINT serialized_item_status_valid CHECK (status IN ('available'))
);

CREATE UNIQUE INDEX serialized_items_serial_unique ON inventory.serialized_items (upper(serial_number));
CREATE INDEX serialized_items_warehouse_product_idx ON inventory.serialized_items (warehouse_id, product_id, status);
