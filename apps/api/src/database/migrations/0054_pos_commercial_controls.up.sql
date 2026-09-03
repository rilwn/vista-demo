CREATE TABLE sales.pos_commercial_rules (
  id uuid PRIMARY KEY,
  code varchar(40) NOT NULL UNIQUE,
  name varchar(150) NOT NULL,
  rule_type varchar(20) NOT NULL,
  discount_type varchar(20) NOT NULL,
  discount_value numeric(18, 4) NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  valid_from date NOT NULL,
  valid_to date NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_pos_rule_type_valid CHECK (rule_type IN ('quantity', 'bundle')),
  CONSTRAINT sales_pos_rule_discount_type_valid CHECK (
    discount_type IN ('percentage', 'fixed_amount')
  ),
  CONSTRAINT sales_pos_rule_discount_value_valid CHECK (
    discount_value > 0
      AND (discount_type <> 'percentage' OR discount_value <= 100)
  ),
  CONSTRAINT sales_pos_rule_period_valid CHECK (valid_to >= valid_from),
  CONSTRAINT sales_pos_rule_priority_valid CHECK (priority BETWEEN -1000 AND 1000),
  CONSTRAINT sales_pos_rule_version_positive CHECK (version > 0),
  CONSTRAINT sales_pos_rule_code_trimmed CHECK (
    code = upper(btrim(code)) AND char_length(code) > 0
  ),
  CONSTRAINT sales_pos_rule_name_trimmed CHECK (
    name = btrim(name) AND char_length(name) > 0
  )
);

