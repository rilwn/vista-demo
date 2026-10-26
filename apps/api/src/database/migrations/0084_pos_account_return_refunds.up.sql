ALTER TABLE finance.internal_document_sequences DROP CONSTRAINT finance_internal_sequence_type_valid;
ALTER TABLE finance.internal_document_sequences ADD CONSTRAINT finance_internal_sequence_type_valid CHECK(
  document_type IN ('collection_review','payment','bank_statement','supplier_payable','supplier_payment',
    'supplier_advance','supplier_offset','customer_advance','payment_reversal','pos_account_refund'));
ALTER TABLE finance.financial_documents ADD COLUMN source_pos_return_id uuid
  REFERENCES pos.returns(id) ON DELETE RESTRICT;
ALTER TABLE finance.financial_documents ADD CONSTRAINT finance_pos_return_source_valid CHECK(
  source_pos_return_id IS NULL OR (document_type='credit_note' AND correction_of_document_id IS NOT NULL
    AND source_pos_sale_id IS NULL AND currency_code='EUR'));
CREATE UNIQUE INDEX finance_pos_return_document_unique ON finance.financial_documents(source_pos_return_id)
  WHERE source_pos_return_id IS NOT NULL AND status<>'cancelled';

CREATE TABLE finance.pos_account_return_credits (
  pos_return_id uuid PRIMARY KEY REFERENCES pos.returns(id) ON DELETE RESTRICT,
  charge_entry_id uuid NOT NULL REFERENCES finance.customer_account_entries(id) ON DELETE RESTRICT,
  released_amount numeric(18,4) NOT NULL CHECK(released_amount>=0),
  refund_amount numeric(18,4) NOT NULL CHECK(refund_amount>0),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE finance.pos_account_refunds (
  id uuid PRIMARY KEY,
  refund_number text NOT NULL UNIQUE,
  pos_return_id uuid NOT NULL REFERENCES finance.pos_account_return_credits(pos_return_id) ON DELETE RESTRICT,
  credit_document_id uuid REFERENCES finance.financial_documents(id) ON DELETE RESTRICT,
  amount numeric(18,4) NOT NULL CHECK(amount>0),
  refunded_on date NOT NULL,
  payment_method text NOT NULL CHECK(payment_method IN ('cash','bank_transfer')),
  payment_reference text NOT NULL CHECK(length(trim(payment_reference)) BETWEEN 3 AND 255),
  recorded_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  correlation_id text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX finance_pos_account_refunds_return_idx ON finance.pos_account_refunds(pos_return_id);
CREATE TABLE finance.pos_account_refund_allocations (
  refund_id uuid NOT NULL REFERENCES finance.pos_account_refunds(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL REFERENCES finance.payments(id) ON DELETE RESTRICT,
  amount numeric(18,4) NOT NULL CHECK(amount>0),
  PRIMARY KEY(refund_id,payment_id)
);
CREATE INDEX finance_pos_refund_payment_idx ON finance.pos_account_refund_allocations(payment_id);

CREATE FUNCTION finance.protect_pos_refund_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'POS return and refund evidence is append-only' USING ERRCODE='55000'; END; $$;
CREATE TRIGGER pos_account_return_credit_immutable BEFORE UPDATE OR DELETE ON finance.pos_account_return_credits
  FOR EACH ROW EXECUTE FUNCTION finance.protect_pos_refund_evidence();
CREATE TRIGGER pos_account_refund_immutable BEFORE UPDATE OR DELETE ON finance.pos_account_refunds
  FOR EACH ROW EXECUTE FUNCTION finance.protect_pos_refund_evidence();
CREATE TRIGGER pos_account_refund_allocation_immutable BEFORE UPDATE OR DELETE ON finance.pos_account_refund_allocations
  FOR EACH ROW EXECUTE FUNCTION finance.protect_pos_refund_evidence();

CREATE FUNCTION finance.validate_pos_return_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE charge finance.customer_account_entries; sale_id uuid; returned numeric; released numeric; collected numeric; reserved numeric;
BEGIN
  SELECT original_sale_id INTO sale_id FROM pos.returns WHERE id=NEW.pos_return_id;
  PERFORM id FROM pos.sales WHERE id=sale_id FOR UPDATE;
  SELECT * INTO charge FROM finance.customer_account_entries WHERE id=NEW.charge_entry_id;
  SELECT coalesce(sum(amount),0) INTO returned FROM pos.return_refunds WHERE return_id=NEW.pos_return_id AND refund_method='on_account';
  SELECT coalesce(sum(amount),0) INTO released FROM finance.customer_account_entries WHERE pos_return_id=NEW.pos_return_id AND entry_type='return_credit';
  SELECT coalesce(sum(p.amount),0) INTO collected FROM finance.payments p
    WHERE p.source_pos_sale_id=sale_id AND NOT EXISTS(SELECT 1 FROM finance.payment_reversals r WHERE r.payment_id=p.id);
  SELECT coalesce(sum(c.refund_amount),0) INTO reserved FROM finance.pos_account_return_credits c
    JOIN pos.returns r ON r.id=c.pos_return_id WHERE r.original_sale_id=sale_id;
  IF charge.entry_type IS DISTINCT FROM 'charge' OR charge.pos_sale_id IS DISTINCT FROM sale_id
    OR NEW.released_amount<>released OR returned<>NEW.released_amount+NEW.refund_amount
    OR reserved+NEW.refund_amount>collected THEN
    RAISE EXCEPTION 'Collected POS return must reconcile with original payments and released debt' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER pos_account_return_credit_valid BEFORE INSERT ON finance.pos_account_return_credits
  FOR EACH ROW EXECUTE FUNCTION finance.validate_pos_return_credit();

CREATE FUNCTION finance.prevent_returned_payment_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sale_id uuid;
BEGIN
  SELECT source_pos_sale_id INTO sale_id FROM finance.payments WHERE id=NEW.payment_id;
  IF sale_id IS NOT NULL THEN
    PERFORM id FROM pos.sales WHERE id=sale_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM finance.pos_account_return_credits c JOIN pos.returns r ON r.id=c.pos_return_id WHERE r.original_sale_id=sale_id) THEN
      RAISE EXCEPTION 'A collected return requires its refund workflow, not a payment reversal' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER finance_returned_pos_payment_reversal BEFORE INSERT ON finance.payment_reversals
  FOR EACH ROW EXECUTE FUNCTION finance.prevent_returned_payment_reversal();

CREATE FUNCTION finance.validate_pos_return_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original finance.financial_documents; returned pos.returns;
BEGIN
  IF TG_OP='UPDATE' AND OLD.status='issued' AND NEW.source_pos_return_id IS DISTINCT FROM OLD.source_pos_return_id THEN
    RAISE EXCEPTION 'An issued POS return source cannot change' USING ERRCODE='55000';
  END IF;
  IF TG_OP='UPDATE' AND OLD.source_pos_return_id IS NOT NULL AND OLD.status='issued'
    AND NEW.status='cancelled' AND EXISTS(
      SELECT 1 FROM finance.pos_account_refunds WHERE credit_document_id=OLD.id) THEN
    RAISE EXCEPTION 'A POS return credit note with recorded repayments cannot be cancelled' USING ERRCODE='23514';
  END IF;
  IF NEW.document_type='invoice' AND NEW.status='issued' AND NEW.source_pos_sale_id IS NOT NULL THEN
    PERFORM id FROM pos.sales WHERE id=NEW.source_pos_sale_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM pos.returns WHERE original_sale_id=NEW.source_pos_sale_id) THEN
      RAISE EXCEPTION 'A POS invoice cannot be issued after the sale has been returned' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.document_type<>'credit_note' OR NEW.status='cancelled' THEN RETURN NEW; END IF;
  SELECT * INTO original FROM finance.financial_documents WHERE id=NEW.correction_of_document_id;
  IF original.source_pos_sale_id IS NULL AND NEW.source_pos_return_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO returned FROM pos.returns WHERE id=NEW.source_pos_return_id;
  IF original.status IS DISTINCT FROM 'issued' OR returned.original_sale_id IS DISTINCT FROM original.source_pos_sale_id
    OR NEW.customer_partner_id<>original.customer_partner_id OR NEW.legal_entity_id<>original.legal_entity_id
    OR NEW.currency_code<>'EUR' OR NEW.exchange_rate<>1 OR NEW.net_total<>returned.net_total
    OR NEW.vat_total<>returned.vat_total OR NEW.gross_total<>returned.gross_total THEN
    RAISE EXCEPTION 'POS credit note must match one return and its issued original invoice' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER financial_document_pos_return_valid BEFORE INSERT OR UPDATE ON finance.financial_documents
  FOR EACH ROW EXECUTE FUNCTION finance.validate_pos_return_document();

CREATE FUNCTION finance.validate_pos_account_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sale_id uuid; owed numeric; paid numeric; invoice_id uuid;
BEGIN
  SELECT r.original_sale_id,c.refund_amount INTO sale_id,owed FROM finance.pos_account_return_credits c
    JOIN pos.returns r ON r.id=c.pos_return_id WHERE c.pos_return_id=NEW.pos_return_id;
  PERFORM id FROM pos.sales WHERE id=sale_id FOR UPDATE;
  SELECT coalesce(sum(amount),0) INTO paid FROM finance.pos_account_refunds WHERE pos_return_id=NEW.pos_return_id;
  SELECT id INTO invoice_id FROM finance.financial_documents WHERE source_pos_sale_id=sale_id AND status='issued' AND document_type='invoice';
  IF owed IS NULL OR paid+NEW.amount>owed OR (invoice_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM finance.financial_documents WHERE id=NEW.credit_document_id AND source_pos_return_id=NEW.pos_return_id
        AND correction_of_document_id=invoice_id AND document_type='credit_note' AND status='issued'))
    OR (NEW.credit_document_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM finance.financial_documents WHERE id=NEW.credit_document_id AND source_pos_return_id=NEW.pos_return_id AND status='issued')) THEN
    RAISE EXCEPTION 'POS refund exceeds its return credit or lacks its issued credit note' USING ERRCODE='23514';
  END IF;
  IF NEW.credit_document_id IS NOT NULL THEN
    PERFORM id FROM finance.financial_documents WHERE id=NEW.credit_document_id AND status='issued' FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'POS repayment requires its linked issued credit note' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER pos_account_refund_valid BEFORE INSERT ON finance.pos_account_refunds
  FOR EACH ROW EXECUTE FUNCTION finance.validate_pos_account_refund();

