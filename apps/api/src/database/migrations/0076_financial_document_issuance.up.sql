-- Keep working references separate from Bulgarian legal invoice numbers.
-- The sequence is scoped to the legal entity, concurrency-safe, and never
-- rewound by a cancelled draft or correction document.
CREATE TABLE finance.official_document_sequences (
  legal_entity_id uuid PRIMARY KEY
    REFERENCES organization.legal_entities(id) ON DELETE RESTRICT,
  next_value bigint NOT NULL DEFAULT 1,
  CONSTRAINT finance_official_document_sequence_range CHECK (
    next_value BETWEEN 1 AND 10000000000
  )
);

ALTER TABLE finance.financial_documents
  ADD COLUMN issued_at timestamptz,
  ADD COLUMN issued_by uuid REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  ADD COLUMN converted_from_document_id uuid
    REFERENCES finance.financial_documents(id) ON DELETE RESTRICT;

ALTER TABLE finance.financial_documents
  DROP CONSTRAINT finance_document_status_valid,
  DROP CONSTRAINT finance_document_cancellation_valid,
  ADD CONSTRAINT finance_document_status_valid CHECK (status IN ('draft', 'issued', 'cancelled')),
  ADD CONSTRAINT finance_document_issue_state_valid CHECK (
    (status = 'draft' AND issued_at IS NULL AND issued_by IS NULL AND converted_from_document_id IS NULL)
    OR (status = 'issued' AND issued_at IS NOT NULL AND issued_by IS NOT NULL
      AND ((document_type = 'proforma' AND official_number IS NULL)
        OR (document_type <> 'proforma' AND official_number ~ '^[0-9]{10}$')))
    OR (status = 'cancelled' AND issued_at IS NULL AND issued_by IS NULL
      AND converted_from_document_id IS NULL AND official_number IS NULL)
  ),
  ADD CONSTRAINT finance_document_cancellation_valid CHECK (
    (status IN ('draft', 'issued') AND cancellation_reason IS NULL
      AND cancelled_at IS NULL AND cancelled_by IS NULL)
    OR (status = 'cancelled' AND cancellation_reason IS NOT NULL
      AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
  );

CREATE UNIQUE INDEX finance_financial_document_conversion_unique
  ON finance.financial_documents (converted_from_document_id)
  WHERE converted_from_document_id IS NOT NULL;

-- Store the reciprocal link on POS sales so an issued invoice can be found
-- from either the finance register or the original fiscal receipt.
ALTER TABLE pos.sales
  ADD COLUMN invoice_financial_document_id uuid UNIQUE
    REFERENCES finance.financial_documents(id) ON DELETE RESTRICT;

COMMENT ON TABLE finance.official_document_sequences IS
  'Ten-digit Bulgarian legal document sequence per legal entity. Allocation occurs in the same transaction as issue and numbers are never reused.';
COMMENT ON COLUMN finance.financial_documents.converted_from_document_id IS
  'The paid proforma invoice converted into this official invoice, when applicable.';
