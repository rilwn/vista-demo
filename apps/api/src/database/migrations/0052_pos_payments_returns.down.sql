DROP INDEX IF EXISTS pos.pos_fiscal_operation_return_unique;
DROP INDEX IF EXISTS pos.pos_fiscal_operation_sale_unique;

ALTER TABLE pos.fiscal_operations
  DROP CONSTRAINT IF EXISTS pos_fiscal_operation_source_valid,
  DROP CONSTRAINT IF EXISTS pos_fiscal_operation_type_valid,
  DROP COLUMN IF EXISTS return_id,
  ADD CONSTRAINT pos_fiscal_operation_type_valid CHECK (operation_type = 'sale_receipt'),
  ADD CONSTRAINT fiscal_operations_sale_id_key UNIQUE (sale_id);

DROP TABLE IF EXISTS pos.return_line_serials;
DROP TABLE IF EXISTS pos.return_lines;
DROP TABLE IF EXISTS pos.return_refunds;
DROP TABLE IF EXISTS pos.returns;

ALTER TABLE pos.sale_line_serials
  ADD CONSTRAINT sale_line_serials_serialized_item_id_key UNIQUE (serialized_item_id);

DROP INDEX IF EXISTS master_data.customer_equipment_active_serial_number_unique;
DROP INDEX IF EXISTS master_data.customer_equipment_active_serial_item_unique;

CREATE UNIQUE INDEX customer_equipment_serial_unique
  ON master_data.customer_equipment (upper(serial_number));

ALTER TABLE master_data.customer_equipment
  ADD CONSTRAINT customer_equipment_serialized_item_id_key UNIQUE (serialized_item_id);

UPDATE pos.sales
SET status = 'completed',
    fiscal_status = CASE
      WHEN fiscal_adapter = 'development-simulator' THEN 'simulated'
      ELSE 'fiscalized'
    END
WHERE status <> 'completed'
   OR fiscal_status IN ('partially_reversed', 'reversed');

ALTER TABLE pos.sales
  DROP CONSTRAINT IF EXISTS pos_sale_status_valid,
  DROP CONSTRAINT IF EXISTS pos_sale_fiscal_status_valid,
  ADD CONSTRAINT pos_sale_status_valid CHECK (status IN ('completed', 'reversed')),
  ADD CONSTRAINT pos_sale_fiscal_status_valid CHECK (
    fiscal_status IN ('simulated', 'fiscalized', 'reversed')
  );

ALTER TABLE pos.document_sequences
  DROP CONSTRAINT IF EXISTS pos_document_type_valid,
  ADD CONSTRAINT pos_document_type_valid CHECK (
    document_type IN ('shift', 'sale', 'fiscal_receipt', 'warranty_card')
  );

ALTER TABLE pos.payments
  DROP CONSTRAINT IF EXISTS pos_payment_card_reference_valid,
  DROP CONSTRAINT IF EXISTS pos_payment_adapter_valid,
  DROP CONSTRAINT IF EXISTS pos_payment_status_valid,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS adapter;

ALTER TABLE pos.terminal_configurations
  DROP CONSTRAINT IF EXISTS pos_terminal_payment_label_valid,
  DROP CONSTRAINT IF EXISTS pos_terminal_payment_mode_valid,
  DROP COLUMN IF EXISTS service_return_warehouse_id,
  DROP COLUMN IF EXISTS payment_terminal_label,
  DROP COLUMN IF EXISTS payment_terminal_mode;
