CREATE TABLE finance.recurring_invoice_profiles (
  contract_id uuid PRIMARY KEY REFERENCES sales.service_subscription_contracts(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL,
  legal_entity_id uuid NOT NULL REFERENCES organization.legal_entities(id) ON DELETE RESTRICT,
  business_location_id uuid NOT NULL REFERENCES organization.business_locations(id) ON DELETE RESTRICT,
  cash_register_id uuid REFERENCES organization.cash_registers(id) ON DELETE RESTRICT,
  operator_id uuid REFERENCES organization.operators(id) ON DELETE RESTRICT,
  first_billing_date date NOT NULL,
  payment_terms_days integer NOT NULL CHECK (payment_terms_days BETWEEN 0 AND 3650),
  vat_treatment varchar(40) NOT NULL CHECK (vat_treatment IN ('standard_20','reduced_9','zero','exempt','ica')),
  vat_rate numeric(7,4),
  approved_contract_version integer NOT NULL CHECK (approved_contract_version > 0),
  approved_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((vat_treatment = 'ica' AND vat_rate IS NOT NULL AND vat_rate BETWEEN 0 AND 100)
    OR (vat_treatment <> 'ica' AND vat_rate IS NULL))
);

CREATE TABLE finance.recurring_invoice_runs (
  billing_draft_id uuid PRIMARY KEY REFERENCES sales.subscription_invoice_drafts(id) ON DELETE RESTRICT,
  contract_id uuid NOT NULL REFERENCES finance.recurring_invoice_profiles(contract_id) ON DELETE RESTRICT,
  profile_version integer NOT NULL CHECK (profile_version > 0),
  contract_version integer NOT NULL CHECK (contract_version > 0),
  status varchar(20) NOT NULL CHECK (status IN ('issued','needs_review','retry')),
  financial_document_id uuid REFERENCES finance.financial_documents(id) ON DELETE RESTRICT,
  attempt_count integer NOT NULL CHECK (attempt_count > 0),
  error_code varchar(100),
  processed_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'issued' AND financial_document_id IS NOT NULL AND error_code IS NULL)
    OR (status IN ('needs_review','retry') AND error_code IS NOT NULL AND financial_document_id IS NULL))
);
CREATE INDEX recurring_invoice_runs_contract_idx ON finance.recurring_invoice_runs (contract_id, processed_at DESC);
COMMENT ON TABLE finance.recurring_invoice_profiles IS
  'Explicit Finance approval of automatic issuance for a contract revision, issuer, VAT and payment terms. Existing contracts are not enrolled automatically.';
COMMENT ON TABLE finance.recurring_invoice_runs IS
  'One recoverable issuance outcome per immutable billing period. Invoice, collection, audit and outcome commit together.';
