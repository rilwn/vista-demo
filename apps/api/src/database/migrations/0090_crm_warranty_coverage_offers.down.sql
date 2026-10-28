DROP TRIGGER IF EXISTS crm_warranty_coverage_offer_snapshot_immutable
  ON crm.warranty_coverage_offers;
DROP FUNCTION IF EXISTS crm.prevent_warranty_coverage_offer_snapshot_change();
DROP TABLE IF EXISTS crm.warranty_coverage_offers;
