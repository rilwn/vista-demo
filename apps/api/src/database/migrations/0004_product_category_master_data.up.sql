CREATE TABLE master_data.product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES master_data.product_categories(id) ON DELETE RESTRICT,
  name varchar(150) NOT NULL,
  normalized_name varchar(150) GENERATED ALWAYS AS (
    lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))
  ) STORED,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_category_name_trimmed CHECK (
    name = btrim(name) AND char_length(name) > 0
  ),
  CONSTRAINT product_category_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id),
  CONSTRAINT product_category_version_positive CHECK (version > 0)
);

CREATE UNIQUE INDEX product_categories_name_per_parent_unique
  ON master_data.product_categories (COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), normalized_name);
CREATE INDEX product_categories_parent_active_idx
  ON master_data.product_categories (parent_id, active, normalized_name, id);

COMMENT ON TABLE master_data.product_categories IS
  'ERP-owned hierarchy for catalog classification. Categories are configuration, not a substitute for product tracking policy.';
