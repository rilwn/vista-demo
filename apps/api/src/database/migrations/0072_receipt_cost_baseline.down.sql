ALTER TABLE procurement.goods_receipt_lines
  DROP CONSTRAINT goods_receipt_cost_baseline_source_valid,
  DROP CONSTRAINT goods_receipt_cost_baseline_nonnegative,
  DROP COLUMN cost_variance_percent,
  DROP COLUMN cost_baseline_source,
  DROP COLUMN cost_baseline_eur;
