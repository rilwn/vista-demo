ALTER TABLE finance.financial_documents
  ADD COLUMN source_subscription_draft_id uuid
    REFERENCES sales.subscription_invoice_drafts(id) ON DELETE RESTRICT;

ALTER TABLE finance.financial_documents ADD CONSTRAINT finance_subscription_source_valid CHECK (
  source_subscription_draft_id IS NULL OR (
    document_type = 'invoice' AND
    num_nonnulls(source_subscription_draft_id, source_sales_invoice_id,
                 source_service_work_order_id, source_pos_sale_id) = 1
  )
);

CREATE UNIQUE INDEX financial_document_subscription_draft_unique
  ON finance.financial_documents (source_subscription_draft_id)
  WHERE source_subscription_draft_id IS NOT NULL AND status <> 'cancelled';

COMMENT ON COLUMN finance.financial_documents.source_subscription_draft_id IS
  'Immutable recurring billing source; at most one active Finance review document per billing period.';
