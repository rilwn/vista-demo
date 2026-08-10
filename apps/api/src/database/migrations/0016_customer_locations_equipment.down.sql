DROP TABLE IF EXISTS master_data.customer_equipment;
DROP TABLE IF EXISTS master_data.customer_locations;
ALTER TABLE master_data.partner_contacts
  DROP CONSTRAINT IF EXISTS partner_contacts_id_partner_unique;
