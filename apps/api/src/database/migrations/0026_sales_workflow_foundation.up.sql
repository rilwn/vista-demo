CREATE SCHEMA IF NOT EXISTS sales;

CREATE TABLE sales.internal_document_sequences (
  document_type varchar(30) PRIMARY KEY,
  next_value bigint NOT NULL DEFAULT 1,
  CONSTRAINT sales_internal_sequence_type_valid CHECK (
    document_type IN ('quotation', 'order', 'shipment', 'invoice_draft')
  ),
  CONSTRAINT sales_internal_sequence_positive CHECK (next_value > 0)
);

CREATE TABLE sales.quotations (
  id uuid PRIMARY KEY,
  quotation_number varchar(40) NOT NULL UNIQUE,
  customer_partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  valid_until date NOT NULL,
  currency_code char(3) NOT NULL,
  overall_discount_percent numeric(7, 4) NOT NULL DEFAULT 0,
  subtotal numeric(18, 4) NOT NULL DEFAULT 0,
  vat_total numeric(18, 4) NOT NULL DEFAULT 0,
  total numeric(18, 4) NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'draft',
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_quotation_currency_uppercase CHECK (currency_code = upper(currency_code)),
  CONSTRAINT sales_quotation_discount_valid CHECK (
    overall_discount_percent >= 0 AND overall_discount_percent <= 100
  ),
  CONSTRAINT sales_quotation_totals_nonnegative CHECK (
    subtotal >= 0 AND vat_total >= 0 AND total >= 0
  ),
  CONSTRAINT sales_quotation_status_valid CHECK (
    status IN ('draft', 'confirmed', 'shipped', 'invoiced')
  )
);

CREATE INDEX sales_quotations_customer_date_idx
  ON sales.quotations (customer_partner_id, created_at DESC, id DESC);

