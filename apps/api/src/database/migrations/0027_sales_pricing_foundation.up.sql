CREATE TABLE sales.customer_price_groups (
  id uuid PRIMARY KEY,
  code varchar(40) NOT NULL UNIQUE,
  name varchar(150) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_customer_group_code_trimmed CHECK (
    code = btrim(code) AND code = upper(code) AND char_length(code) > 0
  ),
  CONSTRAINT sales_customer_group_name_trimmed CHECK (
    name = btrim(name) AND char_length(name) > 0
  ),
  CONSTRAINT sales_customer_group_version_positive CHECK (version > 0)
);

CREATE UNIQUE INDEX sales_customer_price_groups_name_unique
  ON sales.customer_price_groups (lower(name));

CREATE TABLE sales.customer_price_group_members (
  customer_group_id uuid NOT NULL REFERENCES sales.customer_price_groups(id) ON DELETE RESTRICT,
  customer_partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  assigned_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_group_id, customer_partner_id)
);

CREATE INDEX sales_customer_price_group_members_customer_idx
  ON sales.customer_price_group_members (customer_partner_id, customer_group_id);

CREATE TABLE sales.promotional_campaigns (
  id uuid PRIMARY KEY,
  code varchar(40) NOT NULL UNIQUE,
  name varchar(150) NOT NULL,
  valid_from date NOT NULL,
  valid_to date NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_campaign_code_trimmed CHECK (
    code = btrim(code) AND code = upper(code) AND char_length(code) > 0
  ),
  CONSTRAINT sales_campaign_name_trimmed CHECK (
    name = btrim(name) AND char_length(name) > 0
  ),
  CONSTRAINT sales_campaign_dates_valid CHECK (valid_to >= valid_from),
  CONSTRAINT sales_campaign_version_positive CHECK (version > 0)
);

CREATE TABLE sales.price_lists (
  id uuid PRIMARY KEY,
  code varchar(40) NOT NULL UNIQUE,
  name varchar(150) NOT NULL,
  scope varchar(30) NOT NULL,
  customer_group_id uuid REFERENCES sales.customer_price_groups(id) ON DELETE RESTRICT,
  customer_partner_id uuid REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  campaign_id uuid REFERENCES sales.promotional_campaigns(id) ON DELETE RESTRICT,
  currency_code char(3) NOT NULL,
  valid_from date NOT NULL,
  valid_to date NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_price_list_code_trimmed CHECK (
    code = btrim(code) AND code = upper(code) AND char_length(code) > 0
  ),
  CONSTRAINT sales_price_list_name_trimmed CHECK (
    name = btrim(name) AND char_length(name) > 0
  ),
  CONSTRAINT sales_price_list_scope_valid CHECK (
    scope IN ('all_customers', 'customer_group', 'customer')
  ),
  CONSTRAINT sales_price_list_scope_target_valid CHECK (
    (scope = 'all_customers' AND customer_group_id IS NULL AND customer_partner_id IS NULL)
    OR (scope = 'customer_group' AND customer_group_id IS NOT NULL AND customer_partner_id IS NULL)
    OR (scope = 'customer' AND customer_group_id IS NULL AND customer_partner_id IS NOT NULL)
  ),
  CONSTRAINT sales_price_list_currency_uppercase CHECK (currency_code = upper(currency_code)),
  CONSTRAINT sales_price_list_dates_valid CHECK (valid_to >= valid_from),
  CONSTRAINT sales_price_list_priority_valid CHECK (priority BETWEEN -1000 AND 1000),
  CONSTRAINT sales_price_list_version_positive CHECK (version > 0)
);

CREATE INDEX sales_price_lists_effective_idx
  ON sales.price_lists (active, valid_from, valid_to, priority DESC);

CREATE INDEX sales_price_lists_customer_idx
  ON sales.price_lists (customer_partner_id, active, valid_from, valid_to);

CREATE INDEX sales_price_lists_group_idx
  ON sales.price_lists (customer_group_id, active, valid_from, valid_to);

CREATE TABLE sales.price_list_lines (
  id uuid PRIMARY KEY,
  price_list_id uuid NOT NULL REFERENCES sales.price_lists(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES master_data.products(id) ON DELETE RESTRICT,
  unit_price numeric(18, 4) NOT NULL,
  CONSTRAINT sales_price_list_line_unique UNIQUE (price_list_id, product_id),
  CONSTRAINT sales_price_list_line_price_nonnegative CHECK (unit_price >= 0)
);

CREATE INDEX sales_price_list_lines_product_idx
  ON sales.price_list_lines (product_id, price_list_id);

COMMENT ON COLUMN sales.price_lists.priority IS
  'User-controlled precedence. Higher values win; equal values fall back to customer specificity and stable price-list code order.';
COMMENT ON TABLE sales.price_list_lines IS
  'Future transaction prices only. Quotations and posted documents retain their own immutable price snapshots.';
