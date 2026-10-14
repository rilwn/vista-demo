-- One-time local/test-data currency transition. 1 EUR = 1.95583 BGN.
-- Keep precision rules explicit and reconcile after this migration. The
-- conversion is rounded to four decimal places and cannot be exactly reversed.

CREATE TABLE platform.currency_transition_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transition_code varchar(60) NOT NULL UNIQUE,
  source_currency char(3) NOT NULL,
  target_currency char(3) NOT NULL,
  conversion_rate numeric(18, 8) NOT NULL,
  converted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT currency_transition_direction_valid CHECK (
    source_currency = 'BGN' AND target_currency = 'EUR' AND conversion_rate = 1.95583000
  )
);

INSERT INTO platform.currency_transition_runs (
  transition_code, source_currency, target_currency, conversion_rate
) VALUES ('bgn-to-eur-2026-10', 'BGN', 'EUR', 1.95583000);

-- Remove BGN-only and cross-field cost constraints while values are converted.
ALTER TABLE finance.customer_documents DROP CONSTRAINT finance_document_bgn_only;
ALTER TABLE finance.payments DROP CONSTRAINT finance_payment_bgn_only;
ALTER TABLE finance.bank_statements DROP CONSTRAINT finance_bank_statement_bgn_only;
ALTER TABLE finance.cash_vouchers DROP CONSTRAINT finance_cash_voucher_bgn_only;
ALTER TABLE finance.supplier_payables DROP CONSTRAINT finance_supplier_payable_bgn_only;
ALTER TABLE finance.supplier_payments DROP CONSTRAINT finance_supplier_payment_bgn_only;
ALTER TABLE finance.customer_advances DROP CONSTRAINT customer_advance_currency_bgn;
ALTER TABLE pos.sales DROP CONSTRAINT pos_sale_currency_bgn;
ALTER TABLE finance.financial_documents DROP CONSTRAINT finance_document_bgn_rate_valid;
ALTER TABLE finance.financial_documents DROP CONSTRAINT finance_document_amounts_valid;
ALTER TABLE service.work_orders DROP CONSTRAINT service_work_order_total_reconciles;
ALTER TABLE service.work_order_part_usages DROP CONSTRAINT service_work_order_part_cost_reconciles;

-- Convert values whose currency is carried by a currency_code column.
UPDATE sales.quotations quotation
SET subtotal = round(subtotal / 1.95583, 4),
    vat_total = round(vat_total / 1.95583, 4),
    total = round(subtotal / 1.95583, 4) + round(vat_total / 1.95583, 4)
WHERE currency_code = 'BGN';
UPDATE sales.quotation_lines line
SET unit_price = round(unit_price / 1.95583, 4),
    line_total = round(line_total / 1.95583, 4)
FROM sales.quotations quotation
WHERE quotation.id = line.quotation_id AND quotation.currency_code = 'BGN';

UPDATE sales.invoices invoice
SET subtotal = round(subtotal / 1.95583, 4),
    vat_total = round(vat_total / 1.95583, 4),
    total = round(subtotal / 1.95583, 4) + round(vat_total / 1.95583, 4)
WHERE currency_code = 'BGN';
UPDATE sales.invoice_lines line
SET unit_price = round(unit_price / 1.95583, 4),
    line_total = round(line_total / 1.95583, 4)
FROM sales.invoices invoice
WHERE invoice.id = line.invoice_id AND invoice.currency_code = 'BGN';

UPDATE sales.price_list_lines line
SET unit_price = round(unit_price / 1.95583, 4)
FROM sales.price_lists list
WHERE list.id = line.price_list_id AND list.currency_code = 'BGN';

UPDATE procurement.purchase_order_lines line
SET unit_price = round(unit_price / 1.95583, 4)
FROM procurement.purchase_orders purchase_order
WHERE purchase_order.id = line.purchase_order_id AND purchase_order.currency_code = 'BGN';
UPDATE procurement.supplier_invoice_lines line
SET unit_price = round(unit_price / 1.95583, 4)
FROM procurement.supplier_invoices invoice
WHERE invoice.id = line.supplier_invoice_id AND invoice.currency_code = 'BGN';

