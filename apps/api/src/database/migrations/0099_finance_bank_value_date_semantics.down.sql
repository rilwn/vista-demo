ALTER TABLE finance.bank_transactions
  ADD CONSTRAINT finance_bank_transaction_dates_valid
  CHECK (value_date >= transaction_date);

COMMENT ON COLUMN finance.bank_transactions.transaction_date IS NULL;
COMMENT ON COLUMN finance.bank_transactions.value_date IS NULL;
