ALTER TABLE finance.supplier_offsets
  ALTER COLUMN customer_document_id DROP NOT NULL,
  ADD COLUMN pos_sale_id uuid REFERENCES pos.sales(id) ON DELETE RESTRICT,
  ADD CONSTRAINT finance_supplier_offset_customer_source_valid CHECK (
    num_nonnulls(customer_document_id, pos_sale_id) = 1
  );

CREATE INDEX finance_supplier_offsets_pos_sale_idx
  ON finance.supplier_offsets (pos_sale_id) WHERE pos_sale_id IS NOT NULL;

COMMENT ON COLUMN finance.supplier_offsets.pos_sale_id IS
  'Deferred POS customer-account sale compensated against this supplier payable.';

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
    OR payment.payment_method NOT IN ('cash','bank_transfer','card','pos_terminal','offset') THEN
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