UPDATE sales.service_subscription_contracts
SET billing_amount = round(billing_amount / 1.95583, 4)
WHERE currency_code = 'BGN';
UPDATE sales.subscription_invoice_drafts
SET amount = round(amount / 1.95583, 4)
WHERE currency_code = 'BGN';

UPDATE finance.financial_document_lines line
SET unit_price = round(unit_price / 1.95583, 4),
    net_total = round(line.net_total / 1.95583, 4),
    vat_amount = round(line.vat_amount / 1.95583, 4),
    gross_total = round(line.net_total / 1.95583, 4) + round(line.vat_amount / 1.95583, 4)
FROM finance.financial_documents document
WHERE document.id = line.financial_document_id AND document.currency_code = 'BGN';
UPDATE finance.financial_document_vat_summary summary
SET net_total = round(summary.net_total / 1.95583, 4),
    vat_amount = round(summary.vat_amount / 1.95583, 4)
FROM finance.financial_documents document
WHERE document.id = summary.financial_document_id AND document.currency_code = 'BGN';
UPDATE finance.financial_documents document
SET net_total = round(net_total / 1.95583, 4),
    vat_total = round(vat_total / 1.95583, 4),
    gross_total = round(net_total / 1.95583, 4) + round(vat_total / 1.95583, 4),
    exchange_rate = 1,
    rate_source = 'internal_eur'
WHERE currency_code = 'BGN';

UPDATE finance.customer_documents
SET total = round(total / 1.95583, 4),
    allocated_total = round(allocated_total / 1.95583, 4),
    outstanding_total = round(total / 1.95583, 4) - round(allocated_total / 1.95583, 4),
    exchange_rate = 1,
    rate_source = 'internal_eur_review'
WHERE currency_code = 'BGN';
UPDATE finance.payments SET amount = round(amount / 1.95583, 4) WHERE currency_code = 'BGN';
UPDATE finance.payment_allocations allocation
SET amount = round(allocation.amount / 1.95583, 4)
FROM finance.payments payment
WHERE payment.id = allocation.payment_id AND payment.currency_code = 'BGN';

UPDATE finance.bank_transactions transaction
SET amount = round(transaction.amount / 1.95583, 4)
FROM finance.bank_statements statement
WHERE statement.id = transaction.bank_statement_id AND statement.currency_code = 'BGN';
UPDATE finance.bank_statements
SET opening_balance = round(opening_balance / 1.95583, 4),
    closing_balance = round(closing_balance / 1.95583, 4)
WHERE currency_code = 'BGN';
UPDATE finance.cash_vouchers SET amount = round(amount / 1.95583, 4) WHERE currency_code = 'BGN';

UPDATE finance.supplier_payables
SET total = round(total / 1.95583, 4),
    allocated_total = round(allocated_total / 1.95583, 4),
    outstanding_total = round(total / 1.95583, 4) - round(allocated_total / 1.95583, 4),
    exchange_rate = 1,
    rate_source = 'internal_eur_review'
WHERE currency_code = 'BGN';
UPDATE finance.supplier_payments
SET amount = round(amount / 1.95583, 4),
    allocated_total = round(allocated_total / 1.95583, 4),
    available_total = round(amount / 1.95583, 4) - round(allocated_total / 1.95583, 4)
WHERE currency_code = 'BGN';
UPDATE finance.supplier_payment_allocations allocation
SET amount = round(allocation.amount / 1.95583, 4)
FROM finance.supplier_payments payment
WHERE payment.id = allocation.supplier_payment_id AND payment.currency_code = 'BGN';
UPDATE finance.supplier_offsets SET amount = round(amount / 1.95583, 4);

UPDATE pos.sales
SET net_total = round(net_total / 1.95583, 4),
    vat_total = round(vat_total / 1.95583, 4),
    gross_total = round(net_total / 1.95583, 4) + round(vat_total / 1.95583, 4),
    base_net_total = round(base_net_total / 1.95583, 4),
    automatic_discount_total = round(automatic_discount_total / 1.95583, 4),
    manual_discount_total = round(manual_discount_total / 1.95583, 4),
    loyalty_discount_total = round(loyalty_discount_total / 1.95583, 4)
