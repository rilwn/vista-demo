import { createHash } from 'node:crypto';

import type { PoolClient } from 'pg';

type PermissionAction = 'approve' | 'create' | 'delete' | 'edit' | 'view';

interface PermissionGrant {
  action: PermissionAction;
  module: string;
}

export const developmentFixtureAccountKeys = [
  'manager',
  'platform-manager',
  'crm',
  'warehouse',
  'procurement',
  'sales',
  'finance',
  'dispatcher',
  'technician',
  'pos-operator',
  'backup-operator',
  'viewer',
] as const;

export type DevelopmentFixtureAccountKey = (typeof developmentFixtureAccountKeys)[number];

export const developmentFixtureProductBarcodes = [
  '2000000000015',
  '2000000000022',
  '2000000000039',
  '2000000000046',
  '2000000000053',
  '2000000000060',
] as const;

export const developmentFixturePartnerIbans = [
  'BG76DEMO00000000000000',
  'BG49DEMO00000000000001',
] as const;

const fixtureBarcodeRepairDefinitions = [
  {
    barcode: developmentFixtureProductBarcodes[0],
    legacyBarcode: '2000000000011',
    productCode: 'DEV-FISCAL-X1',
  },
  {
    barcode: developmentFixtureProductBarcodes[1],
    legacyBarcode: '2000000000028',
    productCode: 'DEV-SCALE-S1',
  },
  {
    barcode: developmentFixtureProductBarcodes[2],
    legacyBarcode: '2000000000035',
    productCode: 'DEV-FUEL-M1',
  },
  {
    barcode: developmentFixtureProductBarcodes[3],
    legacyBarcode: '2000000000042',
    productCode: 'DEV-ROLL-80',
  },
  {
    barcode: developmentFixtureProductBarcodes[4],
    legacyBarcode: '2000000000059',
    productCode: 'DEV-PRINT-HEAD',
  },
  {
    barcode: developmentFixtureProductBarcodes[5],
    legacyBarcode: '2000000000066',
    productCode: 'DEV-ADAPTER-12V',
  },
] as const;

const fixtureIbanRepairDefinitions = [
  {
    iban: developmentFixturePartnerIbans[0],
    key: 'partner-bank:alfa',
    legacyIban: 'BG00DEMO000000000001',
  },
  {
    iban: developmentFixturePartnerIbans[1],
    key: 'partner-bank:supplier',
    legacyIban: 'BG00DEMO000000000002',
  },
] as const;

export interface DevelopmentFixtureAccount {
  displayName: string;
  email: string;
  employeeNumber: string;
  key: DevelopmentFixtureAccountKey;
  permissions: readonly PermissionGrant[];
  roleCode: string;
  roleName: string;
}

export interface DevelopmentFixtureBootstrapResult {
  accountEmails: readonly string[];
  customerEquipmentSerials: readonly string[];
  technicianEmail: string;
}

const allOperationalPermissions: readonly PermissionGrant[] = [
  grant('platform', 'view'),
  grant('platform.organization', 'view'),
  grant('platform.organization', 'create'),
  grant('crm', 'view'),
  grant('crm', 'create'),
  grant('crm', 'edit'),
  grant('crm', 'delete'),
  grant('erp.warehouse', 'view'),
  grant('erp.warehouse', 'create'),
  grant('erp.warehouse', 'edit'),
  grant('erp.warehouse', 'approve'),
  grant('erp.procurement', 'view'),
  grant('erp.procurement', 'create'),
  grant('erp.procurement', 'edit'),
  grant('erp.sales', 'view'),
  grant('erp.sales', 'create'),
  grant('erp.sales', 'edit'),
  grant('erp.finance', 'view'),
  grant('erp.finance', 'create'),
  grant('erp.finance', 'edit'),
  grant('erp.service', 'view'),
  grant('erp.service', 'create'),
  grant('erp.service', 'edit'),
  grant('erp.service', 'approve'),
  grant('erp.logistics', 'view'),
  grant('erp.logistics', 'create'),
  grant('erp.logistics', 'edit'),
  grant('reports', 'view'),
];

const viewerPermissions: readonly PermissionGrant[] = [
  grant('crm', 'view'),
  grant('erp.warehouse', 'view'),
  grant('erp.procurement', 'view'),
  grant('erp.sales', 'view'),
  grant('erp.finance', 'view'),
  grant('erp.logistics', 'view'),
  grant('reports', 'view'),
];

export const developmentFixtureAccounts: readonly DevelopmentFixtureAccount[] = [
  account(
    'manager',
    'DEV-MANAGER',
    'Vista Demo Manager',
    'manager@vista.local',
    allOperationalPermissions,
  ),
  account(
    'platform-manager',
    'DEV-PLATFORM',
    'Vista Demo Platform Manager',
    'platform.manager@vista.local',
    [
      grant('platform', 'view'),
      grant('platform.organization', 'view'),
      grant('platform.organization', 'create'),
    ],
  ),
  account('crm', 'DEV-CRM', 'Vista Demo CRM Coordinator', 'crm@vista.local', [
    grant('crm', 'view'),
    grant('crm', 'create'),
    grant('crm', 'edit'),
    grant('crm', 'delete'),
  ]),
  account('warehouse', 'DEV-WAREHOUSE', 'Vista Demo Warehouse Operator', 'warehouse@vista.local', [
    grant('platform.organization', 'view'),
    grant('erp.warehouse', 'view'),
    grant('erp.warehouse', 'create'),
    grant('erp.warehouse', 'edit'),
    grant('erp.warehouse', 'approve'),
  ]),
  account(
    'procurement',
    'DEV-PROCUREMENT',
    'Vista Demo Procurement Buyer',
    'procurement@vista.local',
    [
      grant('erp.procurement', 'view'),
      grant('erp.procurement', 'create'),
      grant('erp.procurement', 'edit'),
    ],
  ),
  account('sales', 'DEV-SALES', 'Vista Demo Sales Coordinator', 'sales@vista.local', [
    grant('erp.sales', 'view'),
    grant('erp.sales', 'create'),
    grant('erp.sales', 'edit'),
  ]),
  account('finance', 'DEV-FINANCE', 'Vista Demo Finance Officer', 'finance@vista.local', [
    grant('erp.finance', 'view'),
    grant('erp.finance', 'create'),
    grant('erp.finance', 'edit'),
  ]),
  account(
    'dispatcher',
    'DEV-DISPATCHER',
    'Vista Demo Service Dispatcher',
    'dispatcher@vista.local',
    [
      grant('erp.service', 'view'),
      grant('erp.service', 'create'),
      grant('erp.service', 'edit'),
      grant('erp.service', 'approve'),
    ],
  ),
  account(
    'technician',
    'DEV-TECHNICIAN',
    'Vista Demo Service Technician',
    'technician@vista.local',
    [grant('erp.service', 'view'), grant('erp.service', 'edit')],
  ),
  account('pos-operator', 'DEV-POS', 'Vista Demo POS Operator', 'pos.operator@vista.local', [
    grant('pos', 'view'),
  ]),
  account(
    'backup-operator',
    'DEV-BACKUP',
    'Vista Demo Backup Operator',
    'backup.operator@vista.local',
    [grant('backup', 'view')],
  ),
  account(
    'viewer',
    'DEV-VIEWER',
    'Vista Demo Read-only Reviewer',
    'viewer@vista.local',
    viewerPermissions,
  ),
];

const localDatabaseHosts = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

/**
 * Returns a deterministic, non-business UUID for a local development fixture.
 * Stable identifiers let normal startup add only missing records without using
 * a mutable display name as an identity.
 */
