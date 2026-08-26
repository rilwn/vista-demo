DROP TABLE IF EXISTS service.subscription_visit_generations;
DROP TABLE IF EXISTS service.equipment_inspection_records;
DROP TABLE IF EXISTS service.equipment_inspection_plans;
DROP TABLE IF EXISTS service.warranty_claim_status_history;
DROP TABLE IF EXISTS service.warranty_claims;

ALTER TABLE service.requests
  DROP CONSTRAINT service_request_source_channel_valid;

ALTER TABLE service.requests
  ADD CONSTRAINT service_request_source_channel_valid CHECK (
    source_channel IN ('telephone', 'email', 'customer_portal', 'on_site')
  );
