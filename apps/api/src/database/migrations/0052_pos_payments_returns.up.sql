ALTER TABLE pos.terminal_configurations
  ADD COLUMN payment_terminal_mode varchar(20) NOT NULL DEFAULT 'disabled',
  ADD COLUMN payment_terminal_label varchar(120),
  ADD COLUMN service_return_warehouse_id uuid
    REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  ADD CONSTRAINT pos_terminal_payment_mode_valid CHECK (
    payment_terminal_mode IN ('disabled', 'simulator', 'hardware')
  ),
  ADD CONSTRAINT pos_terminal_payment_label_valid CHECK (
    (payment_terminal_mode = 'disabled' AND payment_terminal_label IS NULL)
    OR (payment_terminal_mode <> 'disabled' AND payment_terminal_label IS NOT NULL
      AND payment_terminal_label = btrim(payment_terminal_label)
      AND char_length(payment_terminal_label) > 0)
  );

ALTER TABLE pos.payments
  ADD COLUMN adapter varchar(40) NOT NULL DEFAULT 'cash-drawer',
  ADD COLUMN status varchar(20) NOT NULL DEFAULT 'completed',
  ADD CONSTRAINT pos_payment_status_valid CHECK (status IN ('completed', 'simulated')),
  ADD CONSTRAINT pos_payment_adapter_valid CHECK (
    (payment_method = 'cash' AND adapter = 'cash-drawer' AND status = 'completed')
    OR (payment_method = 'card' AND adapter IN ('development-card-simulator', 'pin-pad'))
    OR (payment_method = 'on_account' AND adapter = 'customer-account' AND status = 'completed')
    OR (payment_method = 'advance' AND adapter = 'customer-advance' AND status = 'completed')
  ),
  ADD CONSTRAINT pos_payment_card_reference_valid CHECK (
    payment_method <> 'card'
    OR (provider_reference IS NOT NULL AND provider_reference = btrim(provider_reference)
      AND char_length(provider_reference) > 0)
  );

ALTER TABLE pos.document_sequences
  DROP CONSTRAINT pos_document_type_valid,
  ADD CONSTRAINT pos_document_type_valid CHECK (
    document_type IN (
      'shift', 'sale', 'fiscal_receipt', 'warranty_card',
      'return', 'fiscal_return'
    )
  );

ALTER TABLE pos.sales
  DROP CONSTRAINT pos_sale_status_valid,
  DROP CONSTRAINT pos_sale_fiscal_status_valid,
  ADD CONSTRAINT pos_sale_status_valid CHECK (
    status IN ('completed', 'partially_returned', 'returned')
  ),
  ADD CONSTRAINT pos_sale_fiscal_status_valid CHECK (
    fiscal_status IN ('simulated', 'fiscalized', 'partially_reversed', 'reversed')
  );

-- A serial may be sold again after a linked return. Keep every historical
-- equipment and sale record while allowing only one active ownership record.
ALTER TABLE master_data.customer_equipment
  DROP CONSTRAINT customer_equipment_serialized_item_id_key;

DROP INDEX master_data.customer_equipment_serial_unique;

CREATE UNIQUE INDEX customer_equipment_active_serial_item_unique
  ON master_data.customer_equipment (serialized_item_id)
  WHERE active AND serialized_item_id IS NOT NULL;

CREATE UNIQUE INDEX customer_equipment_active_serial_number_unique
  ON master_data.customer_equipment (upper(serial_number))
  WHERE active;

ALTER TABLE pos.sale_line_serials
  DROP CONSTRAINT sale_line_serials_serialized_item_id_key;

CREATE TABLE pos.returns (
  id uuid PRIMARY KEY,
  return_number varchar(80) NOT NULL UNIQUE,
  original_sale_id uuid NOT NULL REFERENCES pos.sales(id) ON DELETE RESTRICT,
  shift_id uuid NOT NULL REFERENCES pos.shifts(id) ON DELETE RESTRICT,
  cash_register_id uuid NOT NULL
    REFERENCES organization.cash_registers(id) ON DELETE RESTRICT,
  operator_id uuid NOT NULL REFERENCES organization.operators(id) ON DELETE RESTRICT,
  customer_partner_id uuid REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  reason varchar(1000) NOT NULL,
  net_total numeric(18, 4) NOT NULL,
  vat_total numeric(18, 4) NOT NULL,
  gross_total numeric(18, 4) NOT NULL,
  fiscal_reversal_number varchar(100) NOT NULL UNIQUE,
  fiscal_adapter varchar(40) NOT NULL,
  completed_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  completed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_return_reason_trimmed CHECK (
    reason = btrim(reason) AND char_length(reason) BETWEEN 3 AND 1000
  ),
  CONSTRAINT pos_return_totals_positive CHECK (
    net_total > 0 AND vat_total >= 0 AND gross_total > 0
  ),
  CONSTRAINT pos_return_total_balanced CHECK (gross_total = net_total + vat_total)
);

CREATE INDEX pos_returns_sale_idx
  ON pos.returns (original_sale_id, completed_at DESC, id DESC);