WHERE currency_code = 'BGN';
UPDATE pos.sale_lines line
SET unit_price = round(line.unit_price / 1.95583, 4),
    net_total = round(line.net_total / 1.95583, 4),
    vat_total = round(line.vat_total / 1.95583, 4),
    gross_total = round(line.net_total / 1.95583, 4) + round(line.vat_total / 1.95583, 4),
    base_net_total = round(line.base_net_total / 1.95583, 4),
    automatic_discount_total = round(line.automatic_discount_total / 1.95583, 4),
    manual_discount_total = round(line.manual_discount_total / 1.95583, 4),
    loyalty_discount_total = round(line.loyalty_discount_total / 1.95583, 4)
FROM pos.sales sale
WHERE sale.id = line.sale_id AND sale.currency_code = 'BGN';
UPDATE pos.payments payment
SET amount = round(payment.amount / 1.95583, 4),
    tendered_amount = CASE WHEN tendered_amount IS NULL THEN NULL ELSE round(tendered_amount / 1.95583, 4) END,
    change_amount = CASE WHEN tendered_amount IS NULL THEN 0
      ELSE round(tendered_amount / 1.95583, 4) - round(amount / 1.95583, 4) END;
UPDATE pos.returns
SET net_total = round(net_total / 1.95583, 4),
    vat_total = round(vat_total / 1.95583, 4),
    gross_total = round(net_total / 1.95583, 4) + round(vat_total / 1.95583, 4);
UPDATE pos.return_lines
SET net_total = round(net_total / 1.95583, 4),
    vat_total = round(vat_total / 1.95583, 4),
    gross_total = round(net_total / 1.95583, 4) + round(vat_total / 1.95583, 4);
UPDATE pos.return_refunds SET amount = round(amount / 1.95583, 4);

UPDATE finance.customer_advances SET amount = round(amount / 1.95583, 4);
ALTER TABLE finance.customer_advance_entries DISABLE TRIGGER customer_advance_entries_append_only;
UPDATE finance.customer_advance_entries SET amount = round(amount / 1.95583, 4);
ALTER TABLE finance.customer_advance_entries ENABLE TRIGGER customer_advance_entries_append_only;
ALTER TABLE finance.customer_account_entries DISABLE TRIGGER customer_account_entries_append_only;
UPDATE finance.customer_account_entries SET amount = round(amount / 1.95583, 4);

UPDATE sales.pos_commercial_rules
SET discount_value = round(discount_value / 1.95583, 4)
WHERE discount_type = 'fixed_amount';
UPDATE pos.discount_authorizations
SET discount_value = round(discount_value / 1.95583, 4)
WHERE discount_type = 'fixed_amount';

-- Rename legacy BGN-value columns and convert them, including stock and service
-- valuation, finance accounting snapshots, CRM opportunity amounts, and POS cash.
DO $$
DECLARE
  item record;
  new_name text;
  scale_digits integer;
