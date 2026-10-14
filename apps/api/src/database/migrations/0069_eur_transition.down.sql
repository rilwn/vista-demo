-- EUR conversion rounds to the stored precision. Rolling a populated database
-- back by multiplying would corrupt amounts, so populated systems must restore
-- their verified pre-transition backup instead.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM sales.quotations)
     OR EXISTS (SELECT 1 FROM sales.invoices)
     OR EXISTS (SELECT 1 FROM sales.price_lists)
     OR EXISTS (SELECT 1 FROM procurement.purchase_orders)
     OR EXISTS (SELECT 1 FROM procurement.supplier_invoices)
     OR EXISTS (SELECT 1 FROM finance.financial_documents)
     OR EXISTS (SELECT 1 FROM finance.customer_documents)
     OR EXISTS (SELECT 1 FROM finance.payments)
     OR EXISTS (SELECT 1 FROM finance.bank_statements)
     OR EXISTS (SELECT 1 FROM finance.cash_vouchers)
     OR EXISTS (SELECT 1 FROM finance.supplier_payables)
     OR EXISTS (SELECT 1 FROM finance.supplier_payments)
     OR EXISTS (SELECT 1 FROM finance.customer_advances)
     OR EXISTS (SELECT 1 FROM pos.sales)
     OR EXISTS (SELECT 1 FROM pos.returns)
     OR EXISTS (SELECT 1 FROM inventory.stock_movements)
     OR EXISTS (SELECT 1 FROM service.work_orders)
     OR EXISTS (SELECT 1 FROM crm.opportunities)
  THEN
    RAISE EXCEPTION
      'EUR transition rollback is blocked for a populated database. Restore the verified pre-transition backup.';
  END IF;
END;
$$;

-- Migration rehearsals use an empty schema, where this structural rollback is
-- safe and lets the full migration chain be tested in both directions.
DO $$
DECLARE
  item record;
  restored_column_name text;
BEGIN
  FOR item IN
    SELECT tc.table_schema, tc.table_name, tc.constraint_name AS existing_constraint_name
    FROM information_schema.table_constraints AS tc
    WHERE tc.constraint_type = 'CHECK'
      AND tc.table_schema IN ('master_data', 'sales', 'procurement', 'finance', 'pos')
      AND tc.constraint_name LIKE '%\_currency\_no\_bgn' ESCAPE '\'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I',
      item.table_schema, item.table_name, item.existing_constraint_name);
  END LOOP;

  FOR item IN
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema IN ('finance', 'inventory', 'procurement', 'service', 'crm', 'pos', 'sales')
      AND (column_name LIKE '%\_eur' ESCAPE '\' OR column_name LIKE 'eur\_%' ESCAPE '\')
    ORDER BY table_schema, table_name, ordinal_position
  LOOP
    IF item.column_name = 'earn_points_per_eur' THEN
      restored_column_name := 'earn_points_per_bgn';
    ELSIF item.column_name LIKE 'eur\_%' ESCAPE '\' THEN
      restored_column_name := 'bgn_' || substr(item.column_name, 5);
    ELSE
      restored_column_name := left(item.column_name, length(item.column_name) - 4) || '_bgn';
    END IF;
    EXECUTE format('ALTER TABLE %I.%I RENAME COLUMN %I TO %I',
      item.table_schema, item.table_name, item.column_name, restored_column_name);
  END LOOP;
END;
$$;

ALTER TABLE master_data.partner_bank_accounts ALTER COLUMN currency_code SET DEFAULT 'BGN';
ALTER TABLE pos.sales ALTER COLUMN currency_code SET DEFAULT 'BGN';
ALTER TABLE finance.cash_vouchers ALTER COLUMN currency_code SET DEFAULT 'BGN';
ALTER TABLE finance.customer_advances ALTER COLUMN currency_code SET DEFAULT 'BGN';

ALTER TABLE finance.customer_documents
  ADD CONSTRAINT finance_document_bgn_only CHECK (
    currency_code = 'BGN' AND exchange_rate = 1 AND bgn_total = total
      AND rate_source = 'internal_bgn_review'
  );
ALTER TABLE finance.payments
  ADD CONSTRAINT finance_payment_bgn_only CHECK (currency_code = 'BGN');
ALTER TABLE finance.bank_statements
  ADD CONSTRAINT finance_bank_statement_bgn_only CHECK (currency_code = 'BGN');
ALTER TABLE finance.cash_vouchers
  ADD CONSTRAINT finance_cash_voucher_bgn_only CHECK (currency_code = 'BGN');
ALTER TABLE finance.supplier_payables
  ADD CONSTRAINT finance_supplier_payable_bgn_only CHECK (
    currency_code = 'BGN' AND exchange_rate = 1 AND bgn_total = total
      AND rate_source = 'internal_bgn_review'
  );
ALTER TABLE finance.supplier_payments
  ADD CONSTRAINT finance_supplier_payment_bgn_only CHECK (currency_code = 'BGN');
ALTER TABLE finance.customer_advances
  ADD CONSTRAINT customer_advance_currency_bgn CHECK (currency_code = 'BGN');
ALTER TABLE pos.sales
  ADD CONSTRAINT pos_sale_currency_bgn CHECK (currency_code = 'BGN');
ALTER TABLE finance.financial_documents
  DROP CONSTRAINT finance_document_eur_rate_valid,
  ADD CONSTRAINT finance_document_bgn_rate_valid CHECK (
    currency_code <> 'BGN' OR (exchange_rate = 1 AND rate_source = 'internal_bgn')
  );

ALTER TABLE service.work_orders
  ADD CONSTRAINT service_work_order_total_reconciles CHECK (
    total_cost_bgn = round(labor_cost_bgn + parts_cost_bgn + transport_cost_bgn, 4)
  );
ALTER TABLE service.work_order_part_usages
  ADD CONSTRAINT service_work_order_part_cost_reconciles CHECK (
    total_cost_bgn = round(quantity * unit_cost_bgn, 4)
  );

DROP TABLE platform.currency_transition_runs;
