ALTER TABLE finance.cash_vouchers
  ADD COLUMN source_pos_sale_id uuid REFERENCES pos.sales(id) ON DELETE RESTRICT,
  DROP CONSTRAINT finance_cash_voucher_collection_link_valid,
  ADD CONSTRAINT finance_cash_voucher_collection_link_valid CHECK (
    NOT (customer_document_id IS NOT NULL AND source_pos_sale_id IS NOT NULL)
    AND (
      (customer_document_id IS NULL AND source_pos_sale_id IS NULL AND generated_payment_id IS NULL)
      OR (direction = 'receipt' AND counterparty_partner_id IS NOT NULL
        AND generated_payment_id IS NOT NULL
        AND num_nonnulls(customer_document_id, source_pos_sale_id) = 1)
    )
  );
DROP INDEX finance.customer_advance_sale_application_unique;
CREATE INDEX customer_advance_sale_application_idx
  ON finance.customer_advance_entries (advance_id, pos_sale_id)
  WHERE entry_type = 'applied';
CREATE INDEX finance_cash_vouchers_pos_sale_idx
  ON finance.cash_vouchers (source_pos_sale_id) WHERE source_pos_sale_id IS NOT NULL;

ALTER TABLE finance.bank_transactions
  ADD COLUMN matched_pos_sale_id uuid REFERENCES pos.sales(id) ON DELETE RESTRICT,
  DROP CONSTRAINT finance_bank_transaction_match_state_valid,
  ADD CONSTRAINT finance_bank_transaction_match_state_valid CHECK (
    (
      match_status = 'unmatched' AND match_method IS NULL
      AND matched_customer_document_id IS NULL AND matched_pos_sale_id IS NULL
      AND matched_payment_id IS NULL AND matched_supplier_payable_id IS NULL
      AND matched_supplier_payment_id IS NULL AND matched_by IS NULL AND matched_at IS NULL
    ) OR (
      match_status = 'matched' AND direction = 'incoming' AND match_method IS NOT NULL
      AND matched_customer_document_id IS NOT NULL AND matched_pos_sale_id IS NULL
      AND matched_payment_id IS NOT NULL AND matched_supplier_payable_id IS NULL
      AND matched_supplier_payment_id IS NULL AND matched_at IS NOT NULL
    ) OR (
      match_status = 'matched' AND direction = 'incoming' AND match_method IS NOT NULL
      AND matched_customer_document_id IS NULL AND matched_pos_sale_id IS NOT NULL
      AND matched_payment_id IS NOT NULL AND matched_supplier_payable_id IS NULL
      AND matched_supplier_payment_id IS NULL AND matched_at IS NOT NULL
    ) OR (
      match_status = 'matched' AND direction = 'outgoing' AND match_method IS NOT NULL
      AND matched_customer_document_id IS NULL AND matched_pos_sale_id IS NULL
      AND matched_payment_id IS NULL AND matched_supplier_payment_id IS NOT NULL
      AND matched_at IS NOT NULL
    )
  );
CREATE INDEX finance_bank_transactions_pos_sale_idx
  ON finance.bank_transactions (matched_pos_sale_id) WHERE matched_pos_sale_id IS NOT NULL;

CREATE OR REPLACE FUNCTION finance.validate_pos_account_collection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source finance.customer_account_entries;
  payment finance.payments;
  applied_advance finance.customer_advance_entries;
  advance_customer uuid;
  balance numeric(18,4);
