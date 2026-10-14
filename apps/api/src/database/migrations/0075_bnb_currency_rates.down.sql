DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM finance.financial_documents
    WHERE rate_source = 'BNB' AND currency_code <> 'EUR'
  ) OR EXISTS (
    SELECT 1 FROM finance.customer_documents
    WHERE rate_source = 'BNB' AND currency_code <> 'EUR'
  ) OR EXISTS (
    SELECT 1 FROM finance.supplier_payables
    WHERE rate_source = 'BNB' AND currency_code <> 'EUR'
  ) THEN
    RAISE EXCEPTION
      'Refusing to remove BNB rates referenced by Finance records; preserve the rate register before rolling back 0075.';
  END IF;
END
$$;

DROP TABLE finance.currency_rates;
