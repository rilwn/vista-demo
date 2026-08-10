DROP INDEX IF EXISTS master_data.warehouses_business_location_idx;

ALTER TABLE master_data.warehouses
  DROP CONSTRAINT IF EXISTS warehouse_technician_operator_location_fk,
  DROP COLUMN IF EXISTS technician_operator_id,
  DROP COLUMN IF EXISTS business_location_id;

DROP SCHEMA IF EXISTS organization CASCADE;
