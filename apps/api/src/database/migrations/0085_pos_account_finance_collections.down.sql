DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM finance.cash_vouchers WHERE source_pos_sale_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM finance.bank_transactions WHERE matched_pos_sale_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM finance.payments WHERE source_pos_sale_id IS NOT NULL
       AND source_customer_advance_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM finance.customer_advance_entries
       WHERE entry_type='applied' GROUP BY advance_id,pos_sale_id HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Cannot remove POS cash, bank, or advance collection links';
  END IF;
END; $$;

DROP INDEX finance.customer_advance_sale_application_idx;
CREATE UNIQUE INDEX customer_advance_sale_application_unique
  ON finance.customer_advance_entries (advance_id, pos_sale_id)
  WHERE entry_type = 'applied';

DROP TRIGGER finance_cash_pos_voucher_valid ON finance.cash_vouchers;
DROP FUNCTION finance.validate_pos_cash_voucher_link();
DROP TRIGGER finance_bank_pos_match_valid ON finance.bank_transactions;
DROP FUNCTION finance.validate_pos_bank_match();

CREATE OR REPLACE FUNCTION finance.validate_pos_account_collection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source finance.customer_account_entries; payment finance.payments; balance numeric(18,4);
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
    OR payment.amount<>NEW.amount OR payment.source_customer_advance_id IS NOT NULL
    OR payment.payment_method NOT IN ('cash','bank_transfer','card','pos_terminal') THEN
    RAISE EXCEPTION 'POS account payment must match its Finance payment' USING ERRCODE='23514';
  END IF;
  IF NEW.entry_type='payment_reversal' AND (source.payment_id<>NEW.payment_id OR NOT EXISTS (
    SELECT 1 FROM finance.payment_reversals WHERE payment_id=NEW.payment_id)) THEN
    RAISE EXCEPTION 'POS account reversal requires its original payment and reversal record' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

ALTER TABLE finance.bank_transactions
  DROP CONSTRAINT finance_bank_transaction_match_state_valid,
  ADD CONSTRAINT finance_bank_transaction_match_state_valid CHECK (
    (
      match_status = 'unmatched' AND match_method IS NULL
      AND matched_customer_document_id IS NULL
      AND matched_payment_id IS NULL AND matched_supplier_payable_id IS NULL
      AND matched_supplier_payment_id IS NULL AND matched_by IS NULL AND matched_at IS NULL
    ) OR (
      match_status = 'matched' AND direction = 'incoming' AND match_method IS NOT NULL
      AND matched_customer_document_id IS NOT NULL
      AND matched_payment_id IS NOT NULL AND matched_supplier_payable_id IS NULL
      AND matched_supplier_payment_id IS NULL AND matched_at IS NOT NULL
    ) OR (
      match_status = 'matched' AND direction = 'outgoing' AND match_method IS NOT NULL
      AND matched_customer_document_id IS NULL
      AND matched_payment_id IS NULL AND matched_supplier_payment_id IS NOT NULL
      AND matched_at IS NOT NULL
    )
  );
DROP INDEX finance.finance_bank_transactions_pos_sale_idx;
ALTER TABLE finance.bank_transactions DROP COLUMN matched_pos_sale_id;

ALTER TABLE finance.cash_vouchers
  DROP CONSTRAINT finance_cash_voucher_collection_link_valid,
  ADD CONSTRAINT finance_cash_voucher_collection_link_valid CHECK (
    (customer_document_id IS NULL AND generated_payment_id IS NULL)
    OR (direction = 'receipt' AND counterparty_partner_id IS NOT NULL
      AND customer_document_id IS NOT NULL AND generated_payment_id IS NOT NULL)
  );
DROP INDEX finance.finance_cash_vouchers_pos_sale_idx;
ALTER TABLE finance.cash_vouchers DROP COLUMN source_pos_sale_id;
