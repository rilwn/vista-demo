DROP TABLE IF EXISTS master_data.units;
ALTER TABLE master_data.product_categories
  DROP CONSTRAINT IF EXISTS product_category_expiry_requires_batch,
  DROP CONSTRAINT IF EXISTS product_category_tracking_mode_valid,
  DROP COLUMN IF EXISTS requires_expiry,
  DROP COLUMN IF EXISTS tracking_mode;
