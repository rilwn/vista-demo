CREATE TABLE master_data.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code varchar(80) NOT NULL,
  name varchar(255) NOT NULL,
  category_id uuid NOT NULL REFERENCES master_data.product_categories(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL REFERENCES master_data.units(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_code_trimmed CHECK (product_code = btrim(product_code) AND char_length(product_code) > 0),
  CONSTRAINT product_name_trimmed CHECK (name = btrim(name) AND char_length(name) > 0),
  CONSTRAINT product_version_positive CHECK (version > 0)
);

CREATE UNIQUE INDEX products_code_unique ON master_data.products (upper(product_code));
CREATE INDEX products_category_active_idx ON master_data.products (category_id, active, name, id);

CREATE TABLE master_data.product_barcodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES master_data.products(id) ON DELETE RESTRICT,
  barcode varchar(80) NOT NULL,
  barcode_type varchar(20) NOT NULL DEFAULT 'other',
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_barcode_trimmed CHECK (barcode = btrim(barcode) AND char_length(barcode) > 0),
  CONSTRAINT product_barcode_type_valid CHECK (barcode_type IN ('ean13', 'ean8', 'upca', 'code128', 'other'))
);

CREATE UNIQUE INDEX product_barcodes_value_unique ON master_data.product_barcodes (barcode);
CREATE INDEX product_barcodes_product_idx ON master_data.product_barcodes (product_id, active);
