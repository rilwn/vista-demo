CREATE INDEX partners_payment_status_search_idx
  ON master_data.partners (normalized_name text_pattern_ops);

CREATE INDEX finance_customer_documents_number_search_idx
  ON finance.customer_documents (lower(document_number) text_pattern_ops);

CREATE INDEX finance_issued_number_search_idx
  ON finance.financial_documents (lower(official_number) text_pattern_ops)
  WHERE status = 'issued' AND official_number IS NOT NULL;

CREATE INDEX finance_issued_draft_number_search_idx
  ON finance.financial_documents (lower(draft_number) text_pattern_ops)
  WHERE status = 'issued' AND draft_number IS NOT NULL;

CREATE INDEX sales_invoice_number_search_idx
  ON sales.invoices (lower(invoice_number) text_pattern_ops);

CREATE INDEX pos_sale_number_search_idx
  ON pos.sales (lower(sale_number) text_pattern_ops);

CREATE INDEX pos_fiscal_receipt_search_idx
  ON pos.sales (lower(fiscal_receipt_number) text_pattern_ops)
  WHERE fiscal_receipt_number IS NOT NULL;

CREATE INDEX customer_account_open_charge_register_idx
  ON finance.customer_account_entries (customer_partner_id, due_on, pos_sale_id)
  WHERE entry_type = 'charge';
