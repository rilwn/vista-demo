import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bootstrapDevelopmentFixtures,
  developmentFixtureAccounts,
  developmentFixturePartnerIbans,
  developmentFixtureProductBarcodes,
  fixtureId,
} from '../src/database/development-fixtures.js';

const runDatabaseTests = process.env['RUN_DATABASE_TESTS'] === 'true';

describe.skipIf(!runDatabaseTests)('development fixture bootstrap', () => {
  let client: PoolClient;
  let pool: Pool;

  beforeAll(async () => {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) throw new Error('DATABASE_URL is required when RUN_DATABASE_TESTS=true');

    pool = new Pool({ connectionString: databaseUrl, max: 1 });
    client = await pool.connect();
    await client.query('BEGIN');
  });

  afterAll(async () => {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  });

  it('creates a useful ERP/CRM fixture set without duplication on a normal rerun', async () => {
    await bootstrapDevelopmentFixtures(client, 'fixture-password-hash-not-used-by-this-test');
    const first = await counts(client);
    const passwordBefore = await passwordHash(client, 'manager@vista.local');
    await expectFixtureIdentifiers(client);

    await bootstrapDevelopmentFixtures(client, 'a-different-hash-must-not-reset-existing-accounts');
    const second = await counts(client);
    const passwordAfter = await passwordHash(client, 'manager@vista.local');

    await client.query(
      `UPDATE master_data.product_barcodes
       SET barcode = '2000000000011'
       WHERE id = $1`,
      [fixtureId('catalog:barcode:DEV-FISCAL-X1')],
    );
    await client.query(
      `UPDATE master_data.partner_bank_accounts
       SET iban = 'BG00DEMO000000000001'
       WHERE id = $1`,
      [fixtureId('partner-bank:alfa')],
    );
    await bootstrapDevelopmentFixtures(client, 'a-third-hash-must-not-reset-existing-accounts');
    await expectFixtureIdentifiers(client);

    expect(first).toEqual(second);
    expect(passwordAfter).toBe(passwordBefore);
    expect(first.accounts).toBe(developmentFixtureAccounts.length);
    expect(first.serviceWorkOrders).toBeGreaterThanOrEqual(1);
    expect(first.technicianWarehouses).toBe(1);
    expect(first.activeCustomerEquipment).toBeGreaterThanOrEqual(4);
    expect(first.financeDocuments).toBeGreaterThanOrEqual(1);
    expect(first.procurementOrders).toBeGreaterThanOrEqual(2);

    const technician = await client.query<{
      email: string;
    }>(
      `SELECT employee.email
       FROM service.work_orders work_order
       JOIN identity.user_accounts account ON account.id = work_order.assigned_technician_account_id
       JOIN identity.employees employee ON employee.id = account.employee_id
       JOIN master_data.warehouses warehouse ON warehouse.id = work_order.technician_warehouse_id
       WHERE work_order.id = $1
         AND work_order.status = 'scheduled'
         AND warehouse.id = $2`,
      [fixtureId('service-work-order:scheduled'), fixtureId('warehouse:technician')],
    );
    expect(technician.rows).toEqual([
      expect.objectContaining({
        email: 'technician@vista.local',
      }),
    ]);
  });

  it('refuses unexpected fixture-role assignments before it reconciles grants', async () => {
    const managerAccountId = fixtureId('account:manager');
    const crmRoleId = fixtureId('role:crm');
    await client.query(
      `INSERT INTO iam.account_roles (account_id, role_id, assigned_by)
       VALUES ($1, $2, $1)`,
      [managerAccountId, crmRoleId],
    );
    await expect(
      bootstrapDevelopmentFixtures(client, 'fixture-password-hash-not-used-by-this-test'),
    ).rejects.toThrow('manager@vista.local has unexpected roles');
    await client.query(`DELETE FROM iam.account_roles WHERE account_id = $1 AND role_id = $2`, [
      managerAccountId,
      crmRoleId,
    ]);

    const outsiderEmployeeId = fixtureId('test:fixture-role-outsider:employee');
    const outsiderAccountId = fixtureId('test:fixture-role-outsider:account');
    await client.query(
      `INSERT INTO identity.employees (id, employee_number, display_name, email)
       VALUES ($1, 'TEST-FIXTURE-OUTSIDER', 'Fixture Role Outsider', 'fixture-role-outsider@example.invalid')`,
      [outsiderEmployeeId],
    );
    await client.query(
      `INSERT INTO identity.user_accounts (id, employee_id, password_hash)
       VALUES ($1, $2, 'not-used')`,
      [outsiderAccountId, outsiderEmployeeId],
    );
    await client.query(
      `INSERT INTO iam.account_roles (account_id, role_id, assigned_by)
       VALUES ($1, $2, $3)`,
      [outsiderAccountId, fixtureId('role:manager'), managerAccountId],
    );
    await expect(
      bootstrapDevelopmentFixtures(client, 'fixture-password-hash-not-used-by-this-test'),
    ).rejects.toThrow('dev-fixture-manager is assigned to fixture-role-outsider@example.invalid');
  });
});

