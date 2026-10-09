DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM sales.quotations WHERE version > 1 OR status = 'cancelled') THEN
    RAISE EXCEPTION
      'Cannot roll back quotation lifecycle while edited or cancelled quotations exist.';
  END IF;
END
$$;

DROP INDEX sales.sales_quotation_revisions_history_idx;
DROP TABLE sales.quotation_revisions;

ALTER TABLE sales.quotations
  DROP CONSTRAINT sales_quotation_cancellation_consistent,
  DROP CONSTRAINT sales_quotation_version_positive,
  DROP CONSTRAINT sales_quotation_status_valid,
  DROP COLUMN cancellation_reason,
  DROP COLUMN cancelled_by,
  DROP COLUMN cancelled_at,
  DROP COLUMN version,
  ADD CONSTRAINT sales_quotation_status_valid CHECK (
    status IN ('draft', 'confirmed', 'shipped', 'invoiced')
  );
