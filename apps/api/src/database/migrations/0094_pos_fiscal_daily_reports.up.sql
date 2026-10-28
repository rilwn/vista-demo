CREATE TABLE pos.fiscal_daily_reports (
  id uuid PRIMARY KEY,
  shift_id uuid NOT NULL REFERENCES pos.shifts(id) ON DELETE RESTRICT,
  cash_register_id uuid NOT NULL
    REFERENCES organization.cash_registers(id) ON DELETE RESTRICT,
  operator_id uuid NOT NULL REFERENCES organization.operators(id) ON DELETE RESTRICT,
  cashier_account_id uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  report_type varchar(1) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'prepared',
  closing_cash_eur numeric(18, 4),
  shift_version integer,
  fiscal_record_number varchar(4),
  non_vat_sales_total_eur numeric(18, 2),
  tax_group_totals jsonb,
  failure_reason varchar(40),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT pos_fiscal_daily_report_type_valid CHECK (report_type IN ('x', 'z')),
  CONSTRAINT pos_fiscal_daily_report_status_valid CHECK (
    status IN ('prepared', 'printing', 'outcome_unknown', 'completed', 'failed')
  ),
  CONSTRAINT pos_fiscal_daily_report_close_snapshot_valid CHECK (
    (report_type = 'x' AND closing_cash_eur IS NULL AND shift_version IS NULL)
    OR (report_type = 'z' AND closing_cash_eur IS NOT NULL
      AND closing_cash_eur >= 0 AND shift_version IS NOT NULL AND shift_version > 0)
  ),
  CONSTRAINT pos_fiscal_daily_report_result_valid CHECK (
    (status = 'completed' AND fiscal_record_number IS NOT NULL
      AND non_vat_sales_total_eur IS NOT NULL
      AND jsonb_typeof(tax_group_totals) = 'object' AND completed_at IS NOT NULL)
    OR (status <> 'completed' AND fiscal_record_number IS NULL
      AND non_vat_sales_total_eur IS NULL AND tax_group_totals IS NULL
      AND completed_at IS NULL)
  ),
  CONSTRAINT pos_fiscal_daily_report_failure_valid CHECK (
    (status = 'failed' AND failure_reason = 'printer_rejected')
    OR (status <> 'failed' AND failure_reason IS NULL)
  ),
  CONSTRAINT pos_fiscal_daily_report_record_number_valid CHECK (
    fiscal_record_number IS NULL OR fiscal_record_number ~ '^[0-9]{1,4}$'
  )
);

CREATE UNIQUE INDEX pos_fiscal_daily_report_one_unresolved_per_register
  ON pos.fiscal_daily_reports (cash_register_id)
  WHERE status IN ('prepared', 'printing', 'outcome_unknown');

CREATE UNIQUE INDEX pos_fiscal_daily_report_one_z_per_shift
  ON pos.fiscal_daily_reports (shift_id)
  WHERE report_type = 'z' AND status <> 'failed';

CREATE INDEX pos_fiscal_daily_report_shift_history_idx
  ON pos.fiscal_daily_reports (shift_id, created_at DESC, id DESC);

COMMENT ON TABLE pos.fiscal_daily_reports IS
  'Audited DATECS X/Z report lifecycle. A Z report is confirmed together with shift closure.';
