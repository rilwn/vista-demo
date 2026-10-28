DROP TABLE pos.fiscal_return_preparations;
ALTER TABLE pos.returns
  DROP CONSTRAINT pos_return_datecs_evidence_valid,
  DROP COLUMN fiscal_reversals_since_daily_report,
  DROP COLUMN fiscal_document_number;