CREATE FUNCTION finance.validate_pos_refund_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sale_id uuid; payment finance.payments; allocated numeric;
BEGIN
  SELECT r.original_sale_id INTO sale_id FROM finance.pos_account_refunds f JOIN pos.returns r ON r.id=f.pos_return_id WHERE f.id=NEW.refund_id;
  PERFORM id FROM pos.sales WHERE id=sale_id FOR UPDATE;
  SELECT * INTO payment FROM finance.payments WHERE id=NEW.payment_id;
  SELECT coalesce(sum(amount),0) INTO allocated FROM finance.pos_account_refund_allocations WHERE payment_id=NEW.payment_id;
  IF payment.source_pos_sale_id IS DISTINCT FROM sale_id OR allocated+NEW.amount>payment.amount
    OR EXISTS(SELECT 1 FROM finance.payment_reversals WHERE payment_id=NEW.payment_id) THEN
    RAISE EXCEPTION 'Refund allocation must use an unreversed original POS collection' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER pos_account_refund_allocation_valid BEFORE INSERT ON finance.pos_account_refund_allocations
  FOR EACH ROW EXECUTE FUNCTION finance.validate_pos_refund_allocation();
CREATE FUNCTION finance.require_pos_refund_allocations() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount<>(SELECT coalesce(sum(amount),0) FROM finance.pos_account_refund_allocations WHERE refund_id=NEW.id) THEN
    RAISE EXCEPTION 'POS refund requires complete original-payment allocations' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER pos_account_refund_allocations_complete AFTER INSERT ON finance.pos_account_refunds
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance.require_pos_refund_allocations();
