ALTER TABLE master_data.product_categories
  ADD COLUMN tracking_mode varchar(20) NOT NULL DEFAULT 'none',
  ADD COLUMN requires_expiry boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT product_category_tracking_mode_valid CHECK (tracking_mode IN ('none', 'serial', 'batch')),
  ADD CONSTRAINT product_category_expiry_requires_batch CHECK (
    requires_expiry = false OR tracking_mode = 'batch'
  );

CREATE TABLE master_data.units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(30) NOT NULL,
  name varchar(100) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unit_code_trimmed CHECK (code = btrim(code) AND char_length(code) > 0),
  CONSTRAINT unit_name_trimmed CHECK (name = btrim(name) AND char_length(name) > 0),
  CONSTRAINT unit_code_uppercase CHECK (code = upper(code)),
  CONSTRAINT unit_version_positive CHECK (version > 0)
);

CREATE UNIQUE INDEX units_code_unique ON master_data.units (code);
CREATE UNIQUE INDEX units_name_unique ON master_data.units (lower(name));

COMMENT ON COLUMN master_data.product_categories.tracking_mode IS
  'Configurable inventory traceability invariant. Serialised product categories must not be posted without a serial.';
COMMENT ON COLUMN master_data.product_categories.requires_expiry IS
  'Expiry is permitted only for batch-tracked catalog categories.';
