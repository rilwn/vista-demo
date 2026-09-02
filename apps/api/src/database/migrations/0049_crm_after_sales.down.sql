DROP TABLE IF EXISTS crm.referrals;
DROP TABLE IF EXISTS crm.customer_surveys;
DROP TABLE IF EXISTS crm.warranty_cards;

ALTER TABLE master_data.products
  DROP CONSTRAINT IF EXISTS product_warranty_months_valid,
  DROP COLUMN IF EXISTS warranty_months;
