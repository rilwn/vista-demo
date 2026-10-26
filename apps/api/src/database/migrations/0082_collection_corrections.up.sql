ALTER TABLE finance.customer_documents
  ADD COLUMN credit_total numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN debit_total numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN adjusted_total numeric(18,4) GENERATED ALWAYS AS (total-credit_total+debit_total) STORED,
  ADD COLUMN overpaid_total numeric(18,4) GENERATED ALWAYS AS (greatest(allocated_total-(total-credit_total+debit_total),0)) STORED;
ALTER TABLE finance.customer_documents DROP CONSTRAINT finance_document_amounts_valid;
ALTER TABLE finance.customer_documents ADD CONSTRAINT finance_document_amounts_valid CHECK (
  total>=0 AND allocated_total>=0 AND credit_total>=0 AND debit_total>=0 AND adjusted_total>=0
  AND outstanding_total=greatest(adjusted_total-allocated_total,0)
);

CREATE TABLE finance.collection_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_document_id uuid NOT NULL REFERENCES finance.customer_documents(id) ON DELETE RESTRICT,
  original_document_id uuid NOT NULL REFERENCES finance.financial_documents(id) ON DELETE RESTRICT,
  correction_document_id uuid NOT NULL UNIQUE REFERENCES finance.financial_documents(id) ON DELETE RESTRICT,
  document_type varchar(20) NOT NULL CHECK(document_type IN ('credit_note','debit_note')),
  document_date date NOT NULL,
  currency_code char(3) NOT NULL CHECK(currency_code<>'BGN'),
  amount numeric(18,4) NOT NULL CHECK(amount>=0),
  eur_amount numeric(18,4) NOT NULL CHECK(eur_amount>=0),
  origin varchar(20) NOT NULL CHECK(origin IN ('issuance','migration')),
  actor_account_id uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  correlation_id varchar(128) NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collection_corrections_document_idx ON finance.collection_corrections(customer_document_id,applied_at,id);
CREATE FUNCTION finance.validate_collection_correction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM finance.financial_documents note
    JOIN finance.financial_documents original ON original.id=note.correction_of_document_id
    JOIN finance.customer_documents collection ON collection.financial_document_id=original.id
    WHERE collection.id=NEW.customer_document_id AND original.id=NEW.original_document_id
      AND note.id=NEW.correction_document_id AND original.document_type='invoice'
      AND original.status='issued' AND original.source_pos_sale_id IS NULL
      AND collection.review_state<>'cancelled' AND note.status='issued'
      AND note.legal_entity_id=original.legal_entity_id
      AND note.customer_partner_id=original.customer_partner_id
      AND note.customer_partner_id=collection.customer_partner_id
      AND note.currency_code=original.currency_code AND note.currency_code=collection.currency_code
      AND note.document_type=NEW.document_type AND note.issue_date=NEW.document_date
      AND note.currency_code=NEW.currency_code AND note.gross_total=NEW.amount
      AND note.eur_gross_total=NEW.eur_amount
  ) THEN RAISE EXCEPTION 'Collection correction must match its issued note and original invoice'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER validate_collection_correction BEFORE INSERT ON finance.collection_corrections
  FOR EACH ROW EXECUTE FUNCTION finance.validate_collection_correction();
CREATE FUNCTION finance.protect_collection_correction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Collection corrections are append-only';
END;
$$;
CREATE TRIGGER protect_collection_correction BEFORE UPDATE OR DELETE ON finance.collection_corrections
  FOR EACH ROW EXECUTE FUNCTION finance.protect_collection_correction();

CREATE FUNCTION finance.refresh_collection_corrections(collection_id uuid, actor uuid, reason text, business_date date)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  current_row finance.customer_documents%ROWTYPE;
  credit numeric(18,4);
  debit numeric(18,4);
  remaining numeric(18,4);
  next_status varchar(20);
BEGIN
  SELECT * INTO STRICT current_row FROM finance.customer_documents WHERE id=collection_id FOR UPDATE;
  SELECT coalesce(sum(amount) FILTER(WHERE document_type='credit_note'),0),
    coalesce(sum(amount) FILTER(WHERE document_type='debit_note'),0)
  INTO credit,debit FROM finance.collection_corrections WHERE customer_document_id=collection_id;
  IF current_row.review_state='cancelled' THEN RAISE EXCEPTION 'A cancelled collection cannot receive corrections'; END IF;
  remaining:=greatest(current_row.total-credit+debit-current_row.allocated_total,0);
  next_status:=CASE WHEN remaining=0 THEN 'paid' WHEN current_row.due_date<business_date THEN 'overdue'
    WHEN current_row.allocated_total=0 THEN 'unpaid' ELSE 'partially_paid' END;
  IF credit=current_row.credit_total AND debit=current_row.debit_total
    AND remaining=current_row.outstanding_total AND next_status=current_row.payment_status THEN RETURN; END IF;
  UPDATE finance.customer_documents SET credit_total=credit,debit_total=debit,outstanding_total=remaining,
    payment_status=next_status,version=version+1,updated_at=now() WHERE id=collection_id;
  IF next_status<>current_row.payment_status THEN
    INSERT INTO finance.payment_status_history(id,customer_document_id,previous_status,next_status,reason,changed_by)
      VALUES(gen_random_uuid(),collection_id,current_row.payment_status,next_status,reason,actor);
  END IF;
END;
$$;

-- Existing issued notes affect eligible, already-linked collections exactly once.
-- POS receipt settlements and legacy invoices without a collection stay separate.
INSERT INTO finance.collection_corrections(customer_document_id,original_document_id,correction_document_id,
  document_type,document_date,currency_code,amount,eur_amount,origin,actor_account_id,correlation_id)
SELECT collection.id,original.id,note.id,note.document_type,note.issue_date,note.currency_code,
  note.gross_total,note.eur_gross_total,'migration',coalesce(note.issued_by,note.created_by),gen_random_uuid()
FROM finance.financial_documents note
JOIN finance.financial_documents original ON original.id=note.correction_of_document_id
JOIN finance.customer_documents collection ON collection.financial_document_id=original.id
WHERE note.status='issued' AND note.document_type IN ('credit_note','debit_note') AND original.status='issued'
  AND original.document_type='invoice' AND original.source_pos_sale_id IS NULL
  AND collection.review_state<>'cancelled';
DO $$ DECLARE target uuid; BEGIN
  FOR target IN SELECT DISTINCT customer_document_id FROM finance.collection_corrections LOOP
    PERFORM finance.refresh_collection_corrections(target,NULL,'correction_migration',(now() AT TIME ZONE 'Europe/Sofia')::date);
  END LOOP;
END $$;
COMMENT ON TABLE finance.collection_corrections IS
  'Append-only issued credit/debit-note effects on the original non-POS collection. Source-currency and EUR snapshots are retained. Excess paid funds remain visible as customer credit, never automatically refunded or turned into advances.';
