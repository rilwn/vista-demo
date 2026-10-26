DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM finance.recurring_invoice_profiles) THEN
    RAISE EXCEPTION 'Cannot downgrade recurring invoicing while approved profiles or issuance history exist';
  END IF;
END;
$$;
DROP TABLE finance.recurring_invoice_runs;
DROP TABLE finance.recurring_invoice_profiles;
