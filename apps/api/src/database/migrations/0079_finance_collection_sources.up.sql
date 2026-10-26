-- An issued invoice/proforma can originate outside Sales (manual, Service or
-- subscription). Keep the existing Sales link and require at least one source.
ALTER TABLE finance.customer_documents
  ALTER COLUMN source_sales_invoice_id DROP NOT NULL,
  ADD CONSTRAINT finance_collection_source_required CHECK (
    source_sales_invoice_id IS NOT NULL OR financial_document_id IS NOT NULL
  );

-- Scope-specific number ranges share the existing legal-entity high watermark.
-- Existing official numbers remain unchanged and can never be reallocated.
CREATE TABLE finance.official_number_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL UNIQUE,
  legal_entity_id uuid NOT NULL REFERENCES organization.legal_entities(id) ON DELETE RESTRICT,
  business_location_id uuid NOT NULL REFERENCES organization.business_locations(id) ON DELETE RESTRICT,
  cash_register_id uuid REFERENCES organization.cash_registers(id) ON DELETE RESTRICT,
  operator_id uuid REFERENCES organization.operators(id) ON DELETE RESTRICT,
  next_value bigint NOT NULL DEFAULT 1,
  range_end bigint NOT NULL DEFAULT 0,
  CHECK (next_value >= 1 AND range_end BETWEEN 0 AND 9999999999 AND next_value <= range_end + 1)
);
ALTER TABLE finance.financial_documents
  ADD COLUMN official_number_series_id uuid
    REFERENCES finance.official_number_series(id) ON DELETE RESTRICT;

COMMENT ON TABLE finance.official_number_series IS
  'Independent location/register/operator sequences using disjoint numeric ranges allocated from the legal-entity high watermark. Exhausted ranges renew without reusing an issued number.';
