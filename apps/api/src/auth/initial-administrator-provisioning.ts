import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import { appendAuditEvent } from '../audit/audit.service.js';
import type { TotpService } from './totp.service.js';

const bootstrapRoleCode = 'vista-bootstrap-administrator';
const bootstrapPermissions = [
  ['platform', 'view'],
  ['platform', 'create'],
  ['platform', 'edit'],
  ['platform', 'delete'],
  ['platform', 'approve'],
  ['platform.organization', 'view'],
  ['platform.organization', 'create'],
] as const;

export interface InitialAdministratorProvisioningInput {
  displayName: string;
  email: string;
  employeeNumber: string;
  passwordExpiresAt: Date | null;
  passwordHash: string;
}

export interface InitialAdministratorProvisioningResult {
  accountId: string;
  email: string;
  enrollmentKey: string;
  provisioningUri: string;
  roleCode: string;
}

/**
 * Creates the only allowed first administrative account while the caller holds
 * a transaction. It intentionally fails if any administrative assignment
 * already exists: recovery or a verified administrator must be used instead.
 */
export async function provisionInitialAdministrator(
  client: PoolClient,
  input: InitialAdministratorProvisioningInput,
  totp: TotpService,
): Promise<InitialAdministratorProvisioningResult> {
  const normalized = normalizeInput(input);
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('vista.identity.initial-administrator'))",
  );
  const existingAdministrators = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM iam.account_roles assignment
     JOIN iam.roles role ON role.id = assignment.role_id
     WHERE role.is_administrative = true`,
  );
  if (Number(existingAdministrators.rows[0]?.count ?? '0') > 0) {
    throw new Error(
      'An administrative account already exists. Use that verified administrator or the controlled recovery process.',
    );
  }

  const collisions = await client.query<{ email: string; employee_number: string }>(
    `SELECT email, employee_number
     FROM identity.employees
     WHERE email = $1 OR employee_number = $2`,
    [normalized.email, normalized.employeeNumber],
  );
  if (collisions.rows.length > 0) {
    throw new Error(
      'The requested initial administrator email or employee number is already in use.',
    );
  }

  const roleCollision = await client.query<{ id: string }>(
    'SELECT id FROM iam.roles WHERE code = $1 FOR UPDATE',
    [bootstrapRoleCode],
  );
  if (roleCollision.rows[0]) {
    throw new Error(
      'The bootstrap administrator role already exists without an administrative assignment. Investigate before retrying.',
    );
  }

  const employeeId = randomUUID();
  const accountId = randomUUID();
  const roleId = randomUUID();
  const timestamp = new Date();
  const enrollmentKey = totp.generateSecret();
  await client.query(
    `INSERT INTO identity.employees (id, employee_number, display_name, email)
     VALUES ($1, $2, $3, $4)`,
    [employeeId, normalized.employeeNumber, normalized.displayName, normalized.email],
  );
  await client.query(
    `INSERT INTO identity.user_accounts (
       id, employee_id, password_hash, password_changed_at, password_expires_at, two_factor_enrolled_at
     ) VALUES ($1, $2, $3, $4, $5, $4)`,
    [accountId, employeeId, normalized.passwordHash, timestamp, normalized.passwordExpiresAt],
  );
  await client.query(
    `INSERT INTO iam.roles (id, code, name, description, is_administrative, is_system_role)
     VALUES ($1, $2, 'Vista bootstrap administrator',
             'Initial administrative access created through the controlled provisioning command.',
             true, true)`,
    [roleId, bootstrapRoleCode],
  );
  for (const [module, action] of bootstrapPermissions) {
    await client.query(
      `INSERT INTO iam.permissions (module, action, description)
       VALUES ($1, $2, 'Bootstrap administrator permission')
       ON CONFLICT (module, action) DO NOTHING`,
      [module, action],
    );
    const permission = await client.query<{ id: string }>(
      'SELECT id FROM iam.permissions WHERE module = $1 AND action = $2',
      [module, action],
    );
    const permissionId = permission.rows[0]?.id;
    if (!permissionId) throw new Error(`Missing bootstrap permission ${module}:${action}`);
    await client.query(
      'INSERT INTO iam.role_permissions (role_id, permission_id) VALUES ($1, $2)',
      [roleId, permissionId],
    );
  }
  await client.query('INSERT INTO iam.account_roles (account_id, role_id) VALUES ($1, $2)', [
    accountId,
    roleId,
  ]);
  await client.query(
    `INSERT INTO identity.authentication_factors (
       account_id, factor_type, encrypted_secret, enabled, verified_at
     ) VALUES ($1, 'totp', $2, true, $3)`,
    [accountId, totp.encryptSecret(enrollmentKey), timestamp],
  );
  await appendAuditEvent(client, {
    action: 'identity.initial_administrator.provisioned',
    after: { factorType: 'totp', roleCode: bootstrapRoleCode },
    correlationId: randomUUID(),
    targetId: accountId,
    targetType: 'user_account',
  });
  return {
    accountId,
    email: normalized.email,
    enrollmentKey,
    provisioningUri: totp.createEnrollmentUri(normalized.email, enrollmentKey),
    roleCode: bootstrapRoleCode,
  };
}

function normalizeInput(
  input: InitialAdministratorProvisioningInput,
): InitialAdministratorProvisioningInput {
  const displayName = input.displayName.trim().replace(/\s+/gu, ' ');
  const email = input.email.trim().toLowerCase();
  const employeeNumber = input.employeeNumber.trim().toUpperCase();
  if (displayName.length < 2 || displayName.length > 255) {
    throw new Error('INITIAL_ADMIN_DISPLAY_NAME must contain between 2 and 255 characters.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || email.length > 320) {
    throw new Error('INITIAL_ADMIN_EMAIL must be a valid email address.');
  }
  if (!/^[A-Z0-9._-]{1,100}$/u.test(employeeNumber)) {
    throw new Error(
      'INITIAL_ADMIN_EMPLOYEE_NUMBER may contain only letters, numbers, dots, underscores, and hyphens.',
    );
  }
  return { ...input, displayName, email, employeeNumber };
}
