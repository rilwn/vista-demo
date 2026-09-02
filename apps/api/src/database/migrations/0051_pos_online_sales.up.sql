CREATE SCHEMA IF NOT EXISTS pos;

ALTER TABLE master_data.products
  ADD COLUMN pos_vat_treatment varchar(20),
  ADD CONSTRAINT product_pos_vat_treatment_valid CHECK (
    pos_vat_treatment IS NULL OR
    pos_vat_treatment IN ('standard_20', 'reduced_9', 'zero', 'exempt', 'ica')
  );

CREATE TABLE pos.terminal_configurations (
  cash_register_id uuid PRIMARY KEY
    REFERENCES organization.cash_registers(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  fiscal_mode varchar(20) NOT NULL DEFAULT 'disabled',
  fiscal_device_label varchar(120),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  configured_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  configured_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_terminal_fiscal_mode_valid CHECK (
    fiscal_mode IN ('disabled', 'simulator', 'hardware')
  ),
  CONSTRAINT pos_terminal_fiscal_label_valid CHECK (
    (fiscal_mode = 'disabled' AND fiscal_device_label IS NULL)
    OR (fiscal_mode <> 'disabled' AND fiscal_device_label IS NOT NULL
      AND fiscal_device_label = btrim(fiscal_device_label)
      AND char_length(fiscal_device_label) > 0)
  ),
  CONSTRAINT pos_terminal_version_positive CHECK (version > 0)
);

CREATE TABLE pos.shifts (
  id uuid PRIMARY KEY,
  shift_number varchar(80) NOT NULL UNIQUE,
  cash_register_id uuid NOT NULL
    REFERENCES organization.cash_registers(id) ON DELETE RESTRICT,
  operator_id uuid NOT NULL REFERENCES organization.operators(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  status varchar(20) NOT NULL DEFAULT 'open',
  opening_cash_bgn numeric(18, 4) NOT NULL,
  closing_cash_bgn numeric(18, 4),
  opened_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  closed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT pos_shift_status_valid CHECK (status IN ('open', 'closed')),
  CONSTRAINT pos_shift_cash_nonnegative CHECK (
    opening_cash_bgn >= 0 AND (closing_cash_bgn IS NULL OR closing_cash_bgn >= 0)
  ),
  CONSTRAINT pos_shift_lifecycle_valid CHECK (
    (status = 'open' AND closed_by IS NULL AND closed_at IS NULL AND closing_cash_bgn IS NULL)
    OR (status = 'closed' AND closed_by IS NOT NULL AND closed_at IS NOT NULL
      AND closing_cash_bgn IS NOT NULL)
  ),
  CONSTRAINT pos_shift_version_positive CHECK (version > 0)
);

CREATE UNIQUE INDEX pos_shift_register_open_unique
  ON pos.shifts (cash_register_id) WHERE status = 'open';
CREATE UNIQUE INDEX pos_shift_operator_open_unique
  ON pos.shifts (operator_id) WHERE status = 'open';
CREATE UNIQUE INDEX pos_shift_account_open_unique
  ON pos.shifts (opened_by) WHERE status = 'open';
CREATE INDEX pos_shifts_opened_idx ON pos.shifts (opened_at DESC, id DESC);

CREATE TABLE pos.document_sequences (
  cash_register_id uuid NOT NULL
    REFERENCES organization.cash_registers(id) ON DELETE RESTRICT,
  operator_id uuid NOT NULL REFERENCES organization.operators(id) ON DELETE RESTRICT,
  document_type varchar(20) NOT NULL,
  next_value bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (cash_register_id, operator_id, document_type),
  CONSTRAINT pos_document_type_valid CHECK (
    document_type IN ('shift', 'sale', 'fiscal_receipt', 'warranty_card')
  ),
  CONSTRAINT pos_document_sequence_positive CHECK (next_value > 0)
);

CREATE TABLE pos.sales (
  id uuid PRIMARY KEY,
  sale_number varchar(80) NOT NULL UNIQUE,
  client_transaction_id uuid NOT NULL UNIQUE,
  shift_id uuid NOT NULL REFERENCES pos.shifts(id) ON DELETE RESTRICT,
  cash_register_id uuid NOT NULL
    REFERENCES organization.cash_registers(id) ON DELETE RESTRICT,
  operator_id uuid NOT NULL REFERENCES organization.operators(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  customer_partner_id uuid REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  customer_location_id uuid REFERENCES master_data.customer_locations(id) ON DELETE RESTRICT,
  currency_code char(3) NOT NULL DEFAULT 'BGN',
  net_total numeric(18, 4) NOT NULL,
  vat_total numeric(18, 4) NOT NULL,
  gross_total numeric(18, 4) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'completed',
  fiscal_status varchar(20) NOT NULL,
  fiscal_receipt_number varchar(100) NOT NULL UNIQUE,
  fiscal_adapter varchar(40) NOT NULL,
  completed_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  completed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_sale_customer_location_pair CHECK (
    customer_location_id IS NULL OR customer_partner_id IS NOT NULL
  ),
  CONSTRAINT pos_sale_customer_location_fk
    FOREIGN KEY (customer_location_id, customer_partner_id)
    REFERENCES master_data.customer_locations(id, partner_id) ON DELETE RESTRICT,
  CONSTRAINT pos_sale_currency_bgn CHECK (currency_code = 'BGN'),
  CONSTRAINT pos_sale_totals_nonnegative CHECK (
    net_total >= 0 AND vat_total >= 0 AND gross_total >= 0
  ),
  CONSTRAINT pos_sale_total_balanced CHECK (gross_total = net_total + vat_total),
  CONSTRAINT pos_sale_status_valid CHECK (status IN ('completed', 'reversed')),
  CONSTRAINT pos_sale_fiscal_status_valid CHECK (
    fiscal_status IN ('simulated', 'fiscalized', 'reversed')
  )
);

CREATE INDEX pos_sales_completed_idx ON pos.sales (completed_at DESC, id DESC);
CREATE INDEX pos_sales_customer_idx
  ON pos.sales (customer_partner_id, completed_at DESC, id DESC)
  WHERE customer_partner_id IS NOT NULL;
CREATE INDEX pos_sales_shift_idx ON pos.sales (shift_id, completed_at DESC, id DESC);

CREATE TABLE pos.sale_lines (
  id uuid PRIMARY KEY,
  sale_id uuid NOT NULL REFERENCES pos.sales(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES master_data.products(id) ON DELETE RESTRICT,
  product_code varchar(80) NOT NULL,
  product_name varchar(255) NOT NULL,
  quantity numeric(18, 4) NOT NULL,
  unit_price numeric(18, 4) NOT NULL,
  vat_treatment varchar(20) NOT NULL,
  net_total numeric(18, 4) NOT NULL,
  vat_total numeric(18, 4) NOT NULL,
  gross_total numeric(18, 4) NOT NULL,
  price_list_id uuid REFERENCES sales.price_lists(id) ON DELETE RESTRICT,
  stock_movement_id uuid NOT NULL UNIQUE
    REFERENCES inventory.stock_movements(id) ON DELETE RESTRICT,
  batch_id uuid REFERENCES inventory.batches(id) ON DELETE RESTRICT,
  CONSTRAINT pos_sale_line_product_unique UNIQUE (sale_id, product_id),
  CONSTRAINT pos_sale_line_quantity_positive CHECK (quantity > 0),
  CONSTRAINT pos_sale_line_price_nonnegative CHECK (unit_price >= 0),
  CONSTRAINT pos_sale_line_vat_valid CHECK (
    vat_treatment IN ('standard_20', 'reduced_9', 'zero', 'exempt', 'ica')
  ),
  CONSTRAINT pos_sale_line_totals_nonnegative CHECK (
    net_total >= 0 AND vat_total >= 0 AND gross_total >= 0
  ),
  CONSTRAINT pos_sale_line_total_balanced CHECK (gross_total = net_total + vat_total)
);

CREATE INDEX pos_sale_lines_sale_idx ON pos.sale_lines (sale_id, id);

CREATE TABLE pos.sale_line_serials (
  sale_line_id uuid NOT NULL REFERENCES pos.sale_lines(id) ON DELETE RESTRICT,
  serialized_item_id uuid NOT NULL UNIQUE
    REFERENCES inventory.serialized_items(id) ON DELETE RESTRICT,
  serial_number varchar(120) NOT NULL,
  PRIMARY KEY (sale_line_id, serialized_item_id),
  CONSTRAINT pos_sale_serial_trimmed CHECK (
    serial_number = btrim(serial_number) AND char_length(serial_number) > 0
  )
);

CREATE TABLE pos.payments (
  id uuid PRIMARY KEY,
  sale_id uuid NOT NULL REFERENCES pos.sales(id) ON DELETE RESTRICT,
  payment_method varchar(20) NOT NULL,
  amount numeric(18, 4) NOT NULL,
  tendered_amount numeric(18, 4),
  change_amount numeric(18, 4) NOT NULL DEFAULT 0,
  provider_reference varchar(160),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_payment_method_valid CHECK (
    payment_method IN ('cash', 'card', 'on_account', 'advance')
  ),
  CONSTRAINT pos_payment_amount_positive CHECK (amount > 0),
  CONSTRAINT pos_payment_tender_valid CHECK (
    (payment_method = 'cash' AND tendered_amount IS NOT NULL
      AND tendered_amount >= amount AND change_amount = tendered_amount - amount)
    OR (payment_method <> 'cash' AND tendered_amount IS NULL AND change_amount = 0)
  )
);

CREATE INDEX pos_payments_sale_idx ON pos.payments (sale_id, recorded_at, id);

CREATE TABLE pos.fiscal_operations (
  id uuid PRIMARY KEY,
  sale_id uuid NOT NULL UNIQUE REFERENCES pos.sales(id) ON DELETE RESTRICT,
  operation_type varchar(30) NOT NULL,
  adapter varchar(40) NOT NULL,
  status varchar(20) NOT NULL,
  external_reference varchar(160) NOT NULL UNIQUE,
  request_digest char(64) NOT NULL,
  response_digest char(64) NOT NULL,
  attempt_count integer NOT NULL DEFAULT 1,
  completed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_fiscal_operation_type_valid CHECK (operation_type = 'sale_receipt'),
  CONSTRAINT pos_fiscal_operation_status_valid CHECK (status IN ('simulated', 'completed')),
  CONSTRAINT pos_fiscal_operation_attempt_positive CHECK (attempt_count > 0)
);

ALTER TABLE master_data.customer_equipment
  ADD COLUMN source_pos_sale_id uuid REFERENCES pos.sales(id) ON DELETE RESTRICT;

CREATE INDEX customer_equipment_pos_sale_idx
  ON master_data.customer_equipment (source_pos_sale_id)
  WHERE source_pos_sale_id IS NOT NULL;

ALTER TABLE crm.warranty_cards
  ADD COLUMN pos_sale_id uuid REFERENCES pos.sales(id) ON DELETE RESTRICT;

CREATE INDEX crm_warranty_cards_pos_sale_idx
  ON crm.warranty_cards (pos_sale_id)
  WHERE pos_sale_id IS NOT NULL;

COMMENT ON TABLE pos.terminal_configurations IS
  'Register-to-warehouse and fiscal-adapter assignment. Simulator rows are local/test only.';
COMMENT ON TABLE pos.sales IS
  'Completed online POS transactions. Hardware fiscal certification remains separately controlled.';
COMMENT ON TABLE pos.fiscal_operations IS
  'Recoverable adapter evidence without storing card or PIN data.';
COMMENT ON COLUMN master_data.products.pos_vat_treatment IS
  'Approved POS tax treatment. Products without one cannot be sold at POS.';
