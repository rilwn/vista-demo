DROP INDEX IF EXISTS sales.handover_certificate_customer_location_idx;

ALTER TABLE sales.handover_certificates
  DROP CONSTRAINT IF EXISTS handover_certificate_location_customer_fk,
  DROP COLUMN IF EXISTS customer_location_id;
