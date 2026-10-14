ALTER TABLE procurement.goods_receipt_lines
  ADD COLUMN cost_baseline_eur numeric(18, 4),
  ADD COLUMN cost_baseline_source varchar(30),
  ADD COLUMN cost_variance_percent numeric(9, 4)
    GENERATED ALWAYS AS (
      CASE WHEN cost_baseline_eur > 0
        THEN round(((unit_cost_eur - cost_baseline_eur) / cost_baseline_eur) * 100, 4)
        ELSE NULL
      END
    ) STORED,
  ADD CONSTRAINT goods_receipt_cost_baseline_nonnegative
    CHECK (cost_baseline_eur IS NULL OR cost_baseline_eur > 0),
  ADD CONSTRAINT goods_receipt_cost_baseline_source_valid
    CHECK (
      (cost_baseline_eur IS NULL AND cost_baseline_source IS NULL)
      OR (cost_baseline_eur IS NOT NULL
        AND cost_baseline_source IN ('supplier_invoice', 'latest_product_cost'))
    );

COMMENT ON COLUMN procurement.goods_receipt_lines.cost_baseline_eur IS
  'EUR product-cost baseline captured when received; used for a non-blocking 10% review warning.';
COMMENT ON COLUMN procurement.goods_receipt_lines.cost_baseline_source IS
  'The source selected for the receipt review baseline.';
