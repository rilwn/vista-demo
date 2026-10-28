ALTER TABLE procurement.supplier_invoices
  ADD COLUMN exchange_rate numeric(18, 8),
  ADD COLUMN rate_date date,
  ADD COLUMN rate_source varchar(30);

-- Reuse an existing payable snapshot when present. Otherwise restore the
-- invoice-date rate from the BNB table; EUR invoices use the fixed EUR rate.
UPDATE procurement.supplier_invoices invoice
SET exchange_rate = payable.exchange_rate,
    rate_date = payable.rate_date,
    rate_source = payable.rate_source
FROM finance.supplier_payables payable
WHERE payable.source_supplier_invoice_id = invoice.id
  AND invoice.currency_code <> 'EUR';

UPDATE procurement.supplier_invoices
SET exchange_rate = 1,
    rate_date = invoice_date,
    rate_source = 'internal_eur'
WHERE currency_code = 'EUR' AND exchange_rate IS NULL;

UPDATE procurement.supplier_invoices invoice
SET (exchange_rate, rate_date, rate_source) = (
  SELECT rate.eur_per_unit, rate.rate_date, 'BNB'
  FROM finance.currency_rates rate
  WHERE rate.currency_code = invoice.currency_code
    AND rate.rate_date <= invoice.invoice_date
  ORDER BY rate.rate_date DESC
  LIMIT 1
)
WHERE invoice.currency_code <> 'EUR'
  AND invoice.exchange_rate IS NULL
  AND EXISTS (
    SELECT 1 FROM finance.currency_rates rate
    WHERE rate.currency_code = invoice.currency_code
      AND rate.rate_date <= invoice.invoice_date
  );

ALTER TABLE procurement.supplier_invoices
  ADD CONSTRAINT supplier_invoice_rate_snapshot_valid CHECK (
    (exchange_rate IS NULL AND rate_date IS NULL AND rate_source IS NULL)
    OR (
      exchange_rate > 0 AND rate_date <= invoice_date
      AND ((currency_code = 'EUR' AND exchange_rate = 1 AND rate_source = 'internal_eur')
        OR (currency_code <> 'EUR' AND rate_source = 'BNB'))
    )
  );

CREATE FUNCTION procurement.prevent_supplier_invoice_rate_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.exchange_rate IS NOT NULL AND (
    NEW.exchange_rate IS DISTINCT FROM OLD.exchange_rate
    OR NEW.rate_date IS DISTINCT FROM OLD.rate_date
    OR NEW.rate_source IS DISTINCT FROM OLD.rate_source
  ) THEN
    RAISE EXCEPTION 'supplier invoice exchange-rate snapshots cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER supplier_invoice_rate_snapshot_immutable
BEFORE UPDATE OF exchange_rate, rate_date, rate_source ON procurement.supplier_invoices
FOR EACH ROW EXECUTE FUNCTION procurement.prevent_supplier_invoice_rate_rewrite();

COMMENT ON COLUMN procurement.supplier_invoices.exchange_rate IS
  'Immutable EUR-per-source-currency rate captured for this supplier invoice.';
