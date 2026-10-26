DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM finance.document_branding) OR
     EXISTS (SELECT 1 FROM finance.financial_documents WHERE branding_snapshot IS NOT NULL AND branding_snapshot <> '{"version":0}'::jsonb) OR
     EXISTS (SELECT 1 FROM files.objects WHERE parent_type='financial_branding') THEN
    RAISE EXCEPTION 'Cannot downgrade document branding while settings, assets or document snapshots exist';
  END IF;
END $$;
DROP TRIGGER protect_document_branding ON finance.financial_documents;
DROP FUNCTION finance.protect_document_branding();
ALTER TABLE finance.financial_documents DROP COLUMN branding_snapshot;
DROP TABLE finance.document_branding;