export function fixtureId(key: string): string {
  const digest = createHash('sha256').update(`vista-development-fixture:${key}`).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(
    16,
    20,
  )}-${digest.slice(20, 32)}`;
}

export function isLocalDevelopmentDatabase(databaseUrl: string): boolean {
  try {
    const parsed = new URL(databaseUrl);
    return (
      parsed.protocol === 'postgresql:' && localDatabaseHosts.has(parsed.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

function assertFixtureIdentifiersAreValid(): void {
  if (!developmentFixtureProductBarcodes.every(isValidEan13)) {
    throw new Error('Development fixture EAN-13 values must have valid check digits');
  }
  if (!developmentFixturePartnerIbans.every(isValidIban)) {
    throw new Error('Development fixture IBAN values must be valid');
  }
}

function isValidEan13(value: string): boolean {
  if (!/^\d{13}$/u.test(value)) return false;
  const sum = value
    .slice(0, -1)
    .split('')
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === Number(value.at(-1));
}

function isValidIban(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/u.test(iban)) return false;
  let remainder = 0;
  for (const character of `${iban.slice(4)}${iban.slice(0, 4)}`) {
    const digits = /[A-Z]/u.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/**
 * Creates only the records used for local browser testing. Callers own the
 * transaction. Existing accounts and business records are preserved; only the
 * dedicated fixture-role grants are reconciled.
 */
export async function bootstrapDevelopmentFixtures(
  client: PoolClient,
  passwordHash: string,
  passwordExpiresAt: Date | null = null,
): Promise<DevelopmentFixtureBootstrapResult> {
  assertFixtureIdentifiersAreValid();
  await client.query(`SELECT pg_advisory_xact_lock($1::bigint)`, ['842160331']);
  const accounts = await ensureFixtureAccounts(client, passwordHash, passwordExpiresAt);
  await assertFixtureRoleAssignmentsAreSafe(client, accounts);
  await ensureFixtureRoles(client, accounts);
  await ensureOperationalFixtures(client, accounts);
  await repairKnownFixtureValidationDefects(client);

  return {
    accountEmails: developmentFixtureAccounts.map(({ email }) => email),
    customerEquipmentSerials: [
      'DEMO-FR-ALFA-01',
      'DEMO-SCALE-ALFA-01',
      'DEMO-FUEL-ALFA-01',
      'DEMO-PRINTER-ALFA-01',
    ],
    technicianEmail: accountFor('technician').email,
  };
}

function grant(module: string, action: PermissionAction): PermissionGrant {
  return { action, module };
}

function account(
  key: DevelopmentFixtureAccountKey,
  employeeNumber: string,
  displayName: string,
  email: string,
  permissions: readonly PermissionGrant[],
): DevelopmentFixtureAccount {
  return {
    displayName,
    email,
    employeeNumber,
    key,
    permissions,
    roleCode: `dev-fixture-${key}`,
    roleName: `Development fixture: ${displayName}`,
  };
}

function accountFor(key: DevelopmentFixtureAccountKey): DevelopmentFixtureAccount {
  const value = developmentFixtureAccounts.find((candidate) => candidate.key === key);
  if (!value) throw new Error(`Unknown development fixture account: ${key}`);
  return value;
}

async function ensureFixtureAccounts(
  client: PoolClient,
  passwordHash: string,
  passwordExpiresAt: Date | null,
): Promise<Record<DevelopmentFixtureAccountKey, string>> {
  const accountIds = {} as Record<DevelopmentFixtureAccountKey, string>;

  for (const definition of developmentFixtureAccounts) {
    const employeeId = fixtureId(`employee:${definition.key}`);
    const accountId = fixtureId(`account:${definition.key}`);
    await assertFixtureAccountCanBeUsed(client, employeeId, accountId, definition);
    await insertFixtureRow(
      client,
      'identity.employees',
      employeeId,
      `INSERT INTO identity.employees (
         id, employee_number, display_name, email, active
       ) VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (id) DO NOTHING`,
      [employeeId, definition.employeeNumber, definition.displayName, definition.email],
    );
    await assertEmployeeIdentity(client, employeeId, definition);
    await insertFixtureRow(
      client,
      'identity.user_accounts',
      accountId,
      `INSERT INTO identity.user_accounts (
         id, employee_id, password_hash, password_changed_at, password_expires_at, status
       ) VALUES ($1, $2, $3, now(), $4, 'active')
       ON CONFLICT (id) DO NOTHING`,
      [accountId, employeeId, passwordHash, passwordExpiresAt],
    );
    await assertAccountIdentity(client, accountId, employeeId, definition.email);
    accountIds[definition.key] = accountId;
  }

  return accountIds;
}

async function assertFixtureAccountCanBeUsed(
  client: PoolClient,
  employeeId: string,
  accountId: string,
  definition: DevelopmentFixtureAccount,
): Promise<void> {
  const employees = await client.query<{
    email: string;
    employee_number: string;
    id: string;
  }>(
    `SELECT id, employee_number, email
     FROM identity.employees
     WHERE id = $1 OR email = $2 OR employee_number = $3`,
    [employeeId, definition.email, definition.employeeNumber],
  );
  if (
    employees.rows.some(
      (employee) =>
        employee.id !== employeeId ||
        employee.email !== definition.email ||
        employee.employee_number !== definition.employeeNumber,
    )
  ) {
    throw new Error(
      `Development fixture employee conflict for ${definition.email}; use a separate local database.`,
    );
  }

  const accounts = await client.query<{ employee_id: string; id: string }>(
    `SELECT id, employee_id
     FROM identity.user_accounts
     WHERE id = $1 OR employee_id = $2`,
    [accountId, employeeId],
  );
  if (
    accounts.rows.some((account) => account.id !== accountId || account.employee_id !== employeeId)
  ) {
    throw new Error(
      `Development fixture account conflict for ${definition.email}; use a separate local database.`,
    );
  }

  if (!accounts.rows[0]) return;
  const administrativeRoles = await client.query<{ code: string }>(
    `SELECT role.code
     FROM iam.account_roles assignment
     JOIN iam.roles role ON role.id = assignment.role_id
     WHERE assignment.account_id = $1 AND role.is_administrative`,
    [accountId],
  );
  if (administrativeRoles.rowCount === 0) return;
  throw new Error(
    `Development fixture account ${definition.email} has an administrative role; remove it before bootstrap.`,
  );
}

async function assertEmployeeIdentity(
  client: PoolClient,
  employeeId: string,
  definition: DevelopmentFixtureAccount,
): Promise<void> {
  const result = await client.query<{
    email: string;
    employee_number: string;
  }>(`SELECT employee_number, email FROM identity.employees WHERE id = $1`, [employeeId]);
  const row = result.rows[0];
  if (row?.employee_number === definition.employeeNumber && row.email === definition.email) return;
  throw new Error(
    `Development fixture employee conflict for ${definition.email}; use a separate local database.`,
  );
}

async function assertAccountIdentity(
  client: PoolClient,
  accountId: string,
  employeeId: string,
  email: string,
): Promise<void> {
  const result = await client.query<{ employee_id: string }>(
    `SELECT employee_id FROM identity.user_accounts WHERE id = $1`,
    [accountId],
  );
  if (result.rows[0]?.employee_id === employeeId) return;
  throw new Error(
    `Development fixture account conflict for ${email}; use a separate local database.`,
  );
}

async function assertFixtureRoleAssignmentsAreSafe(
  client: PoolClient,
  accountIds: Record<DevelopmentFixtureAccountKey, string>,
): Promise<void> {
  for (const definition of developmentFixtureAccounts) {
    const expectedRoleId = fixtureId(`role:${definition.key}`);
    const unexpectedRoles = await client.query<{ code: string }>(
      `SELECT role.code
       FROM iam.account_roles assignment
       JOIN iam.roles role ON role.id = assignment.role_id
       WHERE assignment.account_id = $1 AND assignment.role_id <> $2
       ORDER BY role.code`,
      [accountIds[definition.key], expectedRoleId],
    );
    if (unexpectedRoles.rowCount) {
      const roleCodes = unexpectedRoles.rows.map(({ code }) => code).join(', ');
      throw new Error(
        `Development fixture account ${definition.email} has unexpected roles (${roleCodes}); remove them before bootstrap.`,
      );
    }

    const unexpectedAssignees = await client.query<{ email: string }>(
      `SELECT employee.email
       FROM iam.account_roles assignment
       JOIN identity.user_accounts account ON account.id = assignment.account_id
       JOIN identity.employees employee ON employee.id = account.employee_id
       WHERE assignment.role_id = $1 AND assignment.account_id <> $2
       ORDER BY employee.email`,
      [expectedRoleId, accountIds[definition.key]],
    );
    if (unexpectedAssignees.rowCount) {
      const emails = unexpectedAssignees.rows.map(({ email }) => email).join(', ');
      throw new Error(
        `Development fixture role ${definition.roleCode} is assigned to ${emails}; remove it before bootstrap.`,
      );
    }
  }
}

async function ensureFixtureRoles(
  client: PoolClient,
  accountIds: Record<DevelopmentFixtureAccountKey, string>,
): Promise<void> {
  const permissionIds = new Map<string, string>();

  for (const definition of developmentFixtureAccounts) {
    const roleId = fixtureId(`role:${definition.key}`);
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM iam.roles WHERE code = $1`,
      [definition.roleCode],
    );
    if (existing.rows[0] && existing.rows[0].id !== roleId) {
      throw new Error(
        `Development fixture role conflict for ${definition.roleCode}; use a separate local database.`,
      );
    }
    if (!existing.rows[0]) {
      await client.query(
        `INSERT INTO iam.roles (
           id, code, name, description, is_administrative, is_system_role
         ) VALUES ($1, $2, $3, $4, false, true)`,
        [
          roleId,
          definition.roleCode,
          definition.roleName,
          'Local development fixture role. It is never an administrative role.',
        ],
      );
    } else {
      await client.query(
        `UPDATE iam.roles
         SET name = $2, description = $3, is_administrative = false, is_system_role = true,
             updated_at = now()
         WHERE id = $1`,
        [
          roleId,
          definition.roleName,
          'Local development fixture role. It is never an administrative role.',
        ],
      );
    }

    const grantIds: string[] = [];
    for (const permission of definition.permissions) {
      const key = `${permission.module}:${permission.action}`;
      let permissionId = permissionIds.get(key);
      if (!permissionId) {
        await client.query(
          `INSERT INTO iam.permissions (id, module, action, description)
           VALUES ($1, $2, $3, 'Local development fixture permission')
           ON CONFLICT (module, action) DO NOTHING`,
          [fixtureId(`permission:${key}`), permission.module, permission.action],
        );
        const permissionRow = await client.query<{ id: string }>(
          `SELECT id FROM iam.permissions WHERE module = $1 AND action = $2`,
          [permission.module, permission.action],
        );
        permissionId = permissionRow.rows[0]?.id;
        if (!permissionId) throw new Error(`Could not prepare permission ${key}`);
        permissionIds.set(key, permissionId);
      }
      grantIds.push(permissionId);
    }

    await client.query(`DELETE FROM iam.role_permissions WHERE role_id = $1`, [roleId]);
    for (const permissionId of grantIds) {
      await client.query(
        `INSERT INTO iam.role_permissions (role_id, permission_id, granted_by)
         VALUES ($1, $2, $3)`,
        [roleId, permissionId, accountIds.manager],
      );
    }
    await client.query(
      `INSERT INTO iam.account_roles (account_id, role_id, assigned_by)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [accountIds[definition.key], roleId, accountIds.manager],
    );
  }
}

async function ensureOperationalFixtures(
  client: PoolClient,
  accountIds: Record<DevelopmentFixtureAccountKey, string>,
): Promise<void> {
  const managerId = accountIds.manager;
  const technicianId = accountIds.technician;
  const organization = {
    branch: fixtureId('organization:branch'),
    centralWarehouse: fixtureId('warehouse:central'),
    entity: fixtureId('organization:entity'),
    location: fixtureId('organization:location'),
    managerOperator: fixtureId('organization:operator:manager'),
    serviceWarehouse: fixtureId('warehouse:service'),
    technicianOperator: fixtureId('organization:operator:technician'),
    technicianWarehouse: fixtureId('warehouse:technician'),
  };

  await ensureOrganizationFixtures(client, managerId, technicianId, organization);

  const catalog = await ensureCatalogFixtures(client, managerId);
  const partners = await ensurePartnerFixtures(client, managerId, catalog);
  await ensureInitialStock(client, managerId, partners.supplier, organization, catalog);
  await ensurePricingFixtures(client, managerId, partners.balkan, catalog.adapter);
  await ensureSubscriptionFixture(
    client,
    managerId,
    partners.alfa,
    partners.alfaFuelLocation,
    partners.fuelEquipment,
  );
  await ensureProcurementFixtures(
    client,
    managerId,
    partners.supplier,
    organization.centralWarehouse,
    catalog.adapter,
    catalog.receiptRoll,
    catalog.receiptRollBatch,
  );
  await ensureSalesAndFinanceFixtures(
    client,
    managerId,
    partners.alfa,
    organization.centralWarehouse,
    catalog.adapter,
  );
  await ensureScheduledServiceFixture(
    client,
    managerId,
    technicianId,
    organization.technicianWarehouse,
    partners.alfa,
    partners.alfaStoreLocation,
    partners.printerEquipment,
  );
}

async function repairKnownFixtureValidationDefects(client: PoolClient): Promise<void> {
  try {
    for (const repair of fixtureBarcodeRepairDefinitions) {
      await client.query(
        `UPDATE master_data.product_barcodes
         SET barcode = $2
         WHERE id = $1 AND barcode = $3 AND barcode_type = 'ean13'`,
        [fixtureId(`catalog:barcode:${repair.productCode}`), repair.barcode, repair.legacyBarcode],
      );
    }
    for (const repair of fixtureIbanRepairDefinitions) {
      await client.query(
        `UPDATE master_data.partner_bank_accounts
         SET iban = $2
         WHERE id = $1 AND iban = $3`,
        [fixtureId(repair.key), repair.iban, repair.legacyIban],
      );
    }
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new Error(
        'Development fixture validation repair conflicts with existing data; use a separate local database.',
      );
    }
    throw error;
  }
}

interface OrganizationFixtureIds {
  branch: string;
  centralWarehouse: string;
  entity: string;
  location: string;
  managerOperator: string;
  serviceWarehouse: string;
  technicianOperator: string;
  technicianWarehouse: string;
}

async function ensureOrganizationFixtures(
  client: PoolClient,
  managerId: string,
  technicianId: string,
  ids: OrganizationFixtureIds,
): Promise<void> {
  await insertFixtureRow(
    client,
    'organization.legal_entities',
    ids.entity,
    `INSERT INTO organization.legal_entities (
       id, code, name, uic, vat_number, created_by, updated_by
     ) VALUES ($1, 'DEMO-VISTA', 'Vista Demo Ltd.', '205555555', 'BG205555555', $2, $2)
     ON CONFLICT (id) DO NOTHING`,
    [ids.entity, managerId],
  );
  await insertFixtureRow(
    client,
    'organization.branches',
    ids.branch,
    `INSERT INTO organization.branches (
       id, legal_entity_id, code, name, created_by, updated_by
     ) VALUES ($1, $2, 'VRATSA', 'Vratsa Operations', $3, $3)
     ON CONFLICT (id) DO NOTHING`,
    [ids.branch, ids.entity, managerId],
  );
  await insertFixtureRow(
    client,
    'organization.business_locations',
    ids.location,
    `INSERT INTO organization.business_locations (
       id, branch_id, code, name, location_type, address_line_1, city, postal_code,
       created_by, updated_by
     ) VALUES (
       $1, $2, 'VRATSA-SERVICE', 'Vratsa Service & Retail Centre', 'service_and_retail',
       '15 Hristo Botev Blvd.', 'Vratsa', '3000', $3, $3
     ) ON CONFLICT (id) DO NOTHING`,
    [ids.location, ids.branch, managerId],
  );
  await insertFixtureRow(
    client,
    'organization.operators',
    ids.managerOperator,
    `INSERT INTO organization.operators (
       id, business_location_id, account_id, code, created_by, updated_by
     ) VALUES ($1, $2, $3, 'MGR-01', $4, $4)
     ON CONFLICT (id) DO NOTHING`,
    [ids.managerOperator, ids.location, managerId, managerId],
  );
  await insertFixtureRow(
    client,
    'organization.operators',
    ids.technicianOperator,
    `INSERT INTO organization.operators (
       id, business_location_id, account_id, code, created_by, updated_by
     ) VALUES ($1, $2, $3, 'TECH-01', $4, $4)
     ON CONFLICT (id) DO NOTHING`,
    [ids.technicianOperator, ids.location, technicianId, managerId],
  );

  const cashRegisterId = fixtureId('organization:cash-register');
  await insertFixtureRow(
    client,
    'organization.cash_registers',
    cashRegisterId,
    `INSERT INTO organization.cash_registers (
       id, business_location_id, code, name, created_by, updated_by
     ) VALUES ($1, $2, 'POS-01', 'Demo POS terminal', $3, $3)
     ON CONFLICT (id) DO NOTHING`,
    [cashRegisterId, ids.location, managerId],
  );
  await client.query(
    `INSERT INTO organization.cash_register_operators (
       cash_register_id, operator_id, business_location_id, assigned_by
     ) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [cashRegisterId, ids.managerOperator, ids.location, managerId],
  );

  await insertFixtureRow(
    client,
    'master_data.warehouses',
    ids.centralWarehouse,
    `INSERT INTO master_data.warehouses (
       id, code, name, warehouse_type, business_location_id, created_by, updated_by
     ) VALUES ($1, 'WH-CENTRAL', 'Demo Central Warehouse', 'standard', $2, $3, $3)
     ON CONFLICT (id) DO NOTHING`,
    [ids.centralWarehouse, ids.location, managerId],
  );
  await insertFixtureRow(
    client,
    'master_data.warehouses',
    ids.serviceWarehouse,
    `INSERT INTO master_data.warehouses (
       id, code, name, warehouse_type, business_location_id, created_by, updated_by
     ) VALUES ($1, 'WH-SERVICE', 'Demo Service Warehouse', 'standard', $2, $3, $3)
     ON CONFLICT (id) DO NOTHING`,
    [ids.serviceWarehouse, ids.location, managerId],
  );
  await insertFixtureRow(
    client,
    'master_data.warehouses',
    ids.technicianWarehouse,
    `INSERT INTO master_data.warehouses (
       id, code, name, warehouse_type, business_location_id, technician_operator_id,
       created_by, updated_by
     ) VALUES ($1, 'WH-TECH-01', 'Demo Technician Warehouse', 'technician', $2, $3, $4, $4)
     ON CONFLICT (id) DO NOTHING`,
    [ids.technicianWarehouse, ids.location, ids.technicianOperator, managerId],
  );
}

