ALTER TABLE master_data.partner_contacts
  ADD CONSTRAINT partner_contacts_id_partner_unique UNIQUE (id, partner_id);

CREATE TABLE master_data.customer_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  name varchar(255) NOT NULL,
  normalized_name varchar(255) GENERATED ALWAYS AS (
    lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))
  ) STORED,
  location_type varchar(100) NOT NULL,
  address_line_1 varchar(255) NOT NULL,
  address_line_2 varchar(255),
  city varchar(150) NOT NULL,
  postal_code varchar(30),
  country_code char(2) NOT NULL DEFAULT 'BG',
  responsible_contact_id uuid,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_location_contact_same_partner
    FOREIGN KEY (responsible_contact_id, partner_id)
    REFERENCES master_data.partner_contacts(id, partner_id) ON DELETE RESTRICT,
  CONSTRAINT customer_location_name_trimmed CHECK (
    name = btrim(name) AND char_length(name) > 0
  ),
  CONSTRAINT customer_location_type_trimmed CHECK (
    location_type = btrim(location_type) AND char_length(location_type) > 0
  ),
  CONSTRAINT customer_location_address_trimmed CHECK (
    address_line_1 = btrim(address_line_1) AND char_length(address_line_1) > 0
  ),
  CONSTRAINT customer_location_city_trimmed CHECK (
    city = btrim(city) AND char_length(city) > 0
  ),
  CONSTRAINT customer_location_country_uppercase CHECK (country_code = upper(country_code)),
  CONSTRAINT customer_location_version_positive CHECK (version > 0)
);

CREATE UNIQUE INDEX customer_locations_partner_name_unique
  ON master_data.customer_locations (partner_id, normalized_name)
  WHERE active;
CREATE INDEX customer_locations_partner_active_idx
  ON master_data.customer_locations (partner_id, active, normalized_name, id);

CREATE TABLE master_data.customer_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_location_id uuid NOT NULL
    REFERENCES master_data.customer_locations(id) ON DELETE RESTRICT,
  product_id uuid REFERENCES master_data.products(id) ON DELETE RESTRICT,
  serialized_item_id uuid UNIQUE REFERENCES inventory.serialized_items(id) ON DELETE RESTRICT,
  device_name varchar(255) NOT NULL,
  serial_number varchar(120) NOT NULL,
  purchase_date date NOT NULL,
  warranty_start_date date NOT NULL,
  warranty_end_date date,
  status varchar(30) NOT NULL DEFAULT 'active',
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_equipment_name_trimmed CHECK (
    device_name = btrim(device_name) AND char_length(device_name) > 0
  ),
  CONSTRAINT customer_equipment_serial_trimmed CHECK (
    serial_number = btrim(serial_number) AND char_length(serial_number) > 0
  ),
  CONSTRAINT customer_equipment_status_valid CHECK (
    status IN ('active', 'under_repair', 'retired')
  ),
  CONSTRAINT customer_equipment_warranty_period_valid CHECK (
    warranty_end_date IS NULL OR warranty_end_date >= warranty_start_date
  ),
  CONSTRAINT customer_equipment_version_positive CHECK (version > 0)
);

CREATE UNIQUE INDEX customer_equipment_serial_unique
  ON master_data.customer_equipment (upper(serial_number));
CREATE INDEX customer_equipment_location_active_idx
  ON master_data.customer_equipment (customer_location_id, active, device_name, id);
CREATE INDEX customer_equipment_product_idx
  ON master_data.customer_equipment (product_id, status)
  WHERE product_id IS NOT NULL;

COMMENT ON TABLE master_data.customer_locations IS
  'Customer-owned operational sites with address and responsible-contact context.';
COMMENT ON TABLE master_data.customer_equipment IS
  'Installed equipment register. Serial identity is immutable and may link to ERP inventory.';
