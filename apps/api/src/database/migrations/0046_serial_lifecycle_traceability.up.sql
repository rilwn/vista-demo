ALTER TABLE sales.handover_certificates
  ADD COLUMN customer_location_id uuid
    REFERENCES master_data.customer_locations(id) ON DELETE RESTRICT;

ALTER TABLE sales.handover_certificates
  ADD CONSTRAINT handover_certificate_location_customer_fk
    FOREIGN KEY (customer_location_id, customer_partner_id)
    REFERENCES master_data.customer_locations(id, partner_id) ON DELETE RESTRICT;

CREATE INDEX handover_certificate_customer_location_idx
  ON sales.handover_certificates (customer_location_id, accepted_at DESC, id)
  WHERE customer_location_id IS NOT NULL;

COMMENT ON COLUMN sales.handover_certificates.customer_location_id IS
  'Customer location receiving the sold equipment. New serialised handovers register the installed item against this location when acceptance is recorded.';