interface CatalogFixtureIds {
  adapter: string;
  fiscal: string;
  fuel: string;
  printHead: string;
  printHeadBatch: string;
  receiptRoll: string;
  receiptRollBatch: string;
  scale: string;
}

async function ensureCatalogFixtures(
  client: PoolClient,
  managerId: string,
): Promise<CatalogFixtureIds> {
  const unitId = fixtureId('catalog:unit:pcs');
  const rootCategoryId = fixtureId('catalog:category:root');
  await insertFixtureRow(
    client,
    'master_data.units',
    unitId,
    `INSERT INTO master_data.units (id, code, name, created_by, updated_by)
     VALUES ($1, 'PCS', 'Pieces', $2, $2) ON CONFLICT (id) DO NOTHING`,
    [unitId, managerId],
  );
  await insertFixtureRow(
    client,
    'master_data.product_categories',
    rootCategoryId,
    `INSERT INTO master_data.product_categories (
       id, parent_id, name, tracking_mode, requires_expiry, created_by, updated_by
     ) VALUES ($1, NULL, 'Demo product catalogue', 'none', false, $2, $2)
     ON CONFLICT (id) DO NOTHING`,
    [rootCategoryId, managerId],
  );

  const categoryIds = {
    accessories: fixtureId('catalog:category:accessories'),
    consumables: fixtureId('catalog:category:consumables'),
    fiscal: fixtureId('catalog:category:fiscal'),
    fuel: fixtureId('catalog:category:fuel'),
    scales: fixtureId('catalog:category:scales'),
    spareParts: fixtureId('catalog:category:spare-parts'),
  };
  const categories: ReadonlyArray<{
    id: string;
    name: string;
    requiresExpiry: boolean;
    trackingMode: 'batch' | 'none' | 'serial';
  }> = [
    {
      id: categoryIds.fiscal,
      name: 'Fiscal devices',
      trackingMode: 'serial',
      requiresExpiry: false,
    },
    {
      id: categoryIds.scales,
      name: 'Electronic scales',
      trackingMode: 'serial',
      requiresExpiry: false,
    },
    {
      id: categoryIds.fuel,
      name: 'Fuel management systems',
      trackingMode: 'serial',
      requiresExpiry: false,
    },
    {
      id: categoryIds.consumables,
      name: 'Consumables',
      trackingMode: 'batch',
      requiresExpiry: true,
    },
    {
      id: categoryIds.spareParts,
      name: 'Spare parts',
      trackingMode: 'batch',
      requiresExpiry: false,
    },
    {
      id: categoryIds.accessories,
      name: 'Accessories',
      trackingMode: 'none',
      requiresExpiry: false,
    },
  ];
  for (const category of categories) {
    await insertFixtureRow(
      client,
      'master_data.product_categories',
      category.id,
      `INSERT INTO master_data.product_categories (
         id, parent_id, name, tracking_mode, requires_expiry, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $6) ON CONFLICT (id) DO NOTHING`,
      [
        category.id,
        rootCategoryId,
        category.name,
        category.trackingMode,
        category.requiresExpiry,
        managerId,
      ],
    );
  }

  const products: CatalogFixtureIds = {
    adapter: fixtureId('catalog:product:adapter'),
    fiscal: fixtureId('catalog:product:fiscal-register'),
    fuel: fixtureId('catalog:product:fuel-module'),
    printHead: fixtureId('catalog:product:print-head'),
    printHeadBatch: fixtureId('inventory-batch:print-head'),
    receiptRoll: fixtureId('catalog:product:receipt-roll'),
    receiptRollBatch: fixtureId('inventory-batch:receipt-roll'),
    scale: fixtureId('catalog:product:scale'),
  };
  const rows: ReadonlyArray<{
    barcode: string;
    categoryId: string;
    code: string;
    id: string;
    name: string;
  }> = [
    {
      id: products.fiscal,
      code: 'DEV-FISCAL-X1',
      name: 'Demo Fiscal Register X1',
      categoryId: categoryIds.fiscal,
      barcode: developmentFixtureProductBarcodes[0],
    },
    {
      id: products.scale,
      code: 'DEV-SCALE-S1',
      name: 'Demo Electronic Scale S1',
      categoryId: categoryIds.scales,
      barcode: developmentFixtureProductBarcodes[1],
    },
    {
      id: products.fuel,
      code: 'DEV-FUEL-M1',
      name: 'Demo Fuel Module M1',
      categoryId: categoryIds.fuel,
      barcode: developmentFixtureProductBarcodes[2],
    },
    {
      id: products.receiptRoll,
      code: 'DEV-ROLL-80',
      name: 'Demo Receipt Roll 80 mm',
      categoryId: categoryIds.consumables,
      barcode: developmentFixtureProductBarcodes[3],
    },
    {
      id: products.printHead,
      code: 'DEV-PRINT-HEAD',
      name: 'Demo Thermal Print Head',
      categoryId: categoryIds.spareParts,
      barcode: developmentFixtureProductBarcodes[4],
    },
    {
      id: products.adapter,
      code: 'DEV-ADAPTER-12V',
      name: 'Demo 12 V Power Adapter',
      categoryId: categoryIds.accessories,
      barcode: developmentFixtureProductBarcodes[5],
    },
  ];
  for (const product of rows) {
    await insertFixtureRow(
      client,
      'master_data.products',
      product.id,
      `INSERT INTO master_data.products (
         id, product_code, name, category_id, unit_id, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $6) ON CONFLICT (id) DO NOTHING`,
      [product.id, product.code, product.name, product.categoryId, unitId, managerId],
    );
    const barcodeId = fixtureId(`catalog:barcode:${product.code}`);
    await insertFixtureRow(
      client,
      'master_data.product_barcodes',
      barcodeId,
      `INSERT INTO master_data.product_barcodes (
         id, product_id, barcode, barcode_type, created_by
       ) VALUES ($1, $2, $3, 'ean13', $4) ON CONFLICT (id) DO NOTHING`,
      [barcodeId, product.id, product.barcode, managerId],
    );
  }
  await insertFixtureRow(
    client,
    'inventory.batches',
    products.receiptRollBatch,
    `INSERT INTO inventory.batches (id, product_id, batch_number, expires_at)
     VALUES ($1, $2, 'DEMO-ROLL-2028', CURRENT_DATE + INTERVAL '700 days')
     ON CONFLICT (id) DO NOTHING`,
    [products.receiptRollBatch, products.receiptRoll],
  );
  await insertFixtureRow(
    client,
    'inventory.batches',
    products.printHeadBatch,
    `INSERT INTO inventory.batches (id, product_id, batch_number, expires_at)
     VALUES ($1, $2, 'DEMO-HEAD-2028', NULL) ON CONFLICT (id) DO NOTHING`,
    [products.printHeadBatch, products.printHead],
  );

  return products;
}

