CREATE TABLE inventory.stock_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES master_data.products(id) ON DELETE RESTRICT,
  reference_type varchar(30) NOT NULL,
  reference_id varchar(120) NOT NULL,
  initial_quantity numeric(18, 4) NOT NULL,
  remaining_quantity numeric(18, 4) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active',
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_by uuid REFERENCES identity.user_accounts(id),
  ended_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT stock_reservation_reference_type_valid CHECK (reference_type IN ('sales_order', 'quotation', 'service_request')),
  CONSTRAINT stock_reservation_status_valid CHECK (status IN ('active', 'released', 'consumed')),
  CONSTRAINT stock_reservation_reference_trimmed CHECK (reference_id = btrim(reference_id) AND char_length(reference_id) > 0),
  CONSTRAINT stock_reservation_quantities_valid CHECK (initial_quantity > 0 AND remaining_quantity >= 0 AND remaining_quantity <= initial_quantity),
  CONSTRAINT stock_reservation_lifecycle_valid CHECK (
    (status = 'active' AND remaining_quantity > 0 AND ended_by IS NULL AND ended_at IS NULL)
    OR (status = 'released' AND remaining_quantity > 0 AND ended_by IS NOT NULL AND ended_at IS NOT NULL)
    OR (status = 'consumed' AND remaining_quantity = 0 AND ended_by IS NOT NULL AND ended_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX stock_reservation_active_reference_unique
  ON inventory.stock_reservations (warehouse_id, product_id, reference_type, reference_id)
  WHERE status = 'active';

CREATE INDEX stock_reservation_available_quantity_idx
  ON inventory.stock_reservations (warehouse_id, product_id)
  WHERE status = 'active';

CREATE TABLE inventory.stock_reservation_serials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES inventory.stock_reservations(id) ON DELETE RESTRICT,
  serialized_item_id uuid NOT NULL REFERENCES inventory.serialized_items(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CONSTRAINT stock_reservation_serial_lifecycle_valid CHECK (
    (active AND ended_at IS NULL) OR (NOT active AND ended_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX stock_reservation_serial_active_unique
  ON inventory.stock_reservation_serials (serialized_item_id)
  WHERE active;

CREATE INDEX stock_reservation_serial_reservation_idx
  ON inventory.stock_reservation_serials (reservation_id);
