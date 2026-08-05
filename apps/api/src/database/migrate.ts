import 'dotenv/config';

import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

import { migrateDown, migrateUp } from './migration-runner.js';

async function run(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl?.startsWith('postgresql://')) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  }

  const direction = process.argv[2];
  if (direction !== 'up' && direction !== 'down') {
    throw new Error('Migration direction must be either up or down');
  }

  const pool = new Pool({
    application_name: 'vista-migrations',
    connectionString: databaseUrl,
    max: 1,
  });
  const directory = fileURLToPath(new URL('./migrations', import.meta.url));

  try {
    if (direction === 'up') {
      const migrations = await migrateUp(pool, directory);
      process.stdout.write(
        migrations.length > 0
          ? `Applied migrations: ${migrations.join(', ')}\n`
          : 'Database is already current.\n',
      );
      return;
    }

    const migration = await migrateDown(pool, directory);
    process.stdout.write(
      migration ? `Rolled back migration: ${migration}\n` : 'No migration to roll back.\n',
    );
  } finally {
    await pool.end();
  }
}

void run();
