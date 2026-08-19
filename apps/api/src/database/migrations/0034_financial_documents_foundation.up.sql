CREATE TABLE finance.draft_document_sequences (
  business_location_id uuid NOT NULL
    REFERENCES organization.business_locations(id) ON DELETE RESTRICT,
  cash_register_id uuid,
  operator_id uuid,
  document_type varchar(20) NOT NULL,
  sequence_year integer NOT NULL,
  next_value bigint NOT NULL DEFAULT 1,
  CONSTRAINT finance_draft_sequence_location_register_fk
    FOREIGN KEY (cash_register_id, business_location_id)
    REFERENCES organization.cash_registers(id, business_location_id) ON DELETE RESTRICT,
  CONSTRAINT finance_draft_sequence_location_operator_fk
    FOREIGN KEY (operator_id, business_location_id)
    REFERENCES organization.operators(id, business_location_id) ON DELETE RESTRICT,
  CONSTRAINT finance_draft_sequence_type_valid CHECK (
    document_type IN ('invoice', 'proforma', 'credit_note', 'debit_note')
  ),
  CONSTRAINT finance_draft_sequence_year_valid CHECK (sequence_year BETWEEN 2000 AND 9999),
  CONSTRAINT finance_draft_sequence_next_positive CHECK (next_value > 0)
);