BEGIN
  IF NEW.entry_type NOT IN ('payment','payment_reversal','return_credit') THEN RETURN NEW; END IF;
  PERFORM id FROM pos.sales WHERE id=NEW.pos_sale_id FOR UPDATE;
  SELECT * INTO source FROM finance.customer_account_entries WHERE id=NEW.source_entry_id;
  IF source.id IS NULL OR source.pos_sale_id<>NEW.pos_sale_id
    OR source.customer_partner_id<>NEW.customer_partner_id
    OR source.payment_terms_id<>NEW.payment_terms_id OR source.due_on<>NEW.due_on
    OR source.credit_limit_eur<>NEW.credit_limit_eur OR source.payment_terms_days<>NEW.payment_terms_days
    OR (NEW.entry_type IN ('payment','return_credit') AND source.entry_type<>'charge')
    OR (NEW.entry_type='payment_reversal' AND source.entry_type<>'payment') THEN
    RAISE EXCEPTION 'POS account entry must match its original charge or payment' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(sum(CASE WHEN entry_type IN ('charge','payment_reversal') THEN amount ELSE -amount END),0)
    INTO balance FROM finance.customer_account_entries WHERE pos_sale_id=NEW.pos_sale_id;
  IF NEW.entry_type IN ('payment','return_credit') AND NEW.amount>balance THEN
    RAISE EXCEPTION 'POS account entry exceeds unpaid balance' USING ERRCODE='23514';
  END IF;
  IF NEW.entry_type='return_credit' THEN RETURN NEW; END IF;
  SELECT * INTO payment FROM finance.payments WHERE id=NEW.payment_id;
  IF payment.id IS NULL OR payment.source_pos_sale_id IS DISTINCT FROM NEW.pos_sale_id
    OR payment.customer_partner_id<>NEW.customer_partner_id OR payment.currency_code<>'EUR'
    OR payment.amount<>NEW.amount
    OR payment.payment_method NOT IN ('cash','bank_transfer','card','pos_terminal') THEN
    RAISE EXCEPTION 'POS account payment must match its Finance payment' USING ERRCODE='23514';
  END IF;
  IF payment.source_customer_advance_id IS NULL THEN
    IF payment.source_customer_advance_entry_id IS NOT NULL THEN
      RAISE EXCEPTION 'POS payment has an unmatched customer advance entry' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT * INTO applied_advance FROM finance.customer_advance_entries
      WHERE id=payment.source_customer_advance_entry_id;
    SELECT customer_partner_id INTO advance_customer FROM finance.customer_advances
      WHERE id=payment.source_customer_advance_id;
    IF applied_advance.id IS NULL OR applied_advance.advance_id<>payment.source_customer_advance_id
      OR applied_advance.entry_type<>'applied' OR applied_advance.pos_sale_id<>NEW.pos_sale_id
      OR applied_advance.amount<>NEW.amount OR advance_customer<>NEW.customer_partner_id THEN
      RAISE EXCEPTION 'POS advance payment must match its applied advance entry' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.entry_type='payment_reversal' AND (source.payment_id<>NEW.payment_id OR NOT EXISTS (
    SELECT 1 FROM finance.payment_reversals WHERE payment_id=NEW.payment_id)) THEN
    RAISE EXCEPTION 'POS account reversal requires its original payment and reversal record' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE FUNCTION finance.validate_pos_bank_match() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment finance.payments;
BEGIN
  IF NEW.match_status <> 'matched' OR NEW.matched_pos_sale_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO payment FROM finance.payments WHERE id=NEW.matched_payment_id;
  IF payment.id IS NULL OR payment.source_pos_sale_id IS DISTINCT FROM NEW.matched_pos_sale_id
    OR payment.payment_method<>'bank_transfer' OR payment.amount<>NEW.amount
    OR payment.currency_code<>'EUR' OR payment.customer_partner_id IS DISTINCT FROM
       (SELECT customer_partner_id FROM pos.sales WHERE id=NEW.matched_pos_sale_id) THEN
    RAISE EXCEPTION 'Matched POS bank transaction must point to its matching Finance payment' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER finance_bank_pos_match_valid BEFORE INSERT OR UPDATE ON finance.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION finance.validate_pos_bank_match();

CREATE FUNCTION finance.validate_pos_cash_voucher_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment finance.payments;
BEGIN
  IF NEW.source_pos_sale_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO payment FROM finance.payments WHERE id=NEW.generated_payment_id;
  IF NEW.direction<>'receipt' OR payment.id IS NULL
    OR payment.source_pos_sale_id IS DISTINCT FROM NEW.source_pos_sale_id
    OR payment.payment_method<>'cash' OR payment.amount<>NEW.amount
    OR payment.currency_code<>'EUR' OR payment.customer_partner_id IS DISTINCT FROM NEW.counterparty_partner_id THEN
    RAISE EXCEPTION 'POS cash receipt must point to its matching Finance payment' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER finance_cash_pos_voucher_valid BEFORE INSERT OR UPDATE ON finance.cash_vouchers
  FOR EACH ROW EXECUTE FUNCTION finance.validate_pos_cash_voucher_link();

COMMENT ON COLUMN finance.cash_vouchers.source_pos_sale_id IS
  'Completed POS account sale collected by this receipt; the matching Finance payment and customer ledger entry are posted together.';
COMMENT ON COLUMN finance.bank_transactions.matched_pos_sale_id IS
  'Deferred POS customer-account sale settled by this incoming transfer.';
