DROP TABLE IF EXISTS sales.handover_certificate_lines;
DROP TABLE IF EXISTS sales.handover_certificates;
DROP TABLE IF EXISTS sales.subscription_invoice_drafts;
DROP TABLE IF EXISTS sales.service_subscription_services;
DROP TABLE IF EXISTS sales.service_subscription_devices;
DROP TABLE IF EXISTS sales.service_subscription_contracts;

ALTER TABLE master_data.customer_equipment
  DROP CONSTRAINT IF EXISTS customer_equipment_id_location_unique;
ALTER TABLE master_data.customer_locations
  DROP CONSTRAINT IF EXISTS customer_locations_id_partner_unique;

ALTER TABLE sales.internal_document_sequences
  DROP CONSTRAINT sales_internal_sequence_type_valid;

ALTER TABLE sales.internal_document_sequences
  ADD CONSTRAINT sales_internal_sequence_type_valid CHECK (
    document_type IN ('quotation', 'order', 'shipment', 'invoice_draft')
  );