CREATE TABLE sales.quotation_lines (
  id uuid PRIMARY KEY,
  quotation_id uuid NOT NULL REFERENCES sales.quotations(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES master_data.products(id) ON DELETE RESTRICT,
  quantity numeric(18, 4) NOT NULL,
  unit_price numeric(18, 4) NOT NULL,
  discount_percent numeric(7, 4) NOT NULL DEFAULT 0,
  vat_treatment varchar(20) NOT NULL,
  line_total numeric(18, 4) NOT NULL,
  CONSTRAINT sales_quotation_line_unique UNIQUE (quotation_id, product_id),
  CONSTRAINT sales_quotation_line_quantity_positive CHECK (quantity > 0),
  CONSTRAINT sales_quotation_line_price_nonnegative CHECK (unit_price >= 0),
  CONSTRAINT sales_quotation_line_discount_valid CHECK (
    discount_percent >= 0 AND discount_percent <= 100
  ),
  CONSTRAINT sales_quotation_line_total_nonnegative CHECK (line_total >= 0),
  CONSTRAINT sales_quotation_line_vat_valid CHECK (
    vat_treatment IN ('standard_20', 'reduced_9', 'zero', 'exempt', 'ica')
  )
);

CREATE INDEX sales_quotation_lines_quotation_idx ON sales.quotation_lines (quotation_id, id);

CREATE TABLE sales.orders (
  id uuid PRIMARY KEY,
  order_number varchar(40) NOT NULL UNIQUE,
  quotation_id uuid NOT NULL UNIQUE REFERENCES sales.quotations(id) ON DELETE RESTRICT,
  customer_partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES master_data.warehouses(id) ON DELETE RESTRICT,
  status varchar(20) NOT NULL DEFAULT 'confirmed',
  confirmed_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_order_status_valid CHECK (status IN ('confirmed', 'shipped', 'invoiced'))
);

CREATE TABLE sales.order_lines (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES sales.orders(id) ON DELETE RESTRICT,
  quotation_line_id uuid NOT NULL UNIQUE REFERENCES sales.quotation_lines(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES master_data.products(id) ON DELETE RESTRICT,
  quantity numeric(18, 4) NOT NULL,
  reservation_id uuid NOT NULL UNIQUE REFERENCES inventory.stock_reservations(id) ON DELETE RESTRICT,
  CONSTRAINT sales_order_line_unique UNIQUE (order_id, product_id),
  CONSTRAINT sales_order_line_quantity_positive CHECK (quantity > 0)
);

CREATE INDEX sales_order_lines_order_idx ON sales.order_lines (order_id, id);

CREATE TABLE sales.shipments (
  id uuid PRIMARY KEY,
  shipment_number varchar(40) NOT NULL UNIQUE,
  order_id uuid NOT NULL UNIQUE REFERENCES sales.orders(id) ON DELETE RESTRICT,
  shipped_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  shipped_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sales.shipment_lines (
  id uuid PRIMARY KEY,
  shipment_id uuid NOT NULL REFERENCES sales.shipments(id) ON DELETE RESTRICT,
  order_line_id uuid NOT NULL UNIQUE REFERENCES sales.order_lines(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES master_data.products(id) ON DELETE RESTRICT,
  quantity numeric(18, 4) NOT NULL,
  stock_movement_id uuid NOT NULL UNIQUE REFERENCES inventory.stock_movements(id) ON DELETE RESTRICT,
  batch_number varchar(100),
  CONSTRAINT sales_shipment_line_quantity_positive CHECK (quantity > 0),
  CONSTRAINT sales_shipment_batch_trimmed CHECK (
    batch_number IS NULL OR (batch_number = btrim(batch_number) AND char_length(batch_number) > 0)
  )
);

CREATE INDEX sales_shipment_lines_shipment_idx ON sales.shipment_lines (shipment_id, id);

CREATE TABLE sales.invoices (
  id uuid PRIMARY KEY,
  invoice_number varchar(40) NOT NULL UNIQUE,
  order_id uuid NOT NULL UNIQUE REFERENCES sales.orders(id) ON DELETE RESTRICT,
  shipment_id uuid NOT NULL UNIQUE REFERENCES sales.shipments(id) ON DELETE RESTRICT,
  customer_partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  currency_code char(3) NOT NULL,
  subtotal numeric(18, 4) NOT NULL,
  vat_total numeric(18, 4) NOT NULL,
  total numeric(18, 4) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft',
  recorded_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_invoice_currency_uppercase CHECK (currency_code = upper(currency_code)),
  CONSTRAINT sales_invoice_totals_nonnegative CHECK (
    subtotal >= 0 AND vat_total >= 0 AND total >= 0
  ),
  CONSTRAINT sales_invoice_status_draft CHECK (status = 'draft')
);

CREATE INDEX sales_invoices_customer_date_idx
  ON sales.invoices (customer_partner_id, recorded_at DESC, id DESC);

CREATE TABLE sales.invoice_lines (
  id uuid PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES sales.invoices(id) ON DELETE RESTRICT,
  quotation_line_id uuid NOT NULL REFERENCES sales.quotation_lines(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES master_data.products(id) ON DELETE RESTRICT,
  quantity numeric(18, 4) NOT NULL,
  unit_price numeric(18, 4) NOT NULL,
  vat_treatment varchar(20) NOT NULL,
  line_total numeric(18, 4) NOT NULL,
  CONSTRAINT sales_invoice_line_unique UNIQUE (invoice_id, quotation_line_id),
  CONSTRAINT sales_invoice_line_quantity_positive CHECK (quantity > 0),
  CONSTRAINT sales_invoice_line_price_nonnegative CHECK (unit_price >= 0),
  CONSTRAINT sales_invoice_line_total_nonnegative CHECK (line_total >= 0),
  CONSTRAINT sales_invoice_line_vat_valid CHECK (
    vat_treatment IN ('standard_20', 'reduced_9', 'zero', 'exempt', 'ica')
  )
);

COMMENT ON TABLE sales.internal_document_sequences IS
  'Internal workflow references only. Official fiscal/accounting numbering remains subject to BUS-002 approval.';
COMMENT ON TABLE sales.invoices IS
  'Draft invoice snapshots created from shipped orders. Legal issuance, BNB posting, PDF, and delivery are separate finance controls.';
