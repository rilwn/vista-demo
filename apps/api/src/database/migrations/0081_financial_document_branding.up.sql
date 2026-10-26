CREATE TABLE finance.document_branding (
  legal_entity_id uuid PRIMARY KEY REFERENCES organization.legal_entities(id) ON DELETE RESTRICT,
  logo_file_id uuid REFERENCES files.objects(id) ON DELETE RESTRICT,
  signature_file_id uuid REFERENCES files.objects(id) ON DELETE RESTRICT,
  signatory_name varchar(120),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((signature_file_id IS NULL AND signatory_name IS NULL) OR
    (signature_file_id IS NOT NULL AND signatory_name IS NOT NULL AND length(btrim(signatory_name)) > 0))
);
ALTER TABLE finance.financial_documents ADD COLUMN branding_snapshot jsonb;
ALTER TABLE finance.financial_documents ADD CONSTRAINT finance_branding_snapshot_object
  CHECK (branding_snapshot IS NULL OR jsonb_typeof(branding_snapshot) = 'object');
CREATE FUNCTION finance.protect_document_branding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'issued' AND NEW.branding_snapshot IS DISTINCT FROM OLD.branding_snapshot THEN
    RAISE EXCEPTION 'Issued document branding cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_document_branding BEFORE UPDATE ON finance.financial_documents
  FOR EACH ROW EXECUTE FUNCTION finance.protect_document_branding();
COMMENT ON COLUMN finance.financial_documents.branding_snapshot IS
  'Exact managed-file versions and signature name selected on issue. Legacy issued documents remain unbranded; images are visual signatures, not certificate-based digital signatures.';
