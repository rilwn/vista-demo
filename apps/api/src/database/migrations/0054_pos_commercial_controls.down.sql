ALTER TABLE pos.returns
  DROP CONSTRAINT pos_return_loyalty_points_nonnegative,
  DROP COLUMN loyalty_points_redeemed_restored,
  DROP COLUMN loyalty_points_earned_reversed;

ALTER TABLE pos.sale_lines
  DROP CONSTRAINT pos_sale_line_commercial_totals_nonnegative,
  DROP COLUMN pricing_adjustments,
  DROP COLUMN loyalty_discount_total,
  DROP COLUMN manual_discount_total,
  DROP COLUMN automatic_discount_total,
  DROP COLUMN base_net_total;

ALTER TABLE pos.sales
  DROP CONSTRAINT pos_sale_commercial_totals_nonnegative,
  DROP COLUMN discount_authorization_id,
  DROP COLUMN loyalty_points_redeemed,
  DROP COLUMN loyalty_points_earned,
  DROP COLUMN loyalty_discount_total,
  DROP COLUMN manual_discount_total,
  DROP COLUMN automatic_discount_total,
  DROP COLUMN base_net_total;

DROP TABLE pos.discount_authorizations;
DROP TABLE pos.loyalty_points_ledger;
DROP TABLE pos.loyalty_accounts;
DROP TABLE pos.loyalty_programs;
DROP TABLE sales.pos_commercial_rule_items;
DROP TABLE sales.pos_commercial_rules;
