ALTER TABLE finance.bank_transactions
  DROP CONSTRAINT finance_bank_transaction_dates_valid;

COMMENT ON COLUMN finance.bank_transactions.transaction_date IS
  'Date the bank booked the transaction. It may be later than the separately reported value date.';

COMMENT ON COLUMN finance.bank_transactions.value_date IS
  'Bank value/effective date. This may precede or follow the booking date.';
