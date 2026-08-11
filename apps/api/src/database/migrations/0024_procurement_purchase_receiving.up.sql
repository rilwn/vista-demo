CREATE SCHEMA IF NOT EXISTS procurement;

CREATE TABLE procurement.purchase_orders (
  id uuid PRIMARY KEY,
  supplier_partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  currency_code char(3) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'open',
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_order_currency_uppercase CHECK (currency_code = upper(currency_code)),
  CONSTRAINT purchase_order_status_valid CHECK (
    status IN ('open', 'partially_received', 'received')
  ),
  CONSTRAINT purchase_order_version_positive CHECK (version > 0)
);

CREATE INDEX purchase_orders_supplier_status_idx
  ON procurement.purchase_orders (supplier_partner_id, status, created_at DESC, id);
CREATE INDEX purchase_orders_warehouse_status_idx
  ON procurement.purchase_orders (warehouse_id, status, created_at DESC, id);

CREATE TABLE procurement.purchase_order_lines (
  id uuid PRIMARY KEY,
  purchase_order_id uuid NOT NULL REFERENCES procurement.purchase_orders(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES master_data.products(id) ON DELETE RESTRICT,
  ordered_quantity numeric(18, 4) NOT NULL,
  delivered_quantity numeric(18, 4) NOT NULL DEFAULT 0,
  invoiced_quantity numeric(18, 4) NOT NULL DEFAULT 0,
  unit_price numeric(18, 4) NOT NULL,
  expected_delivery_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_order_line_product_unique UNIQUE (purchase_order_id, product_id),
  CONSTRAINT purchase_order_line_quantity_positive CHECK (ordered_quantity > 0),
  CONSTRAINT purchase_order_line_delivered_valid CHECK (
    delivered_quantity >= 0 AND delivered_quantity <= ordered_quantity
  ),
  CONSTRAINT purchase_order_line_invoiced_nonnegative CHECK (invoiced_quantity >= 0),
  CONSTRAINT purchase_order_line_price_nonnegative CHECK (unit_price >= 0)
);

CREATE INDEX purchase_order_lines_product_idx
  ON procurement.purchase_order_lines (product_id, expected_delivery_date, id);

CREATE TABLE procurement.goods_receipts (
  id uuid PRIMARY KEY,
  purchase_order_id uuid NOT NULL REFERENCES procurement.purchase_orders(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  supplier_partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  supplier_delivery_reference varchar(120),
  received_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  correlation_id uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT goods_receipt_reference_trimmed CHECK (
    supplier_delivery_reference IS NULL OR (
      supplier_delivery_reference = btrim(supplier_delivery_reference)
      AND char_length(supplier_delivery_reference) > 0
    )
  )
);

CREATE INDEX goods_receipts_order_date_idx
  ON procurement.goods_receipts (purchase_order_id, received_at DESC, id);

CREATE TABLE procurement.goods_receipt_lines (
  id uuid PRIMARY KEY,
  goods_receipt_id uuid NOT NULL REFERENCES procurement.goods_receipts(id) ON DELETE RESTRICT,
  purchase_order_line_id uuid NOT NULL REFERENCES procurement.purchase_order_lines(id) ON DELETE RESTRICT,
  stock_movement_id uuid NOT NULL REFERENCES inventory.stock_movements(id) ON DELETE RESTRICT,
  quantity numeric(18, 4) NOT NULL,
  unit_cost_bgn numeric(18, 4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT goods_receipt_order_line_unique UNIQUE (
    goods_receipt_id,
    purchase_order_line_id
  ),
  CONSTRAINT goods_receipt_line_quantity_positive CHECK (quantity > 0),
  CONSTRAINT goods_receipt_line_cost_nonnegative CHECK (unit_cost_bgn >= 0)
);

CREATE UNIQUE INDEX goods_receipt_lines_stock_movement_unique
  ON procurement.goods_receipt_lines (stock_movement_id);

COMMENT ON SCHEMA procurement IS
  'Purchase ordering and supplier delivery history linked transactionally to ERP inventory.';
COMMENT ON TABLE procurement.purchase_orders IS
  'Internal purchase workflow identity. Client-approved document numbering is added only after BUS-002 is resolved.';
COMMENT ON COLUMN procurement.purchase_order_lines.invoiced_quantity IS
  'Reserved for supplier invoice comparison; remains zero until linked supplier invoices are implemented.';