interface PartnerFixtureIds {
  adapterEquipment: string;
  alfa: string;
  alfaFuelLocation: string;
  alfaStoreLocation: string;
  balkan: string;
  fuelEquipment: string;
  printerEquipment: string;
  supplier: string;
}

async function ensurePartnerFixtures(
  client: PoolClient,
  managerId: string,
  catalog: CatalogFixtureIds,
): Promise<PartnerFixtureIds> {
  const ids: PartnerFixtureIds = {
    adapterEquipment: fixtureId('customer-equipment:alfa-adapter'),
    alfa: fixtureId('partner:alfa'),
    alfaFuelLocation: fixtureId('customer-location:alfa-fuel'),
    alfaStoreLocation: fixtureId('customer-location:alfa-store'),
    balkan: fixtureId('partner:balkan'),
    fuelEquipment: fixtureId('customer-equipment:alfa-fuel'),
    printerEquipment: fixtureId('customer-equipment:alfa-printer'),
    supplier: fixtureId('partner:supplier'),
  };
  await ensurePartner(
    client,
    managerId,
    ids.alfa,
    'Alfa Market Demo Ltd.',
    '205555556',
    'BG205555556',
    ['customer'],
  );
  await ensurePartner(
    client,
    managerId,
    ids.balkan,
    'Balkan Retail Demo Ltd.',
    '205555557',
    'BG205555557',
    ['customer'],
  );
  await ensurePartner(
    client,
    managerId,
    ids.supplier,
    'TechSupply Demo Ltd.',
    '205555558',
    'BG205555558',
    ['customer', 'supplier'],
  );

  const alfaContactId = fixtureId('partner-contact:alfa');
  await ensurePartnerContact(
    client,
    alfaContactId,
    ids.alfa,
    'Elena Petrova',
    'Store manager',
    '+359 92 600 101',
    'elena.petrova@alfa-demo.local',
    'technical_contact',
  );
  await ensurePartnerContact(
    client,
    fixtureId('partner-contact:supplier'),
    ids.supplier,
    'Petar Ivanov',
    'Account manager',
    '+359 2 555 0101',
    'orders@techsupply-demo.local',
    'supplier_contact',
  );
  await ensurePartnerAddress(
    client,
    fixtureId('partner-address:alfa:registered'),
    ids.alfa,
    'registered',
    '8 Market Square',
    'Vratsa',
    '3000',
  );
  await ensurePartnerAddress(
    client,
    fixtureId('partner-address:alfa:delivery'),
    ids.alfa,
    'delivery',
    '8 Market Square',
    'Vratsa',
    '3000',
  );
  await ensurePartnerAddress(
    client,
    fixtureId('partner-address:balkan:registered'),
    ids.balkan,
    'registered',
    '21 Retail Avenue',
    'Montana',
    '3400',
  );
  await ensurePartnerAddress(
    client,
    fixtureId('partner-address:supplier:registered'),
    ids.supplier,
    'registered',
    '42 Supply Street',
    'Sofia',
    '1000',
  );
  await ensurePartnerBankAccount(
    client,
    fixtureId('partner-bank:alfa'),
    ids.alfa,
    developmentFixturePartnerIbans[0],
    'DEMO',
    'Demo Bank',
  );
  await ensurePartnerBankAccount(
    client,
    fixtureId('partner-bank:supplier'),
    ids.supplier,
    developmentFixturePartnerIbans[1],
    'DEMO',
    'Demo Bank',
  );
  await client.query(
    `INSERT INTO procurement.supplier_profiles (
       supplier_partner_id, payment_terms_days, delivery_terms, updated_by
     ) VALUES ($1, 30, 'Demo delivery terms', $2) ON CONFLICT DO NOTHING`,
    [ids.supplier, managerId],
  );
  await insertFixtureRow(
    client,
    'procurement.supplier_evaluations',
    fixtureId('supplier-evaluation:initial'),
    `INSERT INTO procurement.supplier_evaluations (
       id, supplier_partner_id, score, notes, evaluated_by
     ) VALUES ($1, $2, 4, 'Initial local demonstration evaluation.', $3)
     ON CONFLICT (id) DO NOTHING`,
    [fixtureId('supplier-evaluation:initial'), ids.supplier, managerId],
  );

  await ensureCustomerLocation(
    client,
    managerId,
    ids.alfaStoreLocation,
    ids.alfa,
    alfaContactId,
    'Alfa Market — Central Store',
    'retail_store',
    '8 Market Square',
    'Vratsa',
    '3000',
  );
  await ensureCustomerLocation(
    client,
    managerId,
    ids.alfaFuelLocation,
    ids.alfa,
    alfaContactId,
    'Alfa Market — Fuel Point',
    'fuel_station',
    '10 Market Square',
    'Vratsa',
    '3000',
  );
  await ensureCustomerLocation(
    client,
    managerId,
    fixtureId('customer-location:balkan-store'),
    ids.balkan,
    null,
    'Balkan Retail — Main Store',
    'retail_store',
    '21 Retail Avenue',
    'Montana',
    '3400',
  );

  await ensureCustomerEquipment(
    client,
    managerId,
    fixtureId('customer-equipment:alfa-fiscal'),
    ids.alfaStoreLocation,
    catalog.fiscal,
    'Demo Fiscal Register X1',
    'DEMO-FR-ALFA-01',
    "CURRENT_DATE - INTERVAL '120 days'",
    "CURRENT_DATE - INTERVAL '120 days'",
    "CURRENT_DATE + INTERVAL '610 days'",
  );
  await ensureCustomerEquipment(
    client,
    managerId,
    ids.adapterEquipment,
    ids.alfaStoreLocation,
    catalog.adapter,
    'Demo 12 V Power Adapter',
    'DEMO-ADAPTER-ALFA-01',
    "CURRENT_DATE - INTERVAL '40 days'",
    "CURRENT_DATE - INTERVAL '40 days'",
    "CURRENT_DATE + INTERVAL '325 days'",
  );
  await ensureCustomerEquipment(
    client,
    managerId,
    fixtureId('customer-equipment:alfa-scale'),
    ids.alfaStoreLocation,
    catalog.scale,
    'Demo Electronic Scale S1',
    'DEMO-SCALE-ALFA-01',
    "CURRENT_DATE - INTERVAL '900 days'",
    "CURRENT_DATE - INTERVAL '900 days'",
    "CURRENT_DATE - INTERVAL '170 days'",
  );
  await ensureCustomerEquipment(
    client,
    managerId,
    ids.fuelEquipment,
    ids.alfaFuelLocation,
    catalog.fuel,
    'Demo Fuel Module M1',
    'DEMO-FUEL-ALFA-01',
    "CURRENT_DATE - INTERVAL '180 days'",
    "CURRENT_DATE - INTERVAL '180 days'",
    "CURRENT_DATE + INTERVAL '550 days'",
  );
  await ensureCustomerEquipment(
    client,
    managerId,
    ids.printerEquipment,
    ids.alfaStoreLocation,
    null,
    'Demo Receipt Printer',
    'DEMO-PRINTER-ALFA-01',
    "CURRENT_DATE - INTERVAL '540 days'",
    "CURRENT_DATE - INTERVAL '540 days'",
    'NULL',
  );

  return ids;
}

