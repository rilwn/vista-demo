CREATE TABLE procurement.supplier_profiles (
  supplier_partner_id uuid PRIMARY KEY REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  payment_terms_days integer,
  delivery_terms varchar(500),
  version integer NOT NULL DEFAULT 1,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_profile_payment_terms_valid CHECK (
    payment_terms_days IS NULL OR payment_terms_days BETWEEN 0 AND 3650
  ),
  CONSTRAINT supplier_profile_delivery_terms_trimmed CHECK (
    delivery_terms IS NULL OR (
      delivery_terms = btrim(delivery_terms) AND char_length(delivery_terms) > 0
    )
  ),
  CONSTRAINT supplier_profile_version_positive CHECK (version > 0)
);

CREATE TABLE procurement.supplier_evaluations (
  id uuid PRIMARY KEY,
  supplier_partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  score smallint NOT NULL,
  notes varchar(1000),
  evaluated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_evaluation_score_valid CHECK (score BETWEEN 1 AND 5),
  CONSTRAINT supplier_evaluation_notes_trimmed CHECK (
    notes IS NULL OR (notes = btrim(notes) AND char_length(notes) > 0)
  )
);

CREATE INDEX supplier_evaluations_supplier_date_idx
  ON procurement.supplier_evaluations (supplier_partner_id, evaluated_at DESC, id DESC);

ALTER TABLE procurement.purchase_order_lines
  ADD CONSTRAINT purchase_order_lines_id_order_unique UNIQUE (id, purchase_order_id);

CREATE TABLE procurement.supplier_invoices (
  id uuid PRIMARY KEY,
  purchase_order_id uuid NOT NULL REFERENCES procurement.purchase_orders(id) ON DELETE RESTRICT,
  supplier_partner_id uuid NOT NULL REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  supplier_invoice_number varchar(120) NOT NULL,
  invoice_date date NOT NULL,
  currency_code char(3) NOT NULL,
  recorded_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_invoice_id_order_unique UNIQUE (id, purchase_order_id),
  CONSTRAINT supplier_invoice_number_trimmed CHECK (
    supplier_invoice_number = btrim(supplier_invoice_number)
    AND char_length(supplier_invoice_number) > 0
  ),
  CONSTRAINT supplier_invoice_currency_uppercase CHECK (currency_code = upper(currency_code))
);

CREATE UNIQUE INDEX supplier_invoice_reference_unique
  ON procurement.supplier_invoices (supplier_partner_id, lower(supplier_invoice_number));
CREATE INDEX supplier_invoices_order_date_idx
  ON procurement.supplier_invoices (purchase_order_id, invoice_date DESC, id DESC);

CREATE TABLE procurement.supplier_invoice_lines (
  id uuid PRIMARY KEY,
  supplier_invoice_id uuid NOT NULL,
  purchase_order_id uuid NOT NULL,
  purchase_order_line_id uuid NOT NULL,
  quantity numeric(18, 4) NOT NULL,
  unit_price numeric(18, 4) NOT NULL,
  line_total numeric(18, 4) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_invoice_line_invoice_fk FOREIGN KEY (supplier_invoice_id, purchase_order_id)
    REFERENCES procurement.supplier_invoices(id, purchase_order_id) ON DELETE RESTRICT,
  CONSTRAINT supplier_invoice_line_order_fk FOREIGN KEY (purchase_order_line_id, purchase_order_id)
    REFERENCES procurement.purchase_order_lines(id, purchase_order_id) ON DELETE RESTRICT,
  CONSTRAINT supplier_invoice_line_unique UNIQUE (supplier_invoice_id, purchase_order_line_id),
  CONSTRAINT supplier_invoice_line_quantity_positive CHECK (quantity > 0),
  CONSTRAINT supplier_invoice_line_price_nonnegative CHECK (unit_price >= 0)
);

ALTER TABLE procurement.goods_receipts
  ADD CONSTRAINT goods_receipts_identity_unique
    UNIQUE (id, purchase_order_id, supplier_partner_id);
ALTER TABLE procurement.goods_receipt_lines
  ADD CONSTRAINT goods_receipt_lines_identity_unique UNIQUE (id, goods_receipt_id);

CREATE TABLE procurement.supplier_claims (
  id uuid PRIMARY KEY,
  supplier_partner_id uuid NOT NULL,
  purchase_order_id uuid NOT NULL,
  goods_receipt_id uuid NOT NULL,
  goods_receipt_line_id uuid NOT NULL,
  claim_type varchar(30) NOT NULL,
  quantity numeric(18, 4) NOT NULL,
  description varchar(2000) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'open',
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_claim_receipt_fk FOREIGN KEY (
    goods_receipt_id, purchase_order_id, supplier_partner_id
  ) REFERENCES procurement.goods_receipts(id, purchase_order_id, supplier_partner_id)
    ON DELETE RESTRICT,
  CONSTRAINT supplier_claim_receipt_line_fk FOREIGN KEY (goods_receipt_line_id, goods_receipt_id)
    REFERENCES procurement.goods_receipt_lines(id, goods_receipt_id) ON DELETE RESTRICT,
  CONSTRAINT supplier_claim_type_valid CHECK (claim_type IN ('damaged', 'non_conforming')),
  CONSTRAINT supplier_claim_quantity_positive CHECK (quantity > 0),
  CONSTRAINT supplier_claim_description_trimmed CHECK (
    description = btrim(description) AND char_length(description) > 0
  ),
  CONSTRAINT supplier_claim_status_valid CHECK (status IN ('open', 'submitted', 'resolved', 'closed')),
  CONSTRAINT supplier_claim_version_positive CHECK (version > 0)
);

CREATE INDEX supplier_claims_supplier_status_idx
  ON procurement.supplier_claims (supplier_partner_id, status, created_at DESC, id DESC);

CREATE TABLE procurement.supplier_claim_status_history (
  id uuid PRIMARY KEY,
  supplier_claim_id uuid NOT NULL REFERENCES procurement.supplier_claims(id) ON DELETE RESTRICT,
  from_status varchar(30),
  to_status varchar(30) NOT NULL,
  note varchar(1000),
  changed_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_claim_history_from_valid CHECK (
    from_status IS NULL OR from_status IN ('open', 'submitted', 'resolved', 'closed')
  ),
  CONSTRAINT supplier_claim_history_to_valid CHECK (
    to_status IN ('open', 'submitted', 'resolved', 'closed')
  ),
  CONSTRAINT supplier_claim_history_note_trimmed CHECK (
    note IS NULL OR (note = btrim(note) AND char_length(note) > 0)
  )
);

CREATE INDEX supplier_claim_history_claim_date_idx
  ON procurement.supplier_claim_status_history (supplier_claim_id, changed_at, id);

COMMENT ON TABLE procurement.supplier_invoices IS
  'Supplier-provided invoice evidence for procurement comparison. Accounting posting remains a separate finance workflow.';
COMMENT ON TABLE procurement.supplier_evaluations IS
  'Immutable overall 1–5 assessments with notes; no hard-coded vendor-specific dimensions.';
