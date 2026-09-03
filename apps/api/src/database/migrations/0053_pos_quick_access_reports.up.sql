CREATE TABLE pos.quick_access_products (
  cash_register_id uuid NOT NULL
    REFERENCES organization.cash_registers(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES master_data.products(id) ON DELETE RESTRICT,
  display_order smallint NOT NULL,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cash_register_id, product_id),
  CONSTRAINT pos_quick_access_order_unique UNIQUE (cash_register_id, display_order),
  CONSTRAINT pos_quick_access_order_valid CHECK (display_order BETWEEN 1 AND 12)
);

ALTER TABLE pos.sale_lines
  ADD COLUMN category_id uuid REFERENCES master_data.product_categories(id) ON DELETE RESTRICT,
  ADD COLUMN category_name varchar(160);

UPDATE pos.sale_lines line
SET category_id = category.id,
    category_name = category.name
FROM master_data.products product
JOIN master_data.product_categories category ON category.id = product.category_id
WHERE product.id = line.product_id;

ALTER TABLE pos.sale_lines
  ALTER COLUMN category_id SET NOT NULL,
  ALTER COLUMN category_name SET NOT NULL;

ALTER TABLE pos.return_lines
  ADD COLUMN category_id uuid REFERENCES master_data.product_categories(id) ON DELETE RESTRICT,
  ADD COLUMN category_name varchar(160);

UPDATE pos.return_lines return_line
SET category_id = sale_line.category_id,
    category_name = sale_line.category_name
FROM pos.sale_lines sale_line
WHERE sale_line.id = return_line.original_sale_line_id;

ALTER TABLE pos.return_lines
  ALTER COLUMN category_id SET NOT NULL,
  ALTER COLUMN category_name SET NOT NULL;

INSERT INTO reporting.report_definitions (
  id, definition_key, name, description, implementation_key,
  available_formats, filter_schema
) VALUES
  (
    '078f66b2-6959-4fce-8a96-4c9d2fa1b403',
    'pos.shift-register',
    'Shift register',
    'Opening, takings, refunds, expected cash, and closing differences by shift.',
    'pos.shift-register.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"required":["dateFrom","dateTo"],"properties":{"dateFrom":{"type":"string","format":"date"},"dateTo":{"type":"string","format":"date"},"businessLocationId":{"type":"string","format":"uuid"},"cashRegisterId":{"type":"string","format":"uuid"},"operatorId":{"type":"string","format":"uuid"}}}'::jsonb
  ),
  (
    '3aec96f8-66b5-4c4a-a3ad-3453aa6af6fd',
    'pos.cashier-performance',
    'Cashier report',
    'Sales, returns, and net revenue by cashier for a selected period.',
    'pos.cashier-performance.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"required":["dateFrom","dateTo"],"properties":{"dateFrom":{"type":"string","format":"date"},"dateTo":{"type":"string","format":"date"},"businessLocationId":{"type":"string","format":"uuid"},"cashRegisterId":{"type":"string","format":"uuid"},"operatorId":{"type":"string","format":"uuid"}}}'::jsonb
  ),
  (
    '7731b2d9-155c-4d9c-ac77-dfca594116ac',
    'pos.x-report',
    'X report',
    'Point-in-time operational totals for one open cashier shift.',
    'pos.x-report.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"required":["shiftId","asOf"],"properties":{"shiftId":{"type":"string","format":"uuid"},"asOf":{"type":"string","format":"date-time"}}}'::jsonb
  ),
  (
    'ac420e48-450c-48b4-9920-f0684122a942',
    'pos.z-report',
    'Z report',
    'Final operational totals and counted cash for one closed cashier shift.',
    'pos.z-report.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"required":["shiftId"],"properties":{"shiftId":{"type":"string","format":"uuid"}}}'::jsonb
  ),
  (
    '8837dcef-b948-4482-8d0c-54b54976508f',
    'pos.product-sales',
    'Product sales',
    'Sold and returned quantities and revenue by product.',
    'pos.product-sales.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"required":["dateFrom","dateTo"],"properties":{"dateFrom":{"type":"string","format":"date"},"dateTo":{"type":"string","format":"date"},"businessLocationId":{"type":"string","format":"uuid"},"cashRegisterId":{"type":"string","format":"uuid"},"operatorId":{"type":"string","format":"uuid"}}}'::jsonb
  ),
  (
    'c21c2ee9-e6f6-4b78-80bf-1e03c992eab4',
    'pos.category-sales',
    'Category sales',
    'Sold and returned quantities and revenue by product category.',
    'pos.category-sales.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"required":["dateFrom","dateTo"],"properties":{"dateFrom":{"type":"string","format":"date"},"dateTo":{"type":"string","format":"date"},"businessLocationId":{"type":"string","format":"uuid"},"cashRegisterId":{"type":"string","format":"uuid"},"operatorId":{"type":"string","format":"uuid"}}}'::jsonb
  ),
  (
    'e35697fd-0586-441c-8884-c9a03ba64505',
    'pos.payment-methods',
    'Payment methods',
    'Collected, refunded, and net values for cash and bank card payments.',
    'pos.payment-methods.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"required":["dateFrom","dateTo"],"properties":{"dateFrom":{"type":"string","format":"date"},"dateTo":{"type":"string","format":"date"},"businessLocationId":{"type":"string","format":"uuid"},"cashRegisterId":{"type":"string","format":"uuid"},"operatorId":{"type":"string","format":"uuid"}}}'::jsonb
  ),
  (
    'c389fcf1-11b0-46b7-a7f2-f7b64e1773dd',
    'pos.location-sales',
    'Location sales',
    'Sales, returns, and net revenue by business location.',
    'pos.location-sales.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"required":["dateFrom","dateTo"],"properties":{"dateFrom":{"type":"string","format":"date"},"dateTo":{"type":"string","format":"date"},"businessLocationId":{"type":"string","format":"uuid"}}}'::jsonb
  ),
  (
    '5a084d2c-622a-473b-889c-76984a66af96',
    'pos.location-comparison',
    'Location comparison',
    'Comparable transaction count and revenue measures across business locations.',
    'pos.location-comparison.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"required":["dateFrom","dateTo"],"properties":{"dateFrom":{"type":"string","format":"date"},"dateTo":{"type":"string","format":"date"}}}'::jsonb
  );

COMMENT ON TABLE pos.quick_access_products IS
  'Cash-register product shortcuts. Prices and availability always remain live ERP values.';
COMMENT ON COLUMN pos.sale_lines.category_name IS
  'Category label captured at checkout so historical POS reports do not change after catalog edits.';
