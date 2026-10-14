CREATE TABLE finance.currency_rates (
  currency_code char(3) NOT NULL,
  rate_date date NOT NULL,
  eur_per_unit numeric(18, 8) NOT NULL,
  rate_source varchar(30) NOT NULL DEFAULT 'BNB',
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_currency_rate_pk PRIMARY KEY (currency_code, rate_date),
  CONSTRAINT finance_currency_rate_code_valid CHECK (
    currency_code = upper(currency_code) AND currency_code <> 'EUR' AND currency_code <> 'BGN'
  ),
  CONSTRAINT finance_currency_rate_positive CHECK (eur_per_unit > 0),
  CONSTRAINT finance_currency_rate_source_valid CHECK (rate_source = 'BNB')
);

CREATE INDEX finance_currency_rates_date_idx
  ON finance.currency_rates (rate_date DESC, currency_code);

COMMENT ON TABLE finance.currency_rates IS
  'Daily Bulgarian National Bank rates stored as EUR per one unit of foreign currency. Posted documents keep their own immutable rate snapshots.';