CREATE INDEX pos_returns_shift_idx
  ON pos.returns (shift_id, completed_at DESC, id DESC);

CREATE TABLE pos.return_refunds (
  id uuid PRIMARY KEY,
  return_id uuid NOT NULL REFERENCES pos.returns(id) ON DELETE RESTRICT,
  refund_method varchar(20) NOT NULL,
  amount numeric(18, 4) NOT NULL,
  adapter varchar(40) NOT NULL,
  status varchar(20) NOT NULL,
  provider_reference varchar(160),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_return_refund_method_unique UNIQUE (return_id, refund_method),
  CONSTRAINT pos_return_refund_method_valid CHECK (refund_method IN ('cash', 'card')),
  CONSTRAINT pos_return_refund_amount_positive CHECK (amount > 0),
  CONSTRAINT pos_return_refund_status_valid CHECK (status IN ('completed', 'simulated')),
  CONSTRAINT pos_return_refund_adapter_valid CHECK (
    (refund_method = 'cash' AND adapter = 'cash-drawer'
      AND status = 'completed' AND provider_reference IS NULL)
    OR (refund_method = 'card'
      AND adapter IN ('development-card-simulator', 'pin-pad')
      AND provider_reference IS NOT NULL)
  )
);

CREATE INDEX pos_return_refunds_return_idx
  ON pos.return_refunds (return_id, recorded_at, id);

CREATE TABLE pos.return_lines (
  id uuid PRIMARY KEY,
  return_id uuid NOT NULL REFERENCES pos.returns(id) ON DELETE RESTRICT,
  original_sale_line_id uuid NOT NULL REFERENCES pos.sale_lines(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES master_data.products(id) ON DELETE RESTRICT,
  product_code varchar(80) NOT NULL,
  product_name varchar(255) NOT NULL,
  quantity numeric(18, 4) NOT NULL,
  disposition varchar(20) NOT NULL,
  destination_warehouse_id uuid NOT NULL
    REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  net_total numeric(18, 4) NOT NULL,
  vat_total numeric(18, 4) NOT NULL,
  gross_total numeric(18, 4) NOT NULL,
  stock_movement_id uuid NOT NULL UNIQUE
    REFERENCES inventory.stock_movements(id) ON DELETE RESTRICT,
  batch_id uuid REFERENCES inventory.batches(id) ON DELETE RESTRICT,
  CONSTRAINT pos_return_line_unique UNIQUE (return_id, original_sale_line_id),
  CONSTRAINT pos_return_line_quantity_positive CHECK (quantity > 0),
  CONSTRAINT pos_return_line_disposition_valid CHECK (disposition IN ('restock', 'service')),
  CONSTRAINT pos_return_line_totals_valid CHECK (
    net_total >= 0 AND vat_total >= 0 AND gross_total > 0
      AND gross_total = net_total + vat_total
  )
);

CREATE INDEX pos_return_lines_return_idx ON pos.return_lines (return_id, id);
CREATE INDEX pos_return_lines_original_idx
  ON pos.return_lines (original_sale_line_id, id);

CREATE TABLE pos.return_line_serials (
  return_line_id uuid NOT NULL REFERENCES pos.return_lines(id) ON DELETE RESTRICT,
  serialized_item_id uuid NOT NULL REFERENCES inventory.serialized_items(id) ON DELETE RESTRICT,
  serial_number varchar(120) NOT NULL,
  PRIMARY KEY (return_line_id, serialized_item_id),
  CONSTRAINT pos_return_serial_trimmed CHECK (
    serial_number = btrim(serial_number) AND char_length(serial_number) > 0
  )
);

ALTER TABLE pos.fiscal_operations
  DROP CONSTRAINT fiscal_operations_sale_id_key,
  DROP CONSTRAINT pos_fiscal_operation_type_valid,
  ADD COLUMN return_id uuid REFERENCES pos.returns(id) ON DELETE RESTRICT,
  ADD CONSTRAINT pos_fiscal_operation_type_valid CHECK (
    operation_type IN ('sale_receipt', 'return_reversal')
  ),
  ADD CONSTRAINT pos_fiscal_operation_source_valid CHECK (
    (operation_type = 'sale_receipt' AND return_id IS NULL)
    OR (operation_type = 'return_reversal' AND return_id IS NOT NULL)
  );

CREATE UNIQUE INDEX pos_fiscal_operation_sale_unique
  ON pos.fiscal_operations (sale_id) WHERE operation_type = 'sale_receipt';
CREATE UNIQUE INDEX pos_fiscal_operation_return_unique
  ON pos.fiscal_operations (return_id) WHERE return_id IS NOT NULL;

COMMENT ON TABLE pos.returns IS
  'Linked POS refunds and fiscal-reversal evidence. Unlinked exceptions are deliberately unsupported.';
COMMENT ON COLUMN pos.terminal_configurations.service_return_warehouse_id IS
  'Explicit approved destination for repairable POS returns; never inferred by warehouse name.';