async function ensurePartner(
  client: PoolClient,
  managerId: string,
  partnerId: string,
  displayName: string,
  uic: string,
  vatNumber: string,
  roles: readonly ('customer' | 'supplier')[],
): Promise<void> {
  await insertFixtureRow(
    client,
    'master_data.partners',
    partnerId,
    `INSERT INTO master_data.partners (
       id, kind, display_name, uic, vat_number, company_representative, created_by, updated_by
     ) VALUES ($1, 'legal_entity', $2, $3, $4, 'Demo representative', $5, $5)
     ON CONFLICT (id) DO NOTHING`,
    [partnerId, displayName, uic, vatNumber, managerId],
  );
  for (const role of roles) {
    await client.query(
      `INSERT INTO master_data.partner_roles (partner_id, role, assigned_by)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [partnerId, role, managerId],
    );
  }
}

async function ensurePartnerContact(
  client: PoolClient,
  contactId: string,
  partnerId: string,
  displayName: string,
  jobTitle: string,
  telephone: string,
  email: string,
  contactRole: string,
): Promise<void> {
  await insertFixtureRow(
    client,
    'master_data.partner_contacts',
    contactId,
    `INSERT INTO master_data.partner_contacts (
       id, partner_id, display_name, job_title, telephone, email, contact_role
     ) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
    [contactId, partnerId, displayName, jobTitle, telephone, email, contactRole],
  );
}

async function ensurePartnerAddress(
  client: PoolClient,
  addressId: string,
  partnerId: string,
  addressType: 'delivery' | 'registered',
  addressLine1: string,
  city: string,
  postalCode: string,
): Promise<void> {
  await insertFixtureRow(
    client,
    'master_data.partner_addresses',
    addressId,
    `INSERT INTO master_data.partner_addresses (
       id, partner_id, address_type, address_line_1, city, postal_code
     ) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
    [addressId, partnerId, addressType, addressLine1, city, postalCode],
  );
}

async function ensurePartnerBankAccount(
  client: PoolClient,
  bankAccountId: string,
  partnerId: string,
  iban: string,
  bic: string,
  bankName: string,
): Promise<void> {
  await insertFixtureRow(
    client,
    'master_data.partner_bank_accounts',
    bankAccountId,
    `INSERT INTO master_data.partner_bank_accounts (
       id, partner_id, iban, bic, bank_name
     ) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
    [bankAccountId, partnerId, iban, bic, bankName],
  );
}

async function ensureCustomerLocation(
  client: PoolClient,
  managerId: string,
  customerLocationId: string,
  partnerId: string,
  responsibleContactId: string | null,
  name: string,
  locationType: string,
  addressLine1: string,
  city: string,
  postalCode: string,
): Promise<void> {
  await insertFixtureRow(
    client,
    'master_data.customer_locations',
    customerLocationId,
    `INSERT INTO master_data.customer_locations (
       id, partner_id, name, location_type, address_line_1, city, postal_code,
       responsible_contact_id, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) ON CONFLICT (id) DO NOTHING`,
    [
      customerLocationId,
      partnerId,
      name,
      locationType,
      addressLine1,
      city,
      postalCode,
      responsibleContactId,
      managerId,
    ],
  );
}

async function ensureCustomerEquipment(
  client: PoolClient,
  managerId: string,
  equipmentId: string,
  customerLocationId: string,
  productId: string | null,
  deviceName: string,
  serialNumber: string,
  purchaseDateExpression: string,
  warrantyStartExpression: string,
  warrantyEndExpression: string,
): Promise<void> {
  await insertFixtureRow(
    client,
    'master_data.customer_equipment',
    equipmentId,
    `INSERT INTO master_data.customer_equipment (
       id, customer_location_id, product_id, device_name, serial_number, purchase_date,
       warranty_start_date, warranty_end_date, created_by, updated_by
     ) VALUES (
       $1, $2, $3, $4, $5, ${purchaseDateExpression}, ${warrantyStartExpression},
       ${warrantyEndExpression}, $6, $6
     ) ON CONFLICT (id) DO NOTHING`,
    [equipmentId, customerLocationId, productId, deviceName, serialNumber, managerId],
  );
}

async function ensureInitialStock(
  client: PoolClient,
  managerId: string,
  supplierPartnerId: string,
  organization: OrganizationFixtureIds,
  catalog: CatalogFixtureIds,
): Promise<void> {
  const rows: ReadonlyArray<StockReceiptFixture> = [
    stockReceipt(
      'central-fiscal',
      organization.centralWarehouse,
      catalog.fiscal,
      '2.0000',
      '390.0000',
    ),
    stockReceipt(
      'central-scale',
      organization.centralWarehouse,
      catalog.scale,
      '2.0000',
      '285.0000',
    ),
    stockReceipt('central-fuel', organization.centralWarehouse, catalog.fuel, '2.0000', '720.0000'),
    stockReceipt(
      'central-rolls',
      organization.centralWarehouse,
      catalog.receiptRoll,
      '100.0000',
      '1.0500',
      catalog.receiptRollBatch,
    ),
    stockReceipt(
      'central-print-heads',
      organization.centralWarehouse,
      catalog.printHead,
      '20.0000',
      '46.0000',
      catalog.printHeadBatch,
    ),
    stockReceipt(
      'central-adapters',
      organization.centralWarehouse,
      catalog.adapter,
      '20.0000',
      '12.5000',
    ),
    stockReceipt(
      'service-print-heads',
      organization.serviceWarehouse,
      catalog.printHead,
      '10.0000',
      '46.0000',
      catalog.printHeadBatch,
    ),
    stockReceipt(
      'service-adapters',
      organization.serviceWarehouse,
      catalog.adapter,
      '10.0000',
      '12.5000',
    ),
    stockReceipt(
      'technician-print-heads',
      organization.technicianWarehouse,
      catalog.printHead,
      '5.0000',
      '46.0000',
      catalog.printHeadBatch,
    ),
    stockReceipt(
      'technician-rolls',
      organization.technicianWarehouse,
      catalog.receiptRoll,
      '5.0000',
      '1.0500',
      catalog.receiptRollBatch,
    ),
    stockReceipt(
      'technician-adapters',
      organization.technicianWarehouse,
      catalog.adapter,
      '5.0000',
      '12.5000',
    ),
  ];

  for (const row of rows) {
    await insertFixtureRow(
      client,
      'inventory.stock_movements',
      row.movementId,
      `INSERT INTO inventory.stock_movements (
         id, warehouse_id, product_id, movement_type, quantity, reference_type, reference_id,
         actor_account_id, correlation_id, unit_cost_bgn, supplier_partner_id, batch_id
       ) VALUES (
         $1, $2, $3, 'receipt', $4, 'development_fixture', $5, $6, $7, $8, $9, $10
       ) ON CONFLICT (id) DO NOTHING`,
      [
        row.movementId,
        row.warehouseId,
        row.productId,
        row.quantity,
        row.key,
        managerId,
        fixtureId(`stock-correlation:${row.key}`),
        row.unitCostBgn,
        supplierPartnerId,
        row.batchId,
      ],
    );
  }

  const balances: ReadonlyArray<StockBalanceFixture> = [
    stockBalance(organization.centralWarehouse, catalog.fiscal, '2.0000', '390.0000'),
    stockBalance(organization.centralWarehouse, catalog.scale, '2.0000', '285.0000'),
    stockBalance(organization.centralWarehouse, catalog.fuel, '2.0000', '720.0000'),
    // Includes a separate received purchase order created below.
    stockBalance(organization.centralWarehouse, catalog.receiptRoll, '130.0000', '1.0615'),
    stockBalance(organization.centralWarehouse, catalog.printHead, '20.0000', '46.0000'),
    // One adapter is consumed by the completed Sales workflow created below.
    stockBalance(organization.centralWarehouse, catalog.adapter, '19.0000', '12.5000'),
    stockBalance(organization.serviceWarehouse, catalog.printHead, '10.0000', '46.0000'),
    stockBalance(organization.serviceWarehouse, catalog.adapter, '10.0000', '12.5000'),
    stockBalance(organization.technicianWarehouse, catalog.printHead, '5.0000', '46.0000'),
    stockBalance(organization.technicianWarehouse, catalog.receiptRoll, '5.0000', '1.0500'),
    stockBalance(organization.technicianWarehouse, catalog.adapter, '5.0000', '12.5000'),
  ];
  for (const balance of balances) {
    await client.query(
      `INSERT INTO inventory.stock_balances (
         warehouse_id, product_id, quantity, average_unit_cost_bgn
       ) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [balance.warehouseId, balance.productId, balance.quantity, balance.averageUnitCostBgn],
    );
  }
  for (const balance of [
    batchBalance(organization.centralWarehouse, catalog.receiptRollBatch, '130.0000'),
    batchBalance(organization.centralWarehouse, catalog.printHeadBatch, '20.0000'),
    batchBalance(organization.serviceWarehouse, catalog.printHeadBatch, '10.0000'),
    batchBalance(organization.technicianWarehouse, catalog.printHeadBatch, '5.0000'),
    batchBalance(organization.technicianWarehouse, catalog.receiptRollBatch, '5.0000'),
  ]) {
    await client.query(
      `INSERT INTO inventory.batch_stock_balances (warehouse_id, batch_id, quantity)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [balance.warehouseId, balance.batchId, balance.quantity],
    );
  }

  await ensureSerializedItem(
    client,
    'central-fiscal-01',
    catalog.fiscal,
    organization.centralWarehouse,
    fixtureId('stock-movement:central-fiscal'),
    'DEMO-FR-STOCK-01',
  );
  await ensureSerializedItem(
    client,
    'central-fiscal-02',
    catalog.fiscal,
    organization.centralWarehouse,
    fixtureId('stock-movement:central-fiscal'),
    'DEMO-FR-STOCK-02',
  );
  await ensureSerializedItem(
    client,
    'central-scale-01',
    catalog.scale,
    organization.centralWarehouse,
    fixtureId('stock-movement:central-scale'),
    'DEMO-SCALE-STOCK-01',
  );
  await ensureSerializedItem(
    client,
    'central-scale-02',
    catalog.scale,
    organization.centralWarehouse,
    fixtureId('stock-movement:central-scale'),
    'DEMO-SCALE-STOCK-02',
  );
  await ensureSerializedItem(
    client,
    'central-fuel-01',
    catalog.fuel,
    organization.centralWarehouse,
    fixtureId('stock-movement:central-fuel'),
    'DEMO-FUEL-STOCK-01',
  );
  await ensureSerializedItem(
    client,
    'central-fuel-02',
    catalog.fuel,
    organization.centralWarehouse,
    fixtureId('stock-movement:central-fuel'),
    'DEMO-FUEL-STOCK-02',
  );
}

async function ensureSerializedItem(
  client: PoolClient,
  key: string,
  productId: string,
  warehouseId: string,
  receivedMovementId: string,
  serialNumber: string,
): Promise<void> {
  const id = fixtureId(`serialized-item:${key}`);
  await insertFixtureRow(
    client,
    'inventory.serialized_items',
    id,
    `INSERT INTO inventory.serialized_items (
       id, product_id, serial_number, warehouse_id, received_movement_id
     ) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
    [id, productId, serialNumber, warehouseId, receivedMovementId],
  );
}

async function ensurePricingFixtures(
  client: PoolClient,
  managerId: string,
  balkanPartnerId: string,
  adapterProductId: string,
): Promise<void> {
  const customerGroupId = fixtureId('sales-price-group:retail');
  const campaignId = fixtureId('sales-campaign:local');
  const priceListId = fixtureId('sales-price-list:retail');
  await insertFixtureRow(
    client,
    'sales.customer_price_groups',
    customerGroupId,
    `INSERT INTO sales.customer_price_groups (
       id, code, name, created_by, updated_by
     ) VALUES ($1, 'DEMO-RETAIL', 'Demo retail customers', $2, $2)
     ON CONFLICT (id) DO NOTHING`,
    [customerGroupId, managerId],
  );
  await client.query(
    `INSERT INTO sales.customer_price_group_members (
       customer_group_id, customer_partner_id, assigned_by
     ) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [customerGroupId, balkanPartnerId, managerId],
  );
  await insertFixtureRow(
    client,
    'sales.promotional_campaigns',
    campaignId,
    `INSERT INTO sales.promotional_campaigns (
       id, code, name, valid_from, valid_to, created_by, updated_by
     ) VALUES (
       $1, 'DEMO-SUMMER', 'Demo seasonal campaign', CURRENT_DATE - INTERVAL '30 days',
       CURRENT_DATE + INTERVAL '10 years', $2, $2
     ) ON CONFLICT (id) DO NOTHING`,
    [campaignId, managerId],
  );
  await insertFixtureRow(
    client,
    'sales.price_lists',
    priceListId,
    `INSERT INTO sales.price_lists (
       id, code, name, scope, customer_group_id, campaign_id, currency_code,
       valid_from, valid_to, priority, created_by, updated_by
     ) VALUES (
       $1, 'DEMO-RETAIL-BGN', 'Demo retail BGN prices', 'customer_group', $2, $3, 'BGN',
       CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE + INTERVAL '10 years', 10, $4, $4
     ) ON CONFLICT (id) DO NOTHING`,
    [priceListId, customerGroupId, campaignId, managerId],
  );
  const lineId = fixtureId('sales-price-list-line:adapter');
  await insertFixtureRow(
    client,
    'sales.price_list_lines',
    lineId,
    `INSERT INTO sales.price_list_lines (id, price_list_id, product_id, unit_price)
     VALUES ($1, $2, $3, 45.0000) ON CONFLICT (id) DO NOTHING`,
    [lineId, priceListId, adapterProductId],
  );
}

async function ensureSubscriptionFixture(
  client: PoolClient,
  managerId: string,
  alfaPartnerId: string,
  alfaFuelLocationId: string,
  fuelEquipmentId: string,
): Promise<void> {
  const contractId = fixtureId('service-subscription:alfa-fuel');
  await insertFixtureRow(
    client,
    'sales.service_subscription_contracts',
    contractId,
    `INSERT INTO sales.service_subscription_contracts (
       id, contract_number, customer_partner_id, customer_location_id, valid_from, valid_to,
       visit_frequency_months, billing_frequency_months, next_invoice_date, currency_code,
       billing_amount, created_by, updated_by
     ) VALUES (
       $1, 'DEV-SVC-001', $2, $3, CURRENT_DATE - INTERVAL '30 days',
       CURRENT_DATE + INTERVAL '700 days', 3, 1, CURRENT_DATE + INTERVAL '20 days',
       'BGN', 120.0000, $4, $4
     ) ON CONFLICT (id) DO NOTHING`,
    [contractId, alfaPartnerId, alfaFuelLocationId, managerId],
  );
  await client.query(
    `INSERT INTO sales.service_subscription_devices (
       contract_id, customer_equipment_id, customer_location_id
     ) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [contractId, fuelEquipmentId, alfaFuelLocationId],
  );
  const serviceId = fixtureId('service-subscription-service:alfa-fuel');
  await insertFixtureRow(
    client,
    'sales.service_subscription_services',
    serviceId,
    `INSERT INTO sales.service_subscription_services (id, contract_id, position, description)
     VALUES ($1, $2, 1, 'Quarterly inspection and remote monitoring review.')
     ON CONFLICT (id) DO NOTHING`,
    [serviceId, contractId],
  );
}

interface StockReceiptFixture {
  batchId: string | null;
  key: string;
  movementId: string;
  productId: string;
  quantity: string;
  unitCostBgn: string;
  warehouseId: string;
}

interface StockBalanceFixture {
  averageUnitCostBgn: string;
  productId: string;
  quantity: string;
  warehouseId: string;
}

interface BatchBalanceFixture {
  batchId: string;
  quantity: string;
  warehouseId: string;
}

function stockReceipt(
  key: string,
  warehouseId: string,
  productId: string,
  quantity: string,
  unitCostBgn: string,
  batchId: string | null = null,
): StockReceiptFixture {
  return {
    batchId,
    key,
    movementId: fixtureId(`stock-movement:${key}`),
    productId,
    quantity,
    unitCostBgn,
    warehouseId,
  };
}

function stockBalance(
  warehouseId: string,
  productId: string,
  quantity: string,
  averageUnitCostBgn: string,
): StockBalanceFixture {
  return { averageUnitCostBgn, productId, quantity, warehouseId };
}

function batchBalance(warehouseId: string, batchId: string, quantity: string): BatchBalanceFixture {
  return { batchId, quantity, warehouseId };
}

async function ensureProcurementFixtures(
  client: PoolClient,
  managerId: string,
  supplierPartnerId: string,
  centralWarehouseId: string,
  adapterProductId: string,
  receiptRollProductId: string,
  receiptRollBatchId: string,
): Promise<void> {
  const openOrderId = fixtureId('procurement-order:open');
  const openLineId = fixtureId('procurement-order-line:open-adapter');
  const receivedOrderId = fixtureId('procurement-order:received');
  const receivedLineId = fixtureId('procurement-order-line:received-roll');
  const goodsReceiptId = fixtureId('procurement-goods-receipt:received-roll');
  const receiptMovementId = fixtureId('procurement-stock-movement:received-roll');
  const receiptLineId = fixtureId('procurement-goods-receipt-line:received-roll');
  const supplierInvoiceId = fixtureId('procurement-supplier-invoice:received-roll');
  const supplierInvoiceLineId = fixtureId('procurement-supplier-invoice-line:received-roll');
  const vatSupplierInvoiceId = fixtureId('procurement-supplier-invoice:open-adapter-vat');
  const vatSupplierInvoiceLineId = fixtureId('procurement-supplier-invoice-line:open-adapter-vat');
  const supplierClaimId = fixtureId('procurement-supplier-claim:received-roll');

  await insertFixtureRow(
    client,
    'procurement.purchase_orders',
    openOrderId,
    `INSERT INTO procurement.purchase_orders (
       id, supplier_partner_id, warehouse_id, currency_code, status, created_by, updated_by
     ) VALUES ($1, $2, $3, 'BGN', 'open', $4, $4) ON CONFLICT (id) DO NOTHING`,
    [openOrderId, supplierPartnerId, centralWarehouseId, managerId],
  );
  await insertFixtureRow(
    client,
    'procurement.purchase_order_lines',
    openLineId,
    `INSERT INTO procurement.purchase_order_lines (
       id, purchase_order_id, product_id, ordered_quantity, unit_price, expected_delivery_date
     ) VALUES ($1, $2, $3, 10.0000, 12.5000, CURRENT_DATE + INTERVAL '14 days')
     ON CONFLICT (id) DO NOTHING`,
    [openLineId, openOrderId, adapterProductId],
  );
  await insertFixtureRow(
    client,
    'procurement.purchase_orders',
    receivedOrderId,
    `INSERT INTO procurement.purchase_orders (
       id, supplier_partner_id, warehouse_id, currency_code, status, created_by, updated_by
     ) VALUES ($1, $2, $3, 'BGN', 'received', $4, $4) ON CONFLICT (id) DO NOTHING`,
    [receivedOrderId, supplierPartnerId, centralWarehouseId, managerId],
  );
  await insertFixtureRow(
    client,
    'procurement.purchase_order_lines',
    receivedLineId,
    `INSERT INTO procurement.purchase_order_lines (
       id, purchase_order_id, product_id, ordered_quantity, delivered_quantity, invoiced_quantity,
       unit_price, expected_delivery_date
     ) VALUES ($1, $2, $3, 30.0000, 30.0000, 30.0000, 1.1000, CURRENT_DATE - INTERVAL '5 days')
     ON CONFLICT (id) DO NOTHING`,
    [receivedLineId, receivedOrderId, receiptRollProductId],
  );
  await insertFixtureRow(
    client,
    'procurement.goods_receipts',
    goodsReceiptId,
    `INSERT INTO procurement.goods_receipts (
       id, purchase_order_id, warehouse_id, supplier_partner_id, supplier_delivery_reference,
       received_by, correlation_id
     ) VALUES ($1, $2, $3, $4, 'DEV-DELIVERY-001', $5, $6) ON CONFLICT (id) DO NOTHING`,
    [
      goodsReceiptId,
      receivedOrderId,
      centralWarehouseId,
      supplierPartnerId,
      managerId,
      fixtureId('procurement-correlation:received-roll'),
    ],
  );
  await insertFixtureRow(
    client,
    'inventory.stock_movements',
    receiptMovementId,
    `INSERT INTO inventory.stock_movements (
       id, warehouse_id, product_id, movement_type, quantity, reference_type, reference_id,
       actor_account_id, correlation_id, unit_cost_bgn, supplier_partner_id, batch_id
     ) VALUES ($1, $2, $3, 'receipt', 30.0000, 'goods_receipt', $4, $5, $6, 1.1000, $7, $8)
     ON CONFLICT (id) DO NOTHING`,
    [
      receiptMovementId,
      centralWarehouseId,
      receiptRollProductId,
      goodsReceiptId,
      managerId,
      fixtureId('procurement-correlation:stock-roll'),
      supplierPartnerId,
      receiptRollBatchId,
    ],
  );
  await insertFixtureRow(
    client,
    'procurement.goods_receipt_lines',
    receiptLineId,
    `INSERT INTO procurement.goods_receipt_lines (
       id, goods_receipt_id, purchase_order_line_id, stock_movement_id, quantity, unit_cost_bgn
     ) VALUES ($1, $2, $3, $4, 30.0000, 1.1000) ON CONFLICT (id) DO NOTHING`,
    [receiptLineId, goodsReceiptId, receivedLineId, receiptMovementId],
  );
  await insertFixtureRow(
    client,
    'procurement.supplier_invoices',
    supplierInvoiceId,
    `INSERT INTO procurement.supplier_invoices (
       id, purchase_order_id, supplier_partner_id, supplier_invoice_number, invoice_date,
       currency_code, recorded_by
     ) VALUES (
       $1, $2, $3, 'DEV-SUP-INV-001', CURRENT_DATE - INTERVAL '4 days', 'BGN', $4
     ) ON CONFLICT (id) DO NOTHING`,
    [supplierInvoiceId, receivedOrderId, supplierPartnerId, managerId],
  );
  await insertFixtureRow(
    client,
    'procurement.supplier_invoice_lines',
    supplierInvoiceLineId,
    `INSERT INTO procurement.supplier_invoice_lines (
       id, supplier_invoice_id, purchase_order_id, purchase_order_line_id, quantity, unit_price
     ) VALUES ($1, $2, $3, $4, 30.0000, 1.1000) ON CONFLICT (id) DO NOTHING`,
    [supplierInvoiceLineId, supplierInvoiceId, receivedOrderId, receivedLineId],
  );
  await insertFixtureRow(
    client,
    'procurement.supplier_invoices',
    vatSupplierInvoiceId,
    `INSERT INTO procurement.supplier_invoices (
       id, purchase_order_id, supplier_partner_id, supplier_invoice_number, invoice_date,
       currency_code, recorded_by
     ) VALUES (
       $1, $2, $3, 'DEV-SUP-VAT-001', CURRENT_DATE - INTERVAL '2 days', 'BGN', $4
     ) ON CONFLICT (id) DO NOTHING`,
    [vatSupplierInvoiceId, openOrderId, supplierPartnerId, managerId],
  );
  await insertFixtureRow(
    client,
    'procurement.supplier_invoice_lines',
    vatSupplierInvoiceLineId,
    `INSERT INTO procurement.supplier_invoice_lines (
       id, supplier_invoice_id, purchase_order_id, purchase_order_line_id, quantity, unit_price,
       vat_treatment, vat_rate
     ) VALUES ($1, $2, $3, $4, 4.0000, 12.5000, 'standard_20', 20.0000)
     ON CONFLICT (id) DO NOTHING`,
    [vatSupplierInvoiceLineId, vatSupplierInvoiceId, openOrderId, openLineId],
  );
  await client.query(
    `UPDATE procurement.purchase_order_lines order_line
     SET invoiced_quantity = (
       SELECT coalesce(sum(invoice_line.quantity), 0)
       FROM procurement.supplier_invoice_lines invoice_line
       WHERE invoice_line.purchase_order_line_id = order_line.id
     )
     WHERE order_line.id = $1`,
    [openLineId],
  );
  await insertFixtureRow(
    client,
    'procurement.supplier_claims',
    supplierClaimId,
    `INSERT INTO procurement.supplier_claims (
       id, supplier_partner_id, purchase_order_id, goods_receipt_id, goods_receipt_line_id,
       claim_type, quantity, description, created_by, updated_by
     ) VALUES (
       $1, $2, $3, $4, $5, 'damaged', 2.0000,
       'Demo damaged receipt rolls retained for claim workflow testing.', $6, $6
     ) ON CONFLICT (id) DO NOTHING`,
    [supplierClaimId, supplierPartnerId, receivedOrderId, goodsReceiptId, receiptLineId, managerId],
  );
  const historyId = fixtureId('procurement-supplier-claim-history:received-roll');
  await insertFixtureRow(
    client,
    'procurement.supplier_claim_status_history',
    historyId,
    `INSERT INTO procurement.supplier_claim_status_history (
       id, supplier_claim_id, from_status, to_status, note, changed_by
     ) VALUES ($1, $2, NULL, 'open', 'Fixture claim created.', $3) ON CONFLICT (id) DO NOTHING`,
    [historyId, supplierClaimId, managerId],
  );
}

async function ensureSalesAndFinanceFixtures(
  client: PoolClient,
  managerId: string,
  alfaPartnerId: string,
  centralWarehouseId: string,
  adapterProductId: string,
): Promise<void> {
  const quotationId = fixtureId('sales-quotation:completed');
  const quotationLineId = fixtureId('sales-quotation-line:completed-adapter');
  const orderId = fixtureId('sales-order:completed');
  const reservationId = fixtureId('sales-reservation:completed-adapter');
  const orderLineId = fixtureId('sales-order-line:completed-adapter');
  const shipmentId = fixtureId('sales-shipment:completed');
  const shipmentLineId = fixtureId('sales-shipment-line:completed-adapter');
  const issueMovementId = fixtureId('sales-stock-movement:completed-adapter');
  const handoverId = fixtureId('sales-handover:completed');
  const invoiceId = fixtureId('sales-invoice:completed');
  const financeDocumentId = fixtureId('finance-document:completed-sale');
  const paymentId = fixtureId('finance-payment:initial');

  await insertFixtureRow(
    client,
    'sales.quotations',
    quotationId,
    `INSERT INTO sales.quotations (
       id, quotation_number, customer_partner_id, warehouse_id, valid_until, currency_code,
       subtotal, vat_total, total, status, created_by
     ) VALUES (
       $1, 'DEV-Q-0001', $2, $3, CURRENT_DATE + INTERVAL '30 days', 'BGN',
       50.0000, 10.0000, 60.0000, 'invoiced', $4
     ) ON CONFLICT (id) DO NOTHING`,
    [quotationId, alfaPartnerId, centralWarehouseId, managerId],
  );
  await insertFixtureRow(
    client,
    'sales.quotation_lines',
    quotationLineId,
    `INSERT INTO sales.quotation_lines (
       id, quotation_id, product_id, quantity, unit_price, vat_treatment, line_total
     ) VALUES ($1, $2, $3, 1.0000, 50.0000, 'standard_20', 50.0000)
     ON CONFLICT (id) DO NOTHING`,
    [quotationLineId, quotationId, adapterProductId],
  );
  await insertFixtureRow(
    client,
    'sales.orders',
    orderId,
    `INSERT INTO sales.orders (
       id, order_number, quotation_id, customer_partner_id, warehouse_id, status, confirmed_by
     ) VALUES ($1, 'DEV-SO-0001', $2, $3, $4, 'invoiced', $5) ON CONFLICT (id) DO NOTHING`,
    [orderId, quotationId, alfaPartnerId, centralWarehouseId, managerId],
  );
  await insertFixtureRow(
    client,
    'inventory.stock_reservations',
    reservationId,
    `INSERT INTO inventory.stock_reservations (
       id, warehouse_id, product_id, reference_type, reference_id, initial_quantity,
       remaining_quantity, status, created_by, ended_by, ended_at
     ) VALUES ($1, $2, $3, 'sales_order', $4, 1.0000, 0, 'consumed', $5, $5, now())
     ON CONFLICT (id) DO NOTHING`,
    [reservationId, centralWarehouseId, adapterProductId, orderId, managerId],
  );
  await insertFixtureRow(
    client,
    'sales.order_lines',
    orderLineId,
    `INSERT INTO sales.order_lines (
       id, order_id, quotation_line_id, product_id, quantity, reservation_id
     ) VALUES ($1, $2, $3, $4, 1.0000, $5) ON CONFLICT (id) DO NOTHING`,
    [orderLineId, orderId, quotationLineId, adapterProductId, reservationId],
  );
  await insertFixtureRow(
    client,
    'sales.shipments',
    shipmentId,
    `INSERT INTO sales.shipments (id, shipment_number, order_id, shipped_by)
     VALUES ($1, 'DEV-SH-0001', $2, $3) ON CONFLICT (id) DO NOTHING`,
    [shipmentId, orderId, managerId],
  );
  await insertFixtureRow(
    client,
    'inventory.stock_movements',
    issueMovementId,
    `INSERT INTO inventory.stock_movements (
       id, warehouse_id, product_id, movement_type, quantity, reference_type, reference_id,
       actor_account_id, correlation_id, unit_cost_bgn, customer_partner_id
     ) VALUES ($1, $2, $3, 'issue', 1.0000, 'sales_shipment', $4, $5, $6, 12.5000, $7)
     ON CONFLICT (id) DO NOTHING`,
    [
      issueMovementId,
      centralWarehouseId,
      adapterProductId,
      shipmentLineId,
      managerId,
      fixtureId('sales-correlation:completed-adapter'),
      alfaPartnerId,
    ],
  );
  await insertFixtureRow(
    client,
    'sales.shipment_lines',
    shipmentLineId,
    `INSERT INTO sales.shipment_lines (
       id, shipment_id, order_line_id, product_id, quantity, stock_movement_id
     ) VALUES ($1, $2, $3, $4, 1.0000, $5) ON CONFLICT (id) DO NOTHING`,
    [shipmentLineId, shipmentId, orderLineId, adapterProductId, issueMovementId],
  );
  await insertFixtureRow(
    client,
    'sales.handover_certificates',
    handoverId,
    `INSERT INTO sales.handover_certificates (
       id, certificate_number, order_id, shipment_id, customer_partner_id, status,
       accepted_by_name, accepted_at, acceptance_notes, prepared_by
     ) VALUES (
       $1, 'DEV-HO-0001', $2, $3, $4, 'accepted', 'Elena Petrova', now(),
       'Demo handover accepted.', $5
     ) ON CONFLICT (id) DO NOTHING`,
    [handoverId, orderId, shipmentId, alfaPartnerId, managerId],
  );
  const handoverLineId = fixtureId('sales-handover-line:completed-adapter');
  await insertFixtureRow(
    client,
    'sales.handover_certificate_lines',
    handoverLineId,
    `INSERT INTO sales.handover_certificate_lines (
       id, certificate_id, product_id, product_name, quantity, serial_numbers
     ) VALUES ($1, $2, $3, 'Demo 12 V Power Adapter', 1.0000, '{}'::text[])
     ON CONFLICT (id) DO NOTHING`,
    [handoverLineId, handoverId, adapterProductId],
  );
  await insertFixtureRow(
    client,
    'sales.invoices',
    invoiceId,
    `INSERT INTO sales.invoices (
       id, invoice_number, order_id, shipment_id, customer_partner_id, currency_code,
       subtotal, vat_total, total, recorded_by
     ) VALUES (
       $1, 'DEV-INV-DRAFT-0001', $2, $3, $4, 'BGN', 50.0000, 10.0000, 60.0000, $5
     ) ON CONFLICT (id) DO NOTHING`,
    [invoiceId, orderId, shipmentId, alfaPartnerId, managerId],
  );
  const invoiceLineId = fixtureId('sales-invoice-line:completed-adapter');
  await insertFixtureRow(
    client,
    'sales.invoice_lines',
    invoiceLineId,
    `INSERT INTO sales.invoice_lines (
       id, invoice_id, quotation_line_id, product_id, quantity, unit_price, vat_treatment,
       line_total
     ) VALUES ($1, $2, $3, $4, 1.0000, 50.0000, 'standard_20', 50.0000)
     ON CONFLICT (id) DO NOTHING`,
    [invoiceLineId, invoiceId, quotationLineId, adapterProductId],
  );
  await ensureFinanceFixture(
    client,
    managerId,
    financeDocumentId,
    invoiceId,
    alfaPartnerId,
    paymentId,
  );
}

async function ensureFinanceFixture(
  client: PoolClient,
  managerId: string,
  financeDocumentId: string,
  invoiceId: string,
  alfaPartnerId: string,
  paymentId: string,
): Promise<void> {
  await insertFixtureRow(
    client,
    'finance.customer_documents',
    financeDocumentId,
    `INSERT INTO finance.customer_documents (
       id, document_number, source_sales_invoice_id, customer_partner_id, document_date, due_date,
       currency_code, exchange_rate, rate_date, rate_source, total, allocated_total,
       outstanding_total, bgn_total, payment_status, created_by
     ) VALUES (
       $1, 'DEV-FIN-REV-0001', $2, $3, CURRENT_DATE - INTERVAL '7 days',
       CURRENT_DATE + INTERVAL '23 days', 'BGN', 1, CURRENT_DATE - INTERVAL '7 days',
       'internal_bgn_review', 60.0000, 20.0000, 40.0000, 60.0000, 'partially_paid', $4
     ) ON CONFLICT (id) DO NOTHING`,
    [financeDocumentId, invoiceId, alfaPartnerId, managerId],
  );
  const createdHistoryId = fixtureId('finance-status-history:unpaid');
  await insertFixtureRow(
    client,
    'finance.payment_status_history',
    createdHistoryId,
    `INSERT INTO finance.payment_status_history (
       id, customer_document_id, previous_status, next_status, reason, changed_by
     ) VALUES ($1, $2, NULL, 'unpaid', 'fixture_document_created', $3)
     ON CONFLICT (id) DO NOTHING`,
    [createdHistoryId, financeDocumentId, managerId],
  );
  await insertFixtureRow(
    client,
    'finance.payments',
    paymentId,
    `INSERT INTO finance.payments (
       id, payment_number, customer_partner_id, payment_date, payment_method, currency_code,
       amount, payment_reference, notes, recorded_by
     ) VALUES (
       $1, 'DEV-PAY-0001', $2, CURRENT_DATE - INTERVAL '2 days', 'bank_transfer', 'BGN',
       20.0000, 'DEV-PAYMENT-REFERENCE', 'Initial partial fixture payment.', $3
     ) ON CONFLICT (id) DO NOTHING`,
    [paymentId, alfaPartnerId, managerId],
  );
  const allocationId = fixtureId('finance-payment-allocation:initial');
  await insertFixtureRow(
    client,
    'finance.payment_allocations',
    allocationId,
    `INSERT INTO finance.payment_allocations (
       id, payment_id, customer_document_id, amount, allocated_by
     ) VALUES ($1, $2, $3, 20.0000, $4) ON CONFLICT (id) DO NOTHING`,
    [allocationId, paymentId, financeDocumentId, managerId],
  );
  const partialHistoryId = fixtureId('finance-status-history:partial');
  await insertFixtureRow(
    client,
    'finance.payment_status_history',
    partialHistoryId,
    `INSERT INTO finance.payment_status_history (
       id, customer_document_id, previous_status, next_status, reason, changed_by
     ) VALUES ($1, $2, 'unpaid', 'partially_paid', 'fixture_payment_recorded', $3)
     ON CONFLICT (id) DO NOTHING`,
    [partialHistoryId, financeDocumentId, managerId],
  );
}

async function ensureScheduledServiceFixture(
  client: PoolClient,
  managerId: string,
  technicianId: string,
  technicianWarehouseId: string,
  alfaPartnerId: string,
  alfaStoreLocationId: string,
  printerEquipmentId: string,
): Promise<void> {
  const requestId = fixtureId('service-request:scheduled');
  const workOrderId = fixtureId('service-work-order:scheduled');
  await insertFixtureRow(
    client,
    'service.requests',
    requestId,
    `INSERT INTO service.requests (
       id, request_number, customer_partner_id, customer_location_id, customer_equipment_id,
       source_channel, service_type, priority, problem_description, status, created_by, updated_by
     ) VALUES (
       $1, 'DEV-SRV-0001', $2, $3, $4, 'telephone', 'out_of_warranty', 'normal',
       'Demo scheduled printer check for technician workflow testing.', 'scheduled', $5, $5
     ) ON CONFLICT (id) DO NOTHING`,
    [requestId, alfaPartnerId, alfaStoreLocationId, printerEquipmentId, managerId],
  );
  await insertFixtureRow(
    client,
    'service.work_orders',
    workOrderId,
    `INSERT INTO service.work_orders (
       id, work_order_number, service_request_id, assigned_technician_account_id,
       technician_warehouse_id, scheduled_start, scheduled_end, status, created_by, updated_by
     ) VALUES (
       $1, 'DEV-WO-0001', $2, $3, $4, now() + INTERVAL '1 day',
       now() + INTERVAL '1 day 1 hour', 'scheduled', $5, $5
     ) ON CONFLICT (id) DO NOTHING`,
    [workOrderId, requestId, technicianId, technicianWarehouseId, managerId],
  );
  const historyId = fixtureId('service-work-order-history:scheduled');
  await insertFixtureRow(
    client,
    'service.work_order_status_history',
    historyId,
    `INSERT INTO service.work_order_status_history (
       id, work_order_id, previous_status, next_status, reason, changed_by
     ) VALUES ($1, $2, NULL, 'scheduled', 'fixture_created', $3) ON CONFLICT (id) DO NOTHING`,
    [historyId, workOrderId, managerId],
  );
}

async function insertFixtureRow(
  client: PoolClient,
  tableName: string,
  id: string,
  statement: string,
  parameters: unknown[],
): Promise<void> {
  try {
    await client.query(statement, parameters);
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new Error(
        `Development fixture conflict in ${tableName}; a reserved Vista demo identifier is already in use. Use a separate local database.`,
      );
    }
    throw error;
  }
  const row = await client.query<{ id: string }>(`SELECT id FROM ${tableName} WHERE id = $1`, [id]);
  if (row.rows[0]?.id === id) return;
  throw new Error(`Development fixture record is missing after insert: ${tableName}:${id}`);
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