async function counts(client: PoolClient): Promise<Record<string, number>> {
  const result = await client.query<{
    accounts: string;
    active_customer_equipment: string;
    finance_documents: string;
    procurement_orders: string;
    service_work_orders: string;
    technician_warehouses: string;
  }>(
    `SELECT
       (SELECT count(DISTINCT account.id)
        FROM iam.account_roles assignment
        JOIN iam.roles role ON role.id = assignment.role_id
        JOIN identity.user_accounts account ON account.id = assignment.account_id
        WHERE role.code LIKE 'dev-fixture-%')::text AS accounts,
       (SELECT count(*) FROM master_data.customer_equipment WHERE active)::text AS active_customer_equipment,
       (SELECT count(*) FROM finance.customer_documents)::text AS finance_documents,
       (SELECT count(*) FROM procurement.purchase_orders)::text AS procurement_orders,
       (SELECT count(*) FROM service.work_orders)::text AS service_work_orders,
       (SELECT count(*) FROM master_data.warehouses
        WHERE id = $1 AND warehouse_type = 'technician')::text AS technician_warehouses`,
    [fixtureId('warehouse:technician')],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Fixture counts were not returned');
  return {
    accounts: Number(row.accounts),
    activeCustomerEquipment: Number(row.active_customer_equipment),
    financeDocuments: Number(row.finance_documents),
    procurementOrders: Number(row.procurement_orders),
    serviceWorkOrders: Number(row.service_work_orders),
    technicianWarehouses: Number(row.technician_warehouses),
  };
}

async function passwordHash(client: PoolClient, email: string): Promise<string> {
  const result = await client.query<{ password_hash: string }>(
    `SELECT account.password_hash
     FROM identity.user_accounts account
     JOIN identity.employees employee ON employee.id = account.employee_id
     WHERE employee.email = $1`,
    [email],
  );
  const value = result.rows[0]?.password_hash;
  if (!value) throw new Error(`Fixture account was not found: ${email}`);
  return value;
}

async function expectFixtureIdentifiers(client: PoolClient): Promise<void> {
  const productCodes = [
    'DEV-FISCAL-X1',
    'DEV-SCALE-S1',
    'DEV-FUEL-M1',
    'DEV-ROLL-80',
    'DEV-PRINT-HEAD',
    'DEV-ADAPTER-12V',
  ];
  const barcodes = await client.query<{ barcode: string }>(
    `SELECT barcode
     FROM master_data.product_barcodes
     WHERE id = ANY($1::uuid[])
     ORDER BY barcode`,
    [productCodes.map((productCode) => fixtureId(`catalog:barcode:${productCode}`))],
  );
  expect(barcodes.rows.map(({ barcode }) => barcode)).toEqual([
    ...developmentFixtureProductBarcodes,
  ]);

  const ibans = await client.query<{ iban: string }>(
    `SELECT iban
     FROM master_data.partner_bank_accounts
     WHERE id = ANY($1::uuid[])
     ORDER BY iban`,
    [[fixtureId('partner-bank:supplier'), fixtureId('partner-bank:alfa')]],
  );
  expect(ibans.rows.map(({ iban }) => iban)).toEqual([...developmentFixturePartnerIbans].sort());
}
