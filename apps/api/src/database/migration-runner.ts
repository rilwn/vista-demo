import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Pool, PoolClient } from 'pg';

const migrationPattern = /^(?<id>\d{4}_[a-z0-9_]+)\.(?<direction>up|down)\.sql$/;
const lockKey = 1_324_001;

interface MigrationFile {
  checksum: string;
  id: string;
  sql: string;
}

interface AppliedMigration {
  checksum: string;
  id: string;
}

export async function migrateUp(pool: Pool, directory: string): Promise<string[]> {
  const client = await pool.connect();
  try {
    await prepareMigrationStore(client);
    await client.query('SELECT pg_advisory_lock($1)', [lockKey]);

    const available = await readMigrations(directory, 'up');
    const applied = await readAppliedMigrations(client);
    validateAppliedMigrations(available, applied);
    const appliedIds = new Set(applied.map((migration) => migration.id));
    const pending = available.filter((migration) => !appliedIds.has(migration.id));

    for (const migration of pending) {
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO platform.schema_migrations (id, checksum)
           VALUES ($1, $2)`,
          [migration.id, migration.checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    return pending.map((migration) => migration.id);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [lockKey]).catch(() => undefined);
    client.release();
  }
}

export async function migrateDown(pool: Pool, directory: string): Promise<string | undefined> {
  const client = await pool.connect();
  try {
    await prepareMigrationStore(client);
    await client.query('SELECT pg_advisory_lock($1)', [lockKey]);
    const applied = await readAppliedMigrations(client);
    const latest = applied.at(-1);
    if (!latest) {
      return undefined;
    }

    const downMigrations = await readMigrations(directory, 'down');
    const migration = downMigrations.find((candidate) => candidate.id === latest.id);
    if (!migration) {
      throw new Error(`Missing down migration for ${latest.id}`);
    }

    await client.query('BEGIN');
    try {
      await client.query(migration.sql);
      await client.query('DELETE FROM platform.schema_migrations WHERE id = $1', [latest.id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    return latest.id;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [lockKey]).catch(() => undefined);
    client.release();
  }
}

async function prepareMigrationStore(client: PoolClient): Promise<void> {
  await client.query('CREATE SCHEMA IF NOT EXISTS platform');
  await client.query(`
    CREATE TABLE IF NOT EXISTS platform.schema_migrations (
      id varchar(255) PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function readMigrations(
  directory: string,
  direction: 'up' | 'down',
): Promise<MigrationFile[]> {
  const names = await readdir(directory);
  const migrations = await Promise.all(
    names
      .map((name) => ({ match: migrationPattern.exec(name), name }))
      .filter(({ match }) => match?.groups?.['direction'] === direction)
      .map(async ({ match, name }) => {
        const sql = await readFile(path.join(directory, name), 'utf8');
        return {
          checksum: createHash('sha256').update(sql).digest('hex'),
          id: match?.groups?.['id'] ?? '',
          sql,
        };
      }),
  );

  return migrations.sort((left, right) => left.id.localeCompare(right.id));
}

async function readAppliedMigrations(client: PoolClient): Promise<AppliedMigration[]> {
  const result = await client.query<AppliedMigration>(
    'SELECT id, checksum FROM platform.schema_migrations ORDER BY id',
  );
  return result.rows;
}

function validateAppliedMigrations(
  available: readonly MigrationFile[],
  applied: readonly AppliedMigration[],
): void {
  const availableById = new Map(available.map((migration) => [migration.id, migration]));

  for (const migration of applied) {
    const source = availableById.get(migration.id);
    if (!source) {
      throw new Error(`Applied migration ${migration.id} is missing from source control`);
    }
    if (source.checksum !== migration.checksum) {
      throw new Error(`Applied migration ${migration.id} has been modified`);
    }
  }
}
