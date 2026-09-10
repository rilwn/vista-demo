import { Pool } from 'pg';

// Reporting fixtures only, not an alternate way to post business transactions.
function reportPool() {
  const url = new URL(process.env['DATABASE_URL'] ?? '');
  if (
    process.env['VISTA_E2E_ISOLATED'] !== 'true' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '58432' ||
    url.pathname !== '/vista_e2e' ||
    url.username !== 'vista_e2e'
  )
    throw Error('Large report fixtures require the disposable browser database.');
  return new Pool({ connectionString: url.href });
}

export async function prepareReportFamilyFixtures() {
  const pool = reportPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM service.requests WHERE request_number LIKE 'FAMILY-SVC-%'",
    );
    if (!existing.rows[0]?.count) {
      const requests = await client.query(`WITH employees AS (
        INSERT INTO identity.employees (employee_number, display_name, email, active)
        SELECT 'FAMILY-EMP-' || lpad(n::text,4,'0'), 'FAMILY-EMP-' || lpad(n::text,4,'0'),
          'family-report-' || n || '@example.invalid', false FROM generate_series(1,1001) n
        RETURNING id, employee_number
      ), accounts AS (
        INSERT INTO identity.user_accounts (employee_id, password_hash, status)
        SELECT id, 'disabled-report-fixture-no-login', 'disabled' FROM employees RETURNING id, employee_id
      ) INSERT INTO service.requests (id, request_number, customer_partner_id, customer_location_id,
        customer_equipment_id, source_channel, service_type, priority, problem_description,
        status, completed_at, created_by, updated_by, created_at, updated_at)
      SELECT gen_random_uuid(), replace(e.employee_number,'FAMILY-EMP-','FAMILY-SVC-'),
        r.customer_partner_id, r.customer_location_id, r.customer_equipment_id, 'telephone',
        'out_of_warranty', 'normal', 'Disposable report acceptance fixture', 'completed',
        '2026-01-15T12:00:00Z', r.created_by, a.id, '2026-01-15T10:00:00Z', '2026-01-15T12:00:00Z'
      FROM employees e JOIN accounts a ON a.employee_id=e.id
      CROSS JOIN (SELECT * FROM service.requests ORDER BY request_number LIMIT 1) r`);
      if (requests.rowCount !== 1001) throw Error('Service reporting fixture source is missing.');
      const invoices = await client.query(`WITH invoices AS (
        INSERT INTO procurement.supplier_invoices (id, purchase_order_id, supplier_partner_id,
          supplier_invoice_number, invoice_date, currency_code, recorded_by)
        SELECT gen_random_uuid(), s.purchase_order_id, s.supplier_partner_id,
          'FAMILY-FIN-' || lpad(n::text,4,'0'), '2026-01-15', 'BGN', s.recorded_by
        FROM (SELECT * FROM procurement.supplier_invoices ORDER BY supplier_invoice_number LIMIT 1) s
        CROSS JOIN generate_series(1,1001) n RETURNING id, purchase_order_id
      ) INSERT INTO procurement.supplier_invoice_lines (id, supplier_invoice_id, purchase_order_id,
        purchase_order_line_id, quantity, unit_price, vat_treatment, vat_rate)
      SELECT gen_random_uuid(), i.id, i.purchase_order_id, l.id, 1, 10, 'standard_20', 20
      FROM invoices i CROSS JOIN LATERAL (SELECT id FROM procurement.purchase_order_lines
        WHERE purchase_order_id=i.purchase_order_id ORDER BY id LIMIT 1) l`);
      if (invoices.rowCount !== 1001) throw Error('Finance reporting fixture source is missing.');
      const shifts = await client.query(`INSERT INTO pos.shifts (id, shift_number, cash_register_id,
        operator_id, warehouse_id, status, opening_cash_bgn, closing_cash_bgn, opened_by, opened_at,
        closed_by, closed_at)
        SELECT gen_random_uuid(), 'FAMILY-POS-' || lpad(n::text,4,'0'), s.cash_register_id,
          s.operator_id, s.warehouse_id, 'closed', 0, 0, s.opened_by, '2026-01-15T10:00:00Z',
          s.opened_by, '2026-01-15T12:00:00Z'
        FROM (SELECT c.cash_register_id, c.warehouse_id, o.id AS operator_id,
            o.account_id AS opened_by FROM pos.terminal_configurations c
          JOIN organization.cash_register_operators a ON a.cash_register_id=c.cash_register_id
          JOIN organization.operators o ON o.id=a.operator_id
          WHERE c.active AND a.active AND o.active ORDER BY o.code LIMIT 1) s
        CROSS JOIN generate_series(1,1001) n`);
      if (shifts.rowCount !== 1001) throw Error('POS reporting fixture source is missing.');
    } else if (existing.rows[0].count !== 1001) throw Error('Incomplete report fixtures.');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

export async function removeReportFamilyFixtures() {
  const pool = reportPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Only exact fixture numbers in the verified disposable database are removed.
    // This keeps later browser files independent of the synthetic large dataset.
    await client.query(`DELETE FROM procurement.supplier_invoice_lines line
      USING procurement.supplier_invoices invoice WHERE line.supplier_invoice_id=invoice.id
        AND invoice.supplier_invoice_number ~ '^FAMILY-FIN-[0-9]{4}$'`);
    await client.query(
      "DELETE FROM procurement.supplier_invoices WHERE supplier_invoice_number ~ '^FAMILY-FIN-[0-9]{4}$'",
    );
    await client.query(
      "DELETE FROM service.requests WHERE request_number ~ '^FAMILY-SVC-[0-9]{4}$'",
    );
    await client.query("DELETE FROM pos.shifts WHERE shift_number ~ '^FAMILY-POS-[0-9]{4}$'");
    await client.query(`DELETE FROM identity.user_accounts account USING identity.employees employee
      WHERE account.employee_id=employee.id AND employee.employee_number ~ '^FAMILY-EMP-[0-9]{4}$'
        AND account.status='disabled'`);
    await client.query(
      "DELETE FROM identity.employees WHERE employee_number ~ '^FAMILY-EMP-[0-9]{4}$' AND NOT active",
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