CREATE TABLE sales.pos_commercial_rule_items (
  rule_id uuid NOT NULL REFERENCES sales.pos_commercial_rules(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES master_data.products(id) ON DELETE RESTRICT,
  required_quantity numeric(18, 4) NOT NULL,
  PRIMARY KEY (rule_id, product_id),
  CONSTRAINT sales_pos_rule_item_quantity_positive CHECK (required_quantity > 0)
);

CREATE INDEX sales_pos_commercial_rules_active_idx
  ON sales.pos_commercial_rules (active, valid_from, valid_to, priority DESC, code);

CREATE TABLE pos.loyalty_programs (
  id uuid PRIMARY KEY,
  code varchar(40) NOT NULL UNIQUE,
  name varchar(150) NOT NULL,
  earn_points_per_bgn integer NOT NULL,
  redemption_value_bgn numeric(18, 4) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  valid_from date NOT NULL,
  valid_to date,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_loyalty_program_earn_positive CHECK (earn_points_per_bgn > 0),
  CONSTRAINT pos_loyalty_program_redemption_positive CHECK (redemption_value_bgn > 0),
  CONSTRAINT pos_loyalty_program_period_valid CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT pos_loyalty_program_version_positive CHECK (version > 0)
);

CREATE UNIQUE INDEX pos_loyalty_one_active_program
  ON pos.loyalty_programs ((active)) WHERE active;

CREATE TABLE pos.loyalty_accounts (
  id uuid PRIMARY KEY,
  program_id uuid NOT NULL REFERENCES pos.loyalty_programs(id) ON DELETE RESTRICT,
  customer_partner_id uuid NOT NULL UNIQUE
    REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  card_number varchar(80) NOT NULL UNIQUE,
  status varchar(20) NOT NULL DEFAULT 'active',
  enrolled_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_loyalty_account_status_valid CHECK (status IN ('active', 'suspended')),
  CONSTRAINT pos_loyalty_card_trimmed CHECK (
    card_number = upper(btrim(card_number)) AND char_length(card_number) > 0
  )
);

CREATE TABLE pos.loyalty_points_ledger (
  id uuid PRIMARY KEY,
  loyalty_account_id uuid NOT NULL REFERENCES pos.loyalty_accounts(id) ON DELETE RESTRICT,
  entry_type varchar(30) NOT NULL,
  points integer NOT NULL,
  sale_id uuid REFERENCES pos.sales(id) ON DELETE RESTRICT,
  return_id uuid REFERENCES pos.returns(id) ON DELETE RESTRICT,
  source_entry_id uuid REFERENCES pos.loyalty_points_ledger(id) ON DELETE RESTRICT,
  reason varchar(500) NOT NULL,
  actor_account_id uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  correlation_id varchar(128) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_loyalty_entry_type_valid CHECK (
    entry_type IN ('earned', 'redeemed', 'earned_reversed', 'redemption_restored', 'adjustment')
  ),
  CONSTRAINT pos_loyalty_points_nonzero CHECK (points <> 0),
  CONSTRAINT pos_loyalty_entry_sign_valid CHECK (
    (entry_type IN ('earned', 'redemption_restored') AND points > 0)
    OR (entry_type IN ('redeemed', 'earned_reversed') AND points < 0)
    OR entry_type = 'adjustment'
  ),
  CONSTRAINT pos_loyalty_entry_source_valid CHECK (
    (entry_type IN ('earned', 'redeemed') AND sale_id IS NOT NULL AND return_id IS NULL)
    OR (entry_type IN ('earned_reversed', 'redemption_restored')
      AND sale_id IS NOT NULL AND return_id IS NOT NULL AND source_entry_id IS NOT NULL)
    OR entry_type = 'adjustment'
  )
);

CREATE UNIQUE INDEX pos_loyalty_sale_entry_unique
  ON pos.loyalty_points_ledger (sale_id, entry_type)
  WHERE sale_id IS NOT NULL AND return_id IS NULL;
CREATE UNIQUE INDEX pos_loyalty_return_entry_unique
  ON pos.loyalty_points_ledger (return_id, entry_type)
  WHERE return_id IS NOT NULL;
CREATE INDEX pos_loyalty_ledger_account_idx
  ON pos.loyalty_points_ledger (loyalty_account_id, occurred_at, id);

CREATE TABLE pos.discount_authorizations (
  id uuid PRIMARY KEY,
  shift_id uuid NOT NULL REFERENCES pos.shifts(id) ON DELETE RESTRICT,
  cashier_account_id uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  approver_account_id uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  discount_type varchar(20) NOT NULL,
  discount_value numeric(18, 4) NOT NULL,
  reason varchar(500) NOT NULL,
  basket_digest char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_by_sale_id uuid UNIQUE REFERENCES pos.sales(id) ON DELETE RESTRICT,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_discount_authorization_type_valid CHECK (
    discount_type IN ('percentage', 'fixed_amount')
  ),
  CONSTRAINT pos_discount_authorization_value_valid CHECK (
    discount_value > 0
      AND (discount_type <> 'percentage' OR discount_value <= 100)
  ),
  CONSTRAINT pos_discount_authorization_reason_trimmed CHECK (
    reason = btrim(reason) AND char_length(reason) BETWEEN 3 AND 500
  ),
  CONSTRAINT pos_discount_authorization_lifecycle_valid CHECK (
    (consumed_by_sale_id IS NULL AND consumed_at IS NULL)
    OR (consumed_by_sale_id IS NOT NULL AND consumed_at IS NOT NULL)
  )
);

CREATE INDEX pos_discount_authorizations_open_idx
  ON pos.discount_authorizations (shift_id, cashier_account_id, expires_at)
  WHERE consumed_by_sale_id IS NULL;

ALTER TABLE pos.sales
  ADD COLUMN base_net_total numeric(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN automatic_discount_total numeric(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN manual_discount_total numeric(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN loyalty_discount_total numeric(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN loyalty_points_earned integer NOT NULL DEFAULT 0,
  ADD COLUMN loyalty_points_redeemed integer NOT NULL DEFAULT 0,
  ADD COLUMN discount_authorization_id uuid
    REFERENCES pos.discount_authorizations(id) ON DELETE RESTRICT,
  ADD CONSTRAINT pos_sale_commercial_totals_nonnegative CHECK (
    base_net_total >= 0 AND automatic_discount_total >= 0
      AND manual_discount_total >= 0 AND loyalty_discount_total >= 0
      AND loyalty_points_earned >= 0 AND loyalty_points_redeemed >= 0
  );

UPDATE pos.sales SET base_net_total = net_total;

ALTER TABLE pos.sale_lines
  ADD COLUMN base_net_total numeric(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN automatic_discount_total numeric(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN manual_discount_total numeric(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN loyalty_discount_total numeric(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN pricing_adjustments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT pos_sale_line_commercial_totals_nonnegative CHECK (
    base_net_total >= 0 AND automatic_discount_total >= 0
      AND manual_discount_total >= 0 AND loyalty_discount_total >= 0
  );

UPDATE pos.sale_lines SET base_net_total = net_total;

ALTER TABLE pos.returns
  ADD COLUMN loyalty_points_earned_reversed integer NOT NULL DEFAULT 0,
  ADD COLUMN loyalty_points_redeemed_restored integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT pos_return_loyalty_points_nonnegative CHECK (
    loyalty_points_earned_reversed >= 0 AND loyalty_points_redeemed_restored >= 0
  );

COMMENT ON TABLE sales.pos_commercial_rules IS
  'Dated ERP-owned quantity and bundle discounts. Checkout snapshots applied adjustments on sale lines.';
COMMENT ON TABLE pos.loyalty_points_ledger IS
  'Append-only source of truth for loyalty balances; balances are always derived from signed entries.';
COMMENT ON TABLE pos.discount_authorizations IS
  'Single-use manual discount approvals bound to the exact cashier basket digest.';