CREATE UNIQUE INDEX finance_draft_document_sequence_scope_unique
  ON finance.draft_document_sequences (
    business_location_id,
    coalesce(cash_register_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(operator_id, '00000000-0000-0000-0000-000000000000'::uuid),
    document_type,
    sequence_year
  );

CREATE TABLE finance.financial_documents (
  id uuid PRIMARY KEY,
  draft_number varchar(80) NOT NULL UNIQUE,
  official_number varchar(80),
  document_type varchar(20) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft',
  legal_entity_id uuid NOT NULL REFERENCES organization.legal_entities(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES organization.branches(id) ON DELETE RESTRICT,
  business_location_id uuid NOT NULL
    REFERENCES organization.business_locations(id) ON DELETE RESTRICT,
  cash_register_id uuid,
  operator_id uuid,
  customer_partner_id uuid NOT NULL
    REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  source_sales_invoice_id uuid REFERENCES sales.invoices(id) ON DELETE RESTRICT,
  correction_of_document_id uuid REFERENCES finance.financial_documents(id) ON DELETE RESTRICT,
  correction_reason varchar(1000),
  issue_date date NOT NULL,
  tax_event_date date NOT NULL,
  due_date date,
  currency_code char(3) NOT NULL,
  exchange_rate numeric(18, 8) NOT NULL,
  rate_date date NOT NULL,
  rate_source varchar(120) NOT NULL,
  issuer_name varchar(255) NOT NULL,
  issuer_uic varchar(50),
  issuer_vat_number varchar(50),
  issuer_address varchar(700) NOT NULL,
  customer_name varchar(255) NOT NULL,
  customer_uic varchar(50),
  customer_vat_number varchar(50),
  customer_address varchar(700) NOT NULL,
  net_total numeric(18, 4) NOT NULL,
  vat_total numeric(18, 4) NOT NULL,
  gross_total numeric(18, 4) NOT NULL,
  bgn_net_total numeric(18, 4) NOT NULL,
  bgn_vat_total numeric(18, 4) NOT NULL,
  bgn_gross_total numeric(18, 4) NOT NULL,
  notes varchar(2000),
  cancellation_reason varchar(1000),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_document_type_valid CHECK (
    document_type IN ('invoice', 'proforma', 'credit_note', 'debit_note')
  ),
  CONSTRAINT finance_document_status_valid CHECK (status IN ('draft', 'cancelled')),
  CONSTRAINT finance_document_currency_uppercase CHECK (currency_code = upper(currency_code)),
  CONSTRAINT finance_document_exchange_rate_positive CHECK (exchange_rate > 0),
  CONSTRAINT finance_document_bgn_rate_valid CHECK (
    currency_code <> 'BGN' OR (exchange_rate = 1 AND rate_source = 'internal_bgn')
  ),
  CONSTRAINT finance_document_due_date_valid CHECK (due_date IS NULL OR due_date >= issue_date),
  CONSTRAINT finance_document_amounts_valid CHECK (
    net_total >= 0 AND vat_total >= 0 AND gross_total = net_total + vat_total
    AND bgn_net_total >= 0 AND bgn_vat_total >= 0
    AND bgn_gross_total = bgn_net_total + bgn_vat_total
  ),
  CONSTRAINT finance_document_correction_valid CHECK (
    (
      document_type IN ('invoice', 'proforma')
      AND correction_of_document_id IS NULL AND correction_reason IS NULL
    ) OR (
      document_type IN ('credit_note', 'debit_note')
      AND correction_of_document_id IS NOT NULL AND correction_reason IS NOT NULL
      AND char_length(btrim(correction_reason)) > 0
    )
  ),
  CONSTRAINT finance_document_not_self_correction CHECK (correction_of_document_id <> id),
  CONSTRAINT finance_document_cancellation_valid CHECK (
    (status = 'draft' AND cancellation_reason IS NULL AND cancelled_at IS NULL AND cancelled_by IS NULL)
    OR
    (status = 'cancelled' AND cancellation_reason IS NOT NULL
      AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
  ),
  CONSTRAINT finance_document_issuer_name_trimmed CHECK (
    issuer_name = btrim(issuer_name) AND char_length(issuer_name) > 0
  ),
  CONSTRAINT finance_document_customer_name_trimmed CHECK (
    customer_name = btrim(customer_name) AND char_length(customer_name) > 0
  ),
  CONSTRAINT finance_document_addresses_trimmed CHECK (
    issuer_address = btrim(issuer_address) AND char_length(issuer_address) > 0
    AND customer_address = btrim(customer_address) AND char_length(customer_address) > 0
  ),
  CONSTRAINT finance_document_rate_source_trimmed CHECK (
    rate_source = btrim(rate_source) AND char_length(rate_source) > 0
  ),
  CONSTRAINT finance_document_notes_trimmed CHECK (
    notes IS NULL OR (notes = btrim(notes) AND char_length(notes) > 0)
  ),
  CONSTRAINT finance_document_version_positive CHECK (version > 0),
  CONSTRAINT finance_document_location_register_fk
    FOREIGN KEY (cash_register_id, business_location_id)
    REFERENCES organization.cash_registers(id, business_location_id) ON DELETE RESTRICT,
  CONSTRAINT finance_document_location_operator_fk
    FOREIGN KEY (operator_id, business_location_id)
    REFERENCES organization.operators(id, business_location_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX finance_financial_document_official_number_unique
  ON finance.financial_documents (legal_entity_id, official_number)
  WHERE official_number IS NOT NULL;
CREATE UNIQUE INDEX finance_financial_document_source_type_unique
  ON finance.financial_documents (source_sales_invoice_id, document_type)
  WHERE source_sales_invoice_id IS NOT NULL AND status <> 'cancelled';
CREATE INDEX finance_financial_document_register_idx
  ON finance.financial_documents (issue_date DESC, id DESC);
CREATE INDEX finance_financial_document_customer_idx
  ON finance.financial_documents (customer_partner_id, issue_date DESC, id DESC);
CREATE INDEX finance_financial_document_correction_idx
  ON finance.financial_documents (correction_of_document_id)
  WHERE correction_of_document_id IS NOT NULL;

CREATE TABLE finance.financial_document_lines (
  id uuid PRIMARY KEY,
  financial_document_id uuid NOT NULL
    REFERENCES finance.financial_documents(id) ON DELETE RESTRICT,
  line_number integer NOT NULL,
  product_id uuid REFERENCES master_data.products(id) ON DELETE RESTRICT,
  description varchar(500) NOT NULL,
  unit_code varchar(30) NOT NULL,
  quantity numeric(18, 4) NOT NULL,
  unit_price numeric(18, 4) NOT NULL,
  discount_percent numeric(7, 4) NOT NULL DEFAULT 0,
  vat_treatment varchar(20) NOT NULL,
  vat_rate numeric(7, 4) NOT NULL,
  net_total numeric(18, 4) NOT NULL,
  vat_amount numeric(18, 4) NOT NULL,
  gross_total numeric(18, 4) NOT NULL,
  CONSTRAINT finance_document_line_number_unique UNIQUE (financial_document_id, line_number),
  CONSTRAINT finance_document_line_number_positive CHECK (line_number > 0),
  CONSTRAINT finance_document_line_description_trimmed CHECK (
    description = btrim(description) AND char_length(description) > 0
  ),
  CONSTRAINT finance_document_line_unit_trimmed CHECK (
    unit_code = upper(btrim(unit_code)) AND char_length(unit_code) > 0
  ),
  CONSTRAINT finance_document_line_quantity_positive CHECK (quantity > 0),
  CONSTRAINT finance_document_line_unit_price_nonnegative CHECK (unit_price >= 0),
  CONSTRAINT finance_document_line_discount_valid CHECK (
    discount_percent >= 0 AND discount_percent <= 100
  ),
  CONSTRAINT finance_document_line_vat_treatment_valid CHECK (
    vat_treatment IN ('standard_20', 'reduced_9', 'zero', 'exempt', 'ica')
  ),
  CONSTRAINT finance_document_line_vat_rate_valid CHECK (vat_rate >= 0 AND vat_rate <= 100),
  CONSTRAINT finance_document_line_required_rate_valid CHECK (
    (vat_treatment = 'standard_20' AND vat_rate = 20)
    OR (vat_treatment = 'reduced_9' AND vat_rate = 9)
    OR (vat_treatment IN ('zero', 'exempt') AND vat_rate = 0)
    OR vat_treatment = 'ica'
  ),
  CONSTRAINT finance_document_line_amounts_valid CHECK (
    net_total >= 0 AND vat_amount >= 0 AND gross_total = net_total + vat_amount
  )
);

CREATE INDEX finance_financial_document_lines_document_idx
  ON finance.financial_document_lines (financial_document_id, line_number);

CREATE TABLE finance.financial_document_vat_summary (
  id uuid PRIMARY KEY,
  financial_document_id uuid NOT NULL
    REFERENCES finance.financial_documents(id) ON DELETE RESTRICT,
  vat_treatment varchar(20) NOT NULL,
  vat_rate numeric(7, 4) NOT NULL,
  net_total numeric(18, 4) NOT NULL,
  vat_amount numeric(18, 4) NOT NULL,
  CONSTRAINT finance_document_vat_summary_unique
    UNIQUE (financial_document_id, vat_treatment, vat_rate),
  CONSTRAINT finance_document_vat_summary_treatment_valid CHECK (
    vat_treatment IN ('standard_20', 'reduced_9', 'zero', 'exempt', 'ica')
  ),
  CONSTRAINT finance_document_vat_summary_rate_valid CHECK (vat_rate >= 0 AND vat_rate <= 100),
  CONSTRAINT finance_document_vat_summary_amounts_valid CHECK (
    net_total >= 0 AND vat_amount >= 0
  )
);

CREATE INDEX finance_financial_document_vat_summary_document_idx
  ON finance.financial_document_vat_summary (financial_document_id, vat_treatment, vat_rate);

COMMENT ON TABLE finance.financial_documents IS
  'Structured financial document drafts with immutable issuer, customer, VAT, currency-rate, and source snapshots. Official legal issuance remains disabled until FIN-001, FIN-002, BUS-002, and DOC-001 are approved.';
COMMENT ON COLUMN finance.financial_documents.draft_number IS
  'Concurrency-safe internal workflow reference. It is not an official accounting or fiscal document number.';
COMMENT ON COLUMN finance.financial_documents.official_number IS
  'Reserved for the approved legal numbering workflow; always null in the foundation milestone.';
