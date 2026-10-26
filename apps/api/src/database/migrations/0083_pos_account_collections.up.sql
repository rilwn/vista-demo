ALTER TABLE finance.payments ADD COLUMN source_pos_sale_id uuid
  REFERENCES pos.sales(id) ON DELETE RESTRICT;
CREATE INDEX finance_payments_pos_sale_idx ON finance.payments(source_pos_sale_id)
  WHERE source_pos_sale_id IS NOT NULL;

ALTER TABLE finance.customer_account_entries
  ADD COLUMN payment_id uuid REFERENCES finance.payments(id) ON DELETE RESTRICT,
  DROP CONSTRAINT customer_account_entry_type_valid,
  DROP CONSTRAINT customer_account_entry_source_valid,
  ADD CONSTRAINT customer_account_entry_type_valid CHECK (
    entry_type IN ('charge','return_credit','payment','payment_reversal')),
  ADD CONSTRAINT customer_account_entry_source_valid CHECK (
    (entry_type='charge' AND pos_sale_id IS NOT NULL AND pos_return_id IS NULL
      AND source_entry_id IS NULL AND payment_id IS NULL)
    OR (entry_type='return_credit' AND pos_sale_id IS NOT NULL AND pos_return_id IS NOT NULL
      AND source_entry_id IS NOT NULL AND payment_id IS NULL)
    OR (entry_type IN ('payment','payment_reversal') AND pos_sale_id IS NOT NULL
      AND pos_return_id IS NULL AND source_entry_id IS NOT NULL AND payment_id IS NOT NULL));
CREATE UNIQUE INDEX customer_account_payment_unique
  ON finance.customer_account_entries(payment_id,entry_type) WHERE payment_id IS NOT NULL;
CREATE INDEX customer_account_entries_sale_idx ON finance.customer_account_entries(pos_sale_id);

CREATE FUNCTION finance.validate_pos_account_collection() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER customer_account_collection_valid BEFORE INSERT ON finance.customer_account_entries
  FOR EACH ROW EXECUTE FUNCTION finance.validate_pos_account_collection();

CREATE FUNCTION finance.require_pos_collection_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sale_id uuid; kind text; collected_payment_id uuid;
BEGIN
  IF TG_TABLE_NAME='payments' THEN sale_id:=NEW.source_pos_sale_id; kind:='payment'; collected_payment_id:=NEW.id;
  ELSE SELECT source_pos_sale_id INTO sale_id FROM finance.payments WHERE id=NEW.payment_id;
    kind:='payment_reversal'; collected_payment_id:=NEW.payment_id; END IF;
  IF sale_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM finance.customer_account_entries
    WHERE payment_id=collected_payment_id
      AND entry_type=kind AND pos_sale_id=sale_id) THEN
    RAISE EXCEPTION 'POS Finance payment requires its account entry' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER finance_pos_payment_entry AFTER INSERT ON finance.payments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance.require_pos_collection_entry();
CREATE CONSTRAINT TRIGGER finance_pos_reversal_entry AFTER INSERT ON finance.payment_reversals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance.require_pos_collection_entry();

CREATE FUNCTION finance.protect_pos_collection_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='payment_allocations' THEN
    IF EXISTS (SELECT 1 FROM finance.payments WHERE id=NEW.payment_id AND source_pos_sale_id IS NOT NULL) THEN
      RAISE EXCEPTION 'POS account payments cannot be allocated to another collection' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME='payments' THEN
    IF OLD.source_pos_sale_id IS NOT NULL OR (TG_OP='UPDATE' AND NEW.source_pos_sale_id IS NOT NULL) THEN
      RAISE EXCEPTION 'POS account payments are immutable; use a linked reversal' USING ERRCODE='55000';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM finance.payments WHERE id=OLD.payment_id AND source_pos_sale_id IS NOT NULL) THEN
    RAISE EXCEPTION 'POS payment reversals are append-only' USING ERRCODE='55000';
  END IF;
  IF TG_OP='UPDATE' THEN RETURN NEW; END IF;
  RETURN OLD;
END; $$;
CREATE TRIGGER finance_pos_payment_immutable BEFORE UPDATE OR DELETE ON finance.payments
  FOR EACH ROW EXECUTE FUNCTION finance.protect_pos_collection_payment();
CREATE TRIGGER finance_pos_reversal_immutable BEFORE UPDATE OR DELETE ON finance.payment_reversals
  FOR EACH ROW EXECUTE FUNCTION finance.protect_pos_collection_payment();
CREATE TRIGGER finance_pos_allocation_forbidden BEFORE INSERT OR UPDATE ON finance.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION finance.protect_pos_collection_payment();
