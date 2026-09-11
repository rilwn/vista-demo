import 'dotenv/config';

import { parseEnvironment } from '@vista/config';
import { Pool, type PoolClient } from 'pg';

import { PasswordService } from '../auth/password.service.js';
import { assertDemoFixtureProvisioningIsAllowed } from './demo-fixture-provisioning.js';
import { bootstrapDevelopmentFixtures } from './development-fixtures.js';

async function run(): Promise<void> {
  assertDemoFixtureProvisioningIsAllowed(process.env);

  const password = requiredSetting('DEMO_FIXTURES_PASSWORD');
  const environment = parseEnvironment(process.env);
  const passwords = new PasswordService(environment);
  const pool = new Pool({
    application_name: 'vista-demo-fixture-provisioning',
    connectionString: environment.DATABASE_URL,
    max: 1,
  });
  let client: PoolClient | undefined;
  let transactionOpen = false;

  try {
    client = await pool.connect();
    const passwordHash = await passwords.hash(password, 'DEMO_FIXTURES_PASSWORD');
    await client.query('BEGIN');
    transactionOpen = true;
    const result = await bootstrapDevelopmentFixtures(
      client,
      passwordHash,
      passwords.passwordExpiresAt() ?? null,
    );
    await client.query('COMMIT');
    transactionOpen = false;
    process.stdout.write(
      [
        `Demo fixtures ready for ${result.accountEmails.length} non-administrative accounts.`,
        result.accountEmails.join('\n'),
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
  if (!value) throw new Error(`${name} must be set for demo-fixture provisioning.`);
  return value;
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
