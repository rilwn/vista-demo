CREATE TABLE procurement.acceptance_protocol_sequences (
  sequence_year smallint PRIMARY KEY,
  next_value integer NOT NULL DEFAULT 1,
  CONSTRAINT acceptance_protocol_sequence_year_valid CHECK (sequence_year BETWEEN 2000 AND 9999),
  CONSTRAINT acceptance_protocol_sequence_next_positive CHECK (next_value > 0)
);

ALTER TABLE procurement.supplier_invoices
  ADD CONSTRAINT supplier_invoice_id_order_supplier_unique
    UNIQUE (id, purchase_order_id, supplier_partner_id);

CREATE TABLE procurement.acceptance_protocols (
  id uuid PRIMARY KEY,
  protocol_number varchar(32) NOT NULL UNIQUE,
  sequence_year smallint NOT NULL,
  sequence_number integer NOT NULL,
  goods_receipt_id uuid NOT NULL UNIQUE,
  purchase_order_id uuid NOT NULL,
  supplier_partner_id uuid NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  supplier_invoice_id uuid,
  received_at timestamptz NOT NULL,
  supplier_delivery_reference varchar(120),
  received_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  prepared_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT acceptance_protocol_number_unique UNIQUE (sequence_year, sequence_number),
  CONSTRAINT acceptance_protocol_sequence_year_valid CHECK (sequence_year BETWEEN 2000 AND 9999),
  CONSTRAINT acceptance_protocol_sequence_number_positive CHECK (sequence_number > 0),
  CONSTRAINT acceptance_protocol_receipt_fk FOREIGN KEY (
    goods_receipt_id, purchase_order_id, supplier_partner_id
  ) REFERENCES procurement.goods_receipts(id, purchase_order_id, supplier_partner_id)
    ON DELETE RESTRICT,
  CONSTRAINT acceptance_protocol_invoice_fk FOREIGN KEY (
    supplier_invoice_id, purchase_order_id, supplier_partner_id
  ) REFERENCES procurement.supplier_invoices(id, purchase_order_id, supplier_partner_id)
    ON DELETE RESTRICT
);

CREATE INDEX acceptance_protocols_order_created_idx
  ON procurement.acceptance_protocols (purchase_order_id, created_at DESC, id DESC);

CREATE TABLE procurement.acceptance_protocol_lines (
  id uuid PRIMARY KEY,
  acceptance_protocol_id uuid NOT NULL REFERENCES procurement.acceptance_protocols(id) ON DELETE RESTRICT,
  goods_receipt_line_id uuid NOT NULL REFERENCES procurement.goods_receipt_lines(id) ON DELETE RESTRICT,
  purchase_order_line_id uuid NOT NULL REFERENCES procurement.purchase_order_lines(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES master_data.products(id) ON DELETE RESTRICT,
  product_code varchar(100) NOT NULL,
  product_name varchar(240) NOT NULL,
  currency_code char(3) NOT NULL,
  ordered_quantity numeric(18, 4) NOT NULL,
  previously_received_quantity numeric(18, 4) NOT NULL,
  accepted_quantity numeric(18, 4) NOT NULL,
  cumulative_received_quantity numeric(18, 4) NOT NULL,
  outstanding_quantity numeric(18, 4) NOT NULL,
  unit_price numeric(18, 4) NOT NULL,
  batch_number varchar(100),
  expires_at date,
  serial_numbers text[] NOT NULL DEFAULT ARRAY[]::text[],
  discrepancies jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT acceptance_protocol_line_source_unique UNIQUE (
    acceptance_protocol_id, goods_receipt_line_id
  ),
  CONSTRAINT acceptance_protocol_line_currency_uppercase CHECK (currency_code = upper(currency_code)),
  CONSTRAINT acceptance_protocol_line_quantities_valid CHECK (
    ordered_quantity > 0 AND previously_received_quantity >= 0 AND accepted_quantity > 0
    AND cumulative_received_quantity = previously_received_quantity + accepted_quantity
    AND outstanding_quantity = ordered_quantity - cumulative_received_quantity
    AND outstanding_quantity >= 0
  ),
  CONSTRAINT acceptance_protocol_line_price_nonnegative CHECK (unit_price >= 0),
  CONSTRAINT acceptance_protocol_line_discrepancies_array CHECK (jsonb_typeof(discrepancies) = 'array')
);

CREATE INDEX acceptance_protocol_lines_product_idx
  ON procurement.acceptance_protocol_lines (product_id, acceptance_protocol_id);

CREATE FUNCTION procurement.prevent_acceptance_protocol_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'procurement acceptance protocols are immutable';
END;
$$;

CREATE TRIGGER acceptance_protocols_immutable
BEFORE UPDATE OR DELETE ON procurement.acceptance_protocols
FOR EACH ROW EXECUTE FUNCTION procurement.prevent_acceptance_protocol_rewrite();

CREATE TRIGGER acceptance_protocol_lines_immutable
BEFORE UPDATE OR DELETE ON procurement.acceptance_protocol_lines
FOR EACH ROW EXECUTE FUNCTION procurement.prevent_acceptance_protocol_rewrite();

COMMENT ON TABLE procurement.acceptance_protocols IS
  'Immutable supplier delivery acceptance record linked to its purchase order, goods receipt and optional supplier invoice.';
COMMENT ON TABLE procurement.acceptance_protocol_lines IS
  'Snapshot of accepted goods, serial/batch references and recorded supplier discrepancies at protocol creation.';
