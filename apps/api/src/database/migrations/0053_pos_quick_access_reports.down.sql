DELETE FROM reporting.report_definitions
WHERE definition_key IN (
  'pos.shift-register',
  'pos.cashier-performance',
  'pos.x-report',
  'pos.z-report',
  'pos.product-sales',
  'pos.category-sales',
  'pos.payment-methods',
  'pos.location-sales',
  'pos.location-comparison'
);

ALTER TABLE pos.return_lines
  DROP COLUMN IF EXISTS category_name,
  DROP COLUMN IF EXISTS category_id;

ALTER TABLE pos.sale_lines
  DROP COLUMN IF EXISTS category_name,
  DROP COLUMN IF EXISTS category_id;

DROP TABLE IF EXISTS pos.quick_access_products;
