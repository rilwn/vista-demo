CREATE SCHEMA IF NOT EXISTS master_data;

CREATE TABLE master_data.partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind varchar(30) NOT NULL,
  display_name varchar(255) NOT NULL,
  normalized_name varchar(255) GENERATED ALWAYS AS (
    lower(regexp_replace(btrim(display_name), '[[:space:]]+', ' ', 'g'))
  ) STORED,
  uic varchar(50),
  vat_number varchar(50),
  company_representative varchar(255),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_kind_valid CHECK (kind IN ('legal_entity', 'individual')),
  CONSTRAINT partner_display_name_trimmed CHECK (
    display_name = btrim(display_name) AND char_length(display_name) > 0
  ),
  CONSTRAINT partner_uic_not_blank CHECK (uic IS NULL OR char_length(btrim(uic)) > 0),
  CONSTRAINT partner_vat_number_not_blank CHECK (
    vat_number IS NULL OR char_length(btrim(vat_number)) > 0
  ),
  CONSTRAINT partner_version_positive CHECK (version > 0)
);

CREATE UNIQUE INDEX partners_uic_unique
  ON master_data.partners (upper(btrim(uic)))
  WHERE uic IS NOT NULL;
CREATE INDEX partners_normalized_name_idx ON master_data.partners (normalized_name);
CREATE INDEX partners_active_name_idx
  ON master_data.partners (active, normalized_name, id);

CREATE TABLE master_data.partner_roles (
  partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  role varchar(30) NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  PRIMARY KEY (partner_id, role),
  CONSTRAINT partner_role_valid CHECK (role IN ('customer', 'supplier', 'partner'))
);

CREATE INDEX partner_roles_role_idx ON master_data.partner_roles (role, partner_id);

CREATE TABLE master_data.partner_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  address_type varchar(30) NOT NULL,
  address_line_1 varchar(255) NOT NULL,
  address_line_2 varchar(255),
  city varchar(150) NOT NULL,
  postal_code varchar(30),
  country_code char(2) NOT NULL DEFAULT 'BG',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_address_type_valid CHECK (
    address_type IN ('registered', 'billing', 'delivery', 'other')
  ),
  CONSTRAINT partner_address_country_uppercase CHECK (country_code = upper(country_code))
);

CREATE INDEX partner_addresses_partner_idx
  ON master_data.partner_addresses (partner_id, active, address_type);

CREATE TABLE master_data.partner_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  display_name varchar(255) NOT NULL,
  job_title varchar(150),
  telephone varchar(100),
  email varchar(320),
  contact_role varchar(100),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_contact_channel_present CHECK (
    telephone IS NOT NULL OR email IS NOT NULL
  ),
  CONSTRAINT partner_contact_email_normalized CHECK (email IS NULL OR email = lower(email))
);

CREATE INDEX partner_contacts_partner_idx
  ON master_data.partner_contacts (partner_id, active, display_name);

CREATE TABLE master_data.partner_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  iban varchar(64) NOT NULL,
  bic varchar(20),
  bank_name varchar(255),
  currency_code char(3) NOT NULL DEFAULT 'BGN',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_bank_currency_uppercase CHECK (currency_code = upper(currency_code))
);

CREATE UNIQUE INDEX partner_bank_accounts_iban_unique
  ON master_data.partner_bank_accounts (upper(replace(iban, ' ', '')));
CREATE INDEX partner_bank_accounts_partner_idx
  ON master_data.partner_bank_accounts (partner_id, active);

COMMENT ON SCHEMA master_data IS 'ERP-owned shared operational master data for ERP, CRM, POS, and service modules.';
COMMENT ON TABLE master_data.partners IS 'Canonical partner identity. Duplicate resolution must never merge records silently.';
COMMENT ON TABLE master_data.partner_roles IS 'A canonical partner may simultaneously be a customer, supplier, and other business partner.';
