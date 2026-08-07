import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';

import { AppModule } from '../app.module.js';
import { PasswordService } from '../auth/password.service.js';
import { DatabaseService } from './database.service.js';

const defaultEmail = 'dev@vista.local';
const minimumPasswordLength = 12;

async function run(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('The development seed is disabled when NODE_ENV=production');
  }

  const email = (process.env['DEV_SEED_EMAIL'] ?? defaultEmail).trim().toLowerCase();
  const password = process.env['DEV_SEED_PASSWORD'];
  if (!password || password.length < minimumPasswordLength) {
    throw new Error(
      `DEV_SEED_PASSWORD must be set and contain at least ${minimumPasswordLength} characters`,
    );
  }

  const application = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const database = application.get(DatabaseService);
  const passwords = application.get(PasswordService);
  const pool = database.getPool();
  const passwordHash = await passwords.hash(password);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const employee = await client.query<{ id: string }>(
      `INSERT INTO identity.employees (
         id, employee_number, display_name, email, active
       ) VALUES ($1, 'DEV-001', 'Vista Development User', $2, true)
       ON CONFLICT (email) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         active = true,
         updated_at = now()
       RETURNING id`,
      [randomUUID(), email],
    );
    const employeeId = employee.rows[0]?.id;
    if (!employeeId) throw new Error('Development employee was not created');

    const account = await client.query<{ id: string }>(
      `INSERT INTO identity.user_accounts (
         id, employee_id, password_hash, password_changed_at, password_expires_at,
         status, failed_login_count, locked_until
       ) VALUES ($1, $2, $3, now(), NULL, 'active', 0, NULL)
       ON CONFLICT (employee_id) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         password_changed_at = now(),
         password_expires_at = NULL,
         status = 'active',
         failed_login_count = 0,
         locked_until = NULL,
         updated_at = now()
       RETURNING id`,
      [randomUUID(), employeeId, passwordHash],
    );
    const accountId = account.rows[0]?.id;
    if (!accountId) throw new Error('Development account was not created');

    const role = await client.query<{ id: string }>(
      `INSERT INTO iam.roles (id, code, name, description, is_administrative, is_system_role)
       VALUES ($1, 'dev-operator', 'Development operator', 'Local development access only', false, true)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         is_administrative = false,
         is_system_role = true,
         updated_at = now()
       RETURNING id`,
      [randomUUID()],
    );
    const roleId = role.rows[0]?.id;
    if (!roleId) throw new Error('Development role was not created');

    const permissions = [
      ['platform', 'view'],
      ['crm', 'view'],
      ['crm', 'create'],
      ['crm', 'edit'],
      ['erp.finance', 'view'],
      ['erp.procurement', 'view'],
      ['erp.warehouse', 'view'],
      ['erp.warehouse', 'create'],
      ['erp.sales', 'view'],
      ['erp.service', 'view'],
      ['erp.logistics', 'view'],
      ['reports', 'view'],
    ] as const;
    for (const [module, action] of permissions) {
      const permission = await client.query<{ id: string }>(
        `INSERT INTO iam.permissions (id, module, action, description)
         VALUES ($1, $2, $3, 'Development seed permission')
         ON CONFLICT (module, action) DO UPDATE SET description = EXCLUDED.description
         RETURNING id`,
        [randomUUID(), module, action],
      );
      const permissionId = permission.rows[0]?.id;
      if (!permissionId) throw new Error(`Permission ${module}:${action} was not created`);
      await client.query(
        `INSERT INTO iam.role_permissions (role_id, permission_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [roleId, permissionId],
      );
    }
    await client.query(
      `INSERT INTO iam.account_roles (account_id, role_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [accountId, roleId],
    );
    await client.query('COMMIT');
    console.log(`Development account ready: ${email}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await application.close();
  }
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
