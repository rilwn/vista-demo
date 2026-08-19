import 'dotenv/config';

import { parseEnvironment } from '@vista/config';
import { Pool, type PoolClient } from 'pg';

import { provisionInitialAdministrator } from '../auth/initial-administrator-provisioning.js';
import { PasswordService } from '../auth/password.service.js';
import { TotpService } from '../auth/totp.service.js';

async function run(): Promise<void> {
  if (process.env['INITIAL_ADMIN_PROVISIONING_ENABLED'] !== 'true') {
    throw new Error(
      'Set INITIAL_ADMIN_PROVISIONING_ENABLED=true only for the one-time controlled provisioning run.',
    );
  }
  const email = requiredSetting('INITIAL_ADMIN_EMAIL');
  const displayName = requiredSetting('INITIAL_ADMIN_DISPLAY_NAME');
  const employeeNumber = requiredSetting('INITIAL_ADMIN_EMPLOYEE_NUMBER');
  const password = requiredSetting('INITIAL_ADMIN_PASSWORD');
  const environment = parseEnvironment(process.env);
  const passwords = new PasswordService(environment);
  const totp = new TotpService(environment);
  const pool = new Pool({
    application_name: 'vista-initial-administrator-provisioning',
    connectionString: environment.DATABASE_URL,
    max: 1,
  });
  let client: PoolClient | undefined;
  let transactionOpen = false;

  try {
    client = await pool.connect();
    const passwordHash = await passwords.hash(password, 'INITIAL_ADMIN_PASSWORD');
    await client.query('BEGIN');
    transactionOpen = true;
    const result = await provisionInitialAdministrator(
      client,
      {
        displayName,
        email,
        employeeNumber,
        passwordExpiresAt: passwords.passwordExpiresAt() ?? null,
        passwordHash,
      },
      totp,
    );
    await client.query('COMMIT');
    transactionOpen = false;
    process.stdout.write(
      [
        `Initial administrator provisioned for ${result.email}.`,
        'Add this one-time key to a trusted authenticator app before signing in:',
        result.enrollmentKey,
        'Do not save this key in source control, shell history, tickets, or shared chat.',
      ].join('\n') + '\n',
    );
  } catch (error) {
    if (client && transactionOpen) await client.query('ROLLBACK');
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

function requiredSetting(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set for initial administrator provisioning.`);
  return value;
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
