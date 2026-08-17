import 'dotenv/config';

import { parseEnvironment } from '@vista/config';
import { Pool, type PoolClient } from 'pg';

import { PasswordService } from '../auth/password.service.js';
import {
  bootstrapDevelopmentFixtures,
  isLocalDevelopmentDatabase,
} from './development-fixtures.js';

async function run(): Promise<void> {
  if (process.env['DEV_FIXTURES_ENABLED'] !== 'true') {
    process.stdout.write(
      'Development fixtures are disabled. Set DEV_FIXTURES_ENABLED=true in your local .env to enable them.\n',
    );
    return;
  }
  if (process.env['NODE_ENV'] !== 'development') {
    throw new Error('Development fixtures require NODE_ENV=development');
  }

  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl || !isLocalDevelopmentDatabase(databaseUrl)) {
    throw new Error('Development fixtures require a PostgreSQL database hosted on this machine');
  }

  const password = process.env['DEV_FIXTURES_PASSWORD'];
  if (!password)
    throw new Error('DEV_FIXTURES_PASSWORD must be set when DEV_FIXTURES_ENABLED=true');

  const environment = parseEnvironment(process.env);
  const passwords = new PasswordService(environment);
  const pool = new Pool({
    application_name: 'vista-development-fixtures',
    connectionString: environment.DATABASE_URL,
    max: 1,
  });
  let client: PoolClient | undefined;
  let transactionOpen = false;

  try {
    client = await pool.connect();
    // PasswordService performs the configured length and complexity checks. The
    // resulting hash is used only for accounts that do not exist yet, so a
    // normal local startup cannot reset credentials or account state.
    const passwordHash = await passwords.hash(password, 'DEV_FIXTURES_PASSWORD');
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
      `Development fixtures ready for ${result.accountEmails.length} ERP/CRM accounts.\n`,
    );
  } catch (error) {
    if (client && transactionOpen) await client.query('ROLLBACK');
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