BEGIN
  FOR item IN
    SELECT table_schema, table_name, column_name, data_type, numeric_scale,
      is_generated
    FROM information_schema.columns
    WHERE table_schema IN ('finance', 'inventory', 'procurement', 'service', 'crm', 'pos', 'sales')
      AND (column_name LIKE '%\_bgn' ESCAPE '\' OR column_name LIKE 'bgn\_%' ESCAPE '\')
    ORDER BY table_schema, table_name, ordinal_position
  LOOP
    IF item.column_name = 'earn_points_per_bgn' THEN
      new_name := 'earn_points_per_eur';
    ELSIF item.column_name LIKE 'bgn\_%' ESCAPE '\' THEN
      new_name := 'eur_' || substr(item.column_name, 5);
    ELSE
      new_name := left(item.column_name, length(item.column_name) - 4) || '_eur';
    END IF;

    EXECUTE format('ALTER TABLE %I.%I RENAME COLUMN %I TO %I',
      item.table_schema, item.table_name, item.column_name, new_name);

    IF item.is_generated = 'NEVER' AND item.data_type = 'numeric'
       AND item.column_name <> 'earn_points_per_bgn' THEN
      scale_digits := COALESCE(item.numeric_scale, 4);
      EXECUTE format('UPDATE %I.%I SET %I = round(%I / 1.95583, %s)',
        item.table_schema, item.table_name, new_name, new_name, scale_digits);
    ELSIF item.column_name = 'earn_points_per_bgn' THEN
      EXECUTE format('UPDATE %I.%I SET %I = greatest(round(%I * 1.95583), 1)',
        item.table_schema, item.table_name, new_name, new_name);
    END IF;
  END LOOP;
END;
$$;
ALTER TABLE finance.customer_account_entries ENABLE TRIGGER customer_account_entries_append_only;

-- Bring converted summary columns back into exact line-level balance after
-- fixed-precision rounding.
UPDATE finance.financial_documents
SET eur_gross_total = eur_net_total + eur_vat_total;
ALTER TABLE finance.financial_documents
  ADD CONSTRAINT finance_document_amounts_valid CHECK (
    net_total >= 0 AND vat_total >= 0 AND gross_total = net_total + vat_total
    AND eur_net_total >= 0 AND eur_vat_total >= 0
    AND eur_gross_total = eur_net_total + eur_vat_total
  );
UPDATE finance.customer_documents SET eur_total = total;
UPDATE finance.supplier_payables SET eur_total = total;
UPDATE service.work_orders
SET total_cost_eur = round(labor_cost_eur + parts_cost_eur + transport_cost_eur, 4);
UPDATE service.work_order_part_usages
SET total_cost_eur = round(quantity * unit_cost_eur, 4);

-- A legacy invoice/statement currency code identifies amounts that were stored
-- in BGN. Convert all such transaction amounts before moving the code to EUR.
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT table_schema, table_name
    FROM information_schema.columns
    WHERE column_name = 'currency_code'
      AND table_schema IN ('master_data', 'sales', 'procurement', 'finance', 'pos')
  LOOP
    EXECUTE format('UPDATE %I.%I SET currency_code = ''EUR'' WHERE currency_code = ''BGN''',
      item.table_schema, item.table_name);
  END LOOP;
END;
$$;

-- Foreign-currency documents previously stored their accounting snapshot in
-- BGN. The renamed EUR snapshot is already converted; update the rate basis.
-- EUR-denominated documents are now in the accounting currency, so their
-- source amount remains unchanged and their converted EUR rate is exactly 1.
-- Older versions stored the BGN-per-EUR rate and source label for these rows.
UPDATE finance.financial_documents
SET exchange_rate = 1,
    rate_source = 'internal_eur'
WHERE currency_code = 'EUR';

UPDATE finance.financial_documents
SET exchange_rate = round(exchange_rate / 1.95583, 8)
WHERE currency_code <> 'EUR' AND rate_source <> 'internal_eur';

ALTER TABLE master_data.partner_bank_accounts ALTER COLUMN currency_code SET DEFAULT 'EUR';
ALTER TABLE pos.sales ALTER COLUMN currency_code SET DEFAULT 'EUR';
ALTER TABLE finance.cash_vouchers ALTER COLUMN currency_code SET DEFAULT 'EUR';
ALTER TABLE finance.customer_advances ALTER COLUMN currency_code SET DEFAULT 'EUR';
ALTER TABLE finance.financial_documents
  ADD CONSTRAINT finance_document_eur_rate_valid CHECK (
    currency_code <> 'EUR' OR (exchange_rate = 1 AND rate_source = 'internal_eur')
  );

-- Enforce the decision at the database boundary too: BGN cannot be written to
-- any active currency-bearing record after this one-time conversion.
DO $$
DECLARE
  item record;
  constraint_name text;
BEGIN
  FOR item IN
    SELECT table_schema, table_name
    FROM information_schema.columns
    WHERE column_name = 'currency_code'
      AND table_schema IN ('master_data', 'sales', 'procurement', 'finance', 'pos')
  LOOP
    constraint_name := left(item.table_name || '_currency_no_bgn', 63);
    EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I CHECK (currency_code <> ''BGN'')',
      item.table_schema, item.table_name, constraint_name);
  END LOOP;
END;
$$;

COMMENT ON TABLE platform.currency_transition_runs IS
  'Records the one-time BGN-to-EUR development/test data conversion rate and execution time.';
