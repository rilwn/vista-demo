CREATE SCHEMA IF NOT EXISTS organization;

CREATE TABLE organization.legal_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(30) NOT NULL,
  name varchar(255) NOT NULL,
  uic varchar(30),
  vat_number varchar(30),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_entity_code_trimmed CHECK (code = btrim(code) AND char_length(code) > 0),
  CONSTRAINT legal_entity_name_trimmed CHECK (name = btrim(name) AND char_length(name) > 0),
  CONSTRAINT legal_entity_uic_trimmed CHECK (uic IS NULL OR (uic = btrim(uic) AND char_length(uic) > 0)),
  CONSTRAINT legal_entity_vat_trimmed CHECK (vat_number IS NULL OR (vat_number = upper(btrim(vat_number)) AND char_length(vat_number) > 0)),
  CONSTRAINT legal_entity_version_positive CHECK (version > 0)
);

CREATE UNIQUE INDEX legal_entities_code_unique
  ON organization.legal_entities (upper(code));
CREATE UNIQUE INDEX legal_entities_uic_unique
  ON organization.legal_entities (upper(uic)) WHERE uic IS NOT NULL;

CREATE TABLE organization.branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL REFERENCES organization.legal_entities(id) ON DELETE RESTRICT,
  code varchar(30) NOT NULL,
  name varchar(255) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branch_code_trimmed CHECK (code = btrim(code) AND char_length(code) > 0),
  CONSTRAINT branch_name_trimmed CHECK (name = btrim(name) AND char_length(name) > 0),
  CONSTRAINT branch_version_positive CHECK (version > 0)
);

CREATE UNIQUE INDEX branches_entity_code_unique
  ON organization.branches (legal_entity_id, upper(code));

CREATE TABLE organization.business_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES organization.branches(id) ON DELETE RESTRICT,
  code varchar(30) NOT NULL,
  name varchar(255) NOT NULL,
  location_type varchar(100) NOT NULL,
  address_line_1 varchar(255) NOT NULL,
  address_line_2 varchar(255),
  city varchar(150) NOT NULL,
  postal_code varchar(30),
  country_code char(2) NOT NULL DEFAULT 'BG',
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_location_code_trimmed CHECK (code = btrim(code) AND char_length(code) > 0),
  CONSTRAINT business_location_name_trimmed CHECK (name = btrim(name) AND char_length(name) > 0),
  CONSTRAINT business_location_type_trimmed CHECK (location_type = btrim(location_type) AND char_length(location_type) > 0),
  CONSTRAINT business_location_address_trimmed CHECK (address_line_1 = btrim(address_line_1) AND char_length(address_line_1) > 0),
  CONSTRAINT business_location_city_trimmed CHECK (city = btrim(city) AND char_length(city) > 0),
  CONSTRAINT business_location_country_normalized CHECK (country_code = upper(country_code)),
  CONSTRAINT business_location_version_positive CHECK (version > 0)
);

CREATE UNIQUE INDEX business_locations_code_unique
  ON organization.business_locations (upper(code));

CREATE TABLE organization.cash_registers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_location_id uuid NOT NULL REFERENCES organization.business_locations(id) ON DELETE RESTRICT,
  code varchar(30) NOT NULL,
  name varchar(120) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_register_code_trimmed CHECK (code = btrim(code) AND char_length(code) > 0),
  CONSTRAINT cash_register_name_trimmed CHECK (name = btrim(name) AND char_length(name) > 0),
  CONSTRAINT cash_register_version_positive CHECK (version > 0),
  CONSTRAINT cash_register_id_location_unique UNIQUE (id, business_location_id)
);

CREATE UNIQUE INDEX cash_registers_location_code_unique
  ON organization.cash_registers (business_location_id, upper(code));

CREATE TABLE organization.operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_location_id uuid NOT NULL REFERENCES organization.business_locations(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  code varchar(30) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operator_code_trimmed CHECK (code = btrim(code) AND char_length(code) > 0),
  CONSTRAINT operator_version_positive CHECK (version > 0),
  CONSTRAINT operator_id_location_unique UNIQUE (id, business_location_id),
  CONSTRAINT operator_location_account_unique UNIQUE (business_location_id, account_id)
);

CREATE UNIQUE INDEX operators_location_code_unique
  ON organization.operators (business_location_id, upper(code));

CREATE TABLE organization.cash_register_operators (
  cash_register_id uuid NOT NULL,
  operator_id uuid NOT NULL,
  business_location_id uuid NOT NULL,
  assigned_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (cash_register_id, operator_id),
  CONSTRAINT cash_register_operator_register_location_fk
    FOREIGN KEY (cash_register_id, business_location_id)
    REFERENCES organization.cash_registers(id, business_location_id) ON DELETE RESTRICT,
  CONSTRAINT cash_register_operator_operator_location_fk
    FOREIGN KEY (operator_id, business_location_id)
    REFERENCES organization.operators(id, business_location_id) ON DELETE RESTRICT
);

ALTER TABLE master_data.warehouses
  ADD COLUMN business_location_id uuid REFERENCES organization.business_locations(id) ON DELETE RESTRICT,
  ADD COLUMN technician_operator_id uuid,
  ADD CONSTRAINT warehouse_technician_operator_location_fk
    FOREIGN KEY (technician_operator_id, business_location_id)
    REFERENCES organization.operators(id, business_location_id) ON DELETE RESTRICT;

CREATE INDEX warehouses_business_location_idx
  ON master_data.warehouses (business_location_id) WHERE active;

