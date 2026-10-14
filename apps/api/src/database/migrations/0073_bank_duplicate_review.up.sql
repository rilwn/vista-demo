ALTER TABLE finance.bank_transactions
  ADD COLUMN possible_duplicate boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN finance.bank_transactions.possible_duplicate IS
  'Possible repeat of an earlier bank line; kept unmatched until staff review it.';
