import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { open as openFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Client } from 'pg';

import { backupDatabaseEngine, isBackupDatabaseEngine } from './backup-database-source.js';

export interface DatabaseDumpProcess {
  cancel(): void;
  completed: Promise<void>;
  stdout: Readable;
}

export interface DatabaseRecoveryTable {
  name: string;
  primaryKeyColumns: string[];
}

export class PostgresBackupDumpRunner {
  constructor(private readonly spawnCommand: typeof spawn = spawn) {}

  open(databaseUrl: string, options: { compressionEnabled?: boolean } = {}): DatabaseDumpProcess {
    if (backupDatabaseEngine(databaseUrl) === 'mariadb') {
      const connection = parseMariaDbUrl(databaseUrl);
      const child = this.spawnCommand(
        'mariadb-dump',
        [
          ...mariaDbConnectionArguments(connection),
          '--single-transaction',
          '--quick',
          '--routines',
          '--events',
          '--triggers',
          '--hex-blob',
          '--default-character-set=utf8mb4',
          connection.database,
        ],
        {
          env: mariaDbEnvironment(connection),
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      child.stderr.on('data', () => undefined);
      const completed = new Promise<void>((resolve, reject) => {
        child.once('error', () => reject(new Error('BACKUP_DUMP_TOOL_UNAVAILABLE')));
        child.once('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error('BACKUP_DATABASE_DUMP_FAILED'));
        });
      });
      return { cancel: () => child.kill('SIGTERM'), completed, stdout: child.stdout };
    }
    const parsed = new URL(databaseUrl);
    if (
      !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      !parsed.pathname.slice(1)
    ) {
      throw new Error('BACKUP_DATABASE_URL_INVALID');
    }
    const password = decodeURIComponent(parsed.password);
    parsed.password = '';
    const child = this.spawnCommand(
      'pg_dump',
      [
        '--format=custom',
        `--compress=${options.compressionEnabled === false ? '0' : '6'}`,
        '--no-owner',
        '--no-acl',
        '--dbname',
        parsed.toString(),
      ],
      {
        env: { ...process.env, PGPASSWORD: password },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stderr.on('data', () => undefined);
    const completed = new Promise<void>((resolve, reject) => {
      child.once('error', () => reject(new Error('BACKUP_DUMP_TOOL_UNAVAILABLE')));
      child.once('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error('BACKUP_DATABASE_DUMP_FAILED'));
      });
    });
    return {
      cancel: () => child.kill('SIGTERM'),
      completed,
      stdout: child.stdout,
    };
  }

  async validateArchive(
    filePath: string,
    engineOrUrl?: string,
  ): Promise<{ hasVistaMigrationLedger: boolean }> {
    const engine = isBackupDatabaseEngine(engineOrUrl)
      ? engineOrUrl
      : engineOrUrl
        ? backupDatabaseEngine(engineOrUrl)
        : undefined;
    if (engine === 'mariadb') {
      const handle = await openFile(filePath, 'r');
      const header = Buffer.alloc(64 * 1024);
      let bytesRead: number;
      try {
        ({ bytesRead } = await handle.read(header, 0, header.length, 0));
      } finally {
        await handle.close();
      }
      const prefix = header.subarray(0, bytesRead!).toString('utf8');
      if (!/(?:MySQL|MariaDB) dump|-- MySQL|-- MariaDB/iu.test(prefix)) {
        throw new Error('BACKUP_ARCHIVE_INVALID');
      }
      return { hasVistaMigrationLedger: false };
    }
    const child = this.spawnCommand('pg_restore', ['--list', filePath], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const completed = new Promise<void>((resolve, reject) => {
      child.once('error', () => reject(new Error('BACKUP_RESTORE_TOOL_UNAVAILABLE')));
      child.once('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error('BACKUP_ARCHIVE_INVALID'));
      });
    });
    const inspect = async () => {
      let hasVistaMigrationLedger = false;
      const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
      for await (const line of lines) {
        if (/^\s*\d+;\s+\d+\s+\d+\s+TABLE\s+platform\s+schema_migrations(?:\s|$)/u.test(line)) {
          hasVistaMigrationLedger = true;
        }
      }
      return hasVistaMigrationLedger;
    };
    const [hasVistaMigrationLedger] = await Promise.all([inspect(), completed]);
    return { hasVistaMigrationLedger };
  }

  async restore(databaseUrl: string, filePath: string): Promise<void> {
    if (backupDatabaseEngine(databaseUrl) === 'mariadb') {
      const connection = parseMariaDbUrl(databaseUrl);
      const child = this.spawnCommand(
        'mariadb',
        [
          ...mariaDbConnectionArguments(connection),
          '--default-character-set=utf8mb4',
          '--binary-mode',
          '--database',
          connection.database,
        ],
        { env: mariaDbEnvironment(connection), stdio: ['pipe', 'ignore', 'pipe'] },
      );
      child.stderr.on('data', () => undefined);
      const completed = processSucceeded(child, 'BACKUP_DATABASE_RESTORE_FAILED');
      try {
        await Promise.all([pipeline(createReadStream(filePath), child.stdin), completed]);
      } catch (error) {
        child.kill('SIGTERM');
        await Promise.allSettled([completed]);
        if (error instanceof Error && error.message === 'BACKUP_RESTORE_TOOL_UNAVAILABLE')
          throw error;
        throw new Error('BACKUP_DATABASE_RESTORE_FAILED');
      }
      return;
    }
    const parsed = new URL(databaseUrl);
    if (
      !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      !parsed.pathname.slice(1)
    ) {
      throw new Error('BACKUP_RESTORE_DATABASE_URL_INVALID');
    }
    const password = decodeURIComponent(parsed.password);
    parsed.password = '';
    const environment = { ...process.env, PGPASSWORD: password };
    const archive = this.spawnCommand(
      'pg_restore',
      ['--no-owner', '--no-acl', '--file=-', filePath],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const restore = this.spawnCommand(
      'psql',
      [
        '--no-psqlrc',
        '--set=ON_ERROR_STOP=1',
        '--single-transaction',
        '--dbname',
        parsed.toString(),
      ],
      { env: environment, stdio: ['pipe', 'ignore', 'pipe'] },
    );
    archive.stderr.on('data', () => undefined);
    restore.stderr.on('data', () => undefined);
    const tasks = [
      pipeline(archive.stdout, new RestoreSqlCompatibilityFilter(), restore.stdin),
      processSucceeded(archive),
      processSucceeded(restore),
    ];
    try {
      await Promise.all(tasks);
    } catch (error) {
      archive.kill('SIGTERM');
      restore.kill('SIGTERM');
      await Promise.allSettled(tasks);
      if (error instanceof Error && error.message === 'BACKUP_RESTORE_TOOL_UNAVAILABLE')
        throw error;
      throw new Error('BACKUP_DATABASE_RESTORE_FAILED');
    }
  }

  async createIsolatedDatabase(adminUrl: string, databaseName: string): Promise<void> {
    assertRestoreDatabaseName(databaseName);
    const connection = parseMariaDbUrl(adminUrl);
    await runMariaDbCommand(this.spawnCommand, connection, [
      '--execute',
      `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4`,
    ]);
  }

  async dropIsolatedDatabase(adminUrl: string, databaseName: string): Promise<void> {
    if (!/^vista_restore_[a-f0-9_]+$/u.test(databaseName)) return;
    const connection = parseMariaDbUrl(adminUrl);
    await runMariaDbCommand(this.spawnCommand, connection, [
      '--execute',
      `DROP DATABASE IF EXISTS \`${databaseName}\``,
    ]);
  }

  async verifyIsolatedDatabase(databaseUrl: string): Promise<void> {
    const connection = parseMariaDbUrl(databaseUrl);
    const result = await runMariaDbCommand(this.spawnCommand, connection, [
      '--batch',
      '--skip-column-names',
      '--execute',
      'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()',
      '--database',
      connection.database,
    ]);
    const tableCount = Number(result.trim());
    if (!Number.isSafeInteger(tableCount) || tableCount < 1) {
      throw new Error('BACKUP_RESTORE_CONTENT_CHECK_FAILED');
    }
  }

  async listRecoveryTables(databaseUrl: string): Promise<DatabaseRecoveryTable[]> {
    if (backupDatabaseEngine(databaseUrl) === 'mariadb') {
      const connection = parseMariaDbUrl(databaseUrl);
      const result = await runMariaDbCommand(this.spawnCommand, connection, [
        '--batch',
        '--raw',
        '--skip-column-names',
        '--execute',
        `SELECT CONCAT(TABLE_NAME, CHAR(9), GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION SEPARATOR ','))
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA=DATABASE() AND CONSTRAINT_NAME='PRIMARY'
         GROUP BY TABLE_NAME ORDER BY TABLE_NAME`,
        '--database',
        connection.database,
      ]);
      return result
        .split(/\r?\n/u)
        .map((line) => line.split('\t'))
        .filter((parts) => parts.length === 2 && isSafeDatabaseIdentifier(parts[0]!))
        .map(([name, columns]) => ({
          name: name!,
          primaryKeyColumns: columns!.split(',').filter(isSafeDatabaseIdentifier),
        }))
        .filter(({ primaryKeyColumns }) => primaryKeyColumns.length > 0);
    }

    const client = new Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      const result = await client.query<{ name: string; primary_key_columns: string[] }>(
        `SELECT table_constraints.table_schema || '.' || table_constraints.table_name AS name,
           array_agg(key_columns.column_name::text ORDER BY key_columns.ordinal_position) AS primary_key_columns
         FROM information_schema.table_constraints table_constraints
         JOIN information_schema.key_column_usage key_columns
           ON key_columns.constraint_catalog=table_constraints.constraint_catalog
          AND key_columns.constraint_schema=table_constraints.constraint_schema
          AND key_columns.constraint_name=table_constraints.constraint_name
          AND key_columns.table_schema=table_constraints.table_schema
          AND key_columns.table_name=table_constraints.table_name
         WHERE table_constraints.constraint_type='PRIMARY KEY'
           AND table_constraints.table_schema NOT IN ('pg_catalog','information_schema')
         GROUP BY table_constraints.table_schema,table_constraints.table_name
         ORDER BY table_constraints.table_schema,table_constraints.table_name`,
      );
      return result.rows
        .filter(
          ({ name, primary_key_columns }) =>
            name.split('.').every(isSafeDatabaseIdentifier) &&
            primary_key_columns.every(isSafeDatabaseIdentifier),
        )
        .map(({ name, primary_key_columns }) => ({
          name,
          primaryKeyColumns: primary_key_columns,
        }));
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  async readRecoveryRecord(
    databaseUrl: string,
    tableName: string,
    primaryKey: Record<string, string>,
  ): Promise<Record<string, unknown> | undefined> {
    const tables = await this.listRecoveryTables(databaseUrl);
    const table = tables.find((candidate) => candidate.name === tableName);
    if (!table) throw new Error('BACKUP_RECOVERY_TABLE_NOT_AVAILABLE');
    const keyColumns = table.primaryKeyColumns;
    if (
      Object.keys(primaryKey).length !== keyColumns.length ||
      keyColumns.some((column) => {
        const value = primaryKey[column];
        return typeof value !== 'string' || value.length > 2048;
      })
    ) {
      throw new Error('BACKUP_RECOVERY_PRIMARY_KEY_INVALID');
    }

    if (backupDatabaseEngine(databaseUrl) === 'mariadb') {
      const connection = parseMariaDbUrl(databaseUrl);
      const columns = await this.listMariaDbColumns(connection, table.name);
      if (columns.length === 0) throw new Error('BACKUP_RECOVERY_TABLE_NOT_AVAILABLE');
      const predicates = keyColumns
        .map((column) => `CAST(\`${column}\` AS CHAR)=${quoteSqlString(primaryKey[column]!)}`)
        .join(' AND ');
      const projection = columns
        .map((column) => `${quoteSqlString(column)},\`${column}\``)
        .join(',');
      const result = await runMariaDbCommand(this.spawnCommand, connection, [
        '--batch',
        '--raw',
        '--skip-column-names',
        '--execute',
        `SELECT JSON_OBJECT(${projection}) FROM \`${table.name}\` WHERE ${predicates} LIMIT 2`,
        '--database',
        connection.database,
      ]);
      const rows = result
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => parseRecoveryRecord(line));
      if (rows.length > 1) throw new Error('BACKUP_RECOVERY_PRIMARY_KEY_NOT_UNIQUE');
      return rows[0];
    }

    const [schema, name] = table.name.split('.');
    if (!schema || !name) throw new Error('BACKUP_RECOVERY_TABLE_NOT_AVAILABLE');
    const predicates = keyColumns
      .map((column, index) => `${quotePostgresIdentifier(column)}::text=$${index + 1}`)
      .join(' AND ');
    const client = new Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      const result = await client.query<{ record: Record<string, unknown> }>(
        `SELECT to_jsonb(recovered_row) AS record
         FROM ${quotePostgresIdentifier(schema)}.${quotePostgresIdentifier(name)} recovered_row
         WHERE ${predicates} LIMIT 2`,
        keyColumns.map((column) => primaryKey[column]),
      );
      if (result.rows.length > 1) throw new Error('BACKUP_RECOVERY_PRIMARY_KEY_NOT_UNIQUE');
      return result.rows[0]?.record;
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private async listMariaDbColumns(
    connection: MariaDbConnection,
    tableName: string,
  ): Promise<string[]> {
    if (!isSafeDatabaseIdentifier(tableName))
      throw new Error('BACKUP_RECOVERY_TABLE_NOT_AVAILABLE');
    const result = await runMariaDbCommand(this.spawnCommand, connection, [
      '--batch',
      '--raw',
      '--skip-column-names',
      '--execute',
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=${quoteSqlString(tableName)}
       ORDER BY ORDINAL_POSITION`,
      '--database',
      connection.database,
    ]);
    return result.split(/\r?\n/u).filter(isSafeDatabaseIdentifier);
  }
}

class RestoreSqlCompatibilityFilter extends Transform {
  private pending = '';

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ): void {
    const lines = `${this.pending}${chunk.toString('utf8')}`.split('\n');
    this.pending = lines.pop() ?? '';
    callback(
      null,
      Buffer.from(lines.filter((line) => !isUnsupportedRestoreSetting(line)).join('\n') + '\n'),
    );
  }

  override _flush(callback: (error?: Error | null, data?: Buffer) => void): void {
    const tail = this.pending && !isUnsupportedRestoreSetting(this.pending) ? this.pending : '';
    callback(null, tail ? Buffer.from(tail) : undefined);
  }
}

interface MariaDbConnection {
  database: string;
  host: string;
  password: string;
  port?: string;
  sslCa?: string;
  sslMode: string;
  username: string;
}

function parseMariaDbUrl(databaseUrl: string): MariaDbConnection {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('BACKUP_DATABASE_URL_INVALID');
  }
  if (
    !['mariadb:', 'mysql:', 'mysql2:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    !parsed.username ||
    parsed.pathname.length < 2
  ) {
    throw new Error('BACKUP_DATABASE_URL_INVALID');
  }
  const database = decodeURIComponent(parsed.pathname.slice(1));
  if (!/^[A-Za-z0-9_][A-Za-z0-9_$-]{0,63}$/u.test(database)) {
    throw new Error('BACKUP_DATABASE_URL_INVALID');
  }
  const sslMode = (parsed.searchParams.get('ssl-mode') ?? 'REQUIRED').toUpperCase();
  const host = parsed.hostname.replace(/^\[|\]$/gu, '');
  const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(host.toLowerCase());
  if (!['REQUIRED', 'VERIFY_CA', 'VERIFY_IDENTITY', 'DISABLED'].includes(sslMode)) {
    throw new Error('BACKUP_DATABASE_URL_INVALID');
  }
  if (sslMode === 'DISABLED' && !isLoopback) {
    throw new Error('BACKUP_DATABASE_TLS_REQUIRED');
  }
  return {
    database,
    host,
    password: decodeURIComponent(parsed.password),
    ...(parsed.port ? { port: parsed.port } : {}),
    ...(parsed.searchParams.get('ssl-ca') ? { sslCa: parsed.searchParams.get('ssl-ca')! } : {}),
    sslMode,
    username: decodeURIComponent(parsed.username),
  };
}

function mariaDbConnectionArguments(connection: MariaDbConnection): string[] {
  const args = [
    '--no-defaults',
    '--protocol=tcp',
    '--host',
    connection.host,
    '--user',
    connection.username,
  ];
  if (connection.port) args.push('--port', connection.port);
  if (connection.sslMode !== 'DISABLED') args.push('--ssl');
  if (connection.sslCa) args.push(`--ssl-ca=${connection.sslCa}`);
  if (['VERIFY_CA', 'VERIFY_IDENTITY'].includes(connection.sslMode)) {
    args.push('--ssl-verify-server-cert');
  }
  return args;
}

function mariaDbEnvironment(connection: MariaDbConnection): NodeJS.ProcessEnv {
  return { ...process.env, MYSQL_PWD: connection.password };
}

async function runMariaDbCommand(
  spawnCommand: typeof spawn,
  connection: MariaDbConnection,
  arguments_: string[],
): Promise<string> {
  const child = spawnCommand(
    'mariadb',
    [...mariaDbConnectionArguments(connection), ...arguments_],
    {
      env: mariaDbEnvironment(connection),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const stdout: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(Buffer.from(chunk)));
  child.stderr.on('data', () => undefined);
  await processSucceeded(child, 'BACKUP_DATABASE_COMMAND_FAILED');
  return Buffer.concat(stdout).toString('utf8');
}

function assertRestoreDatabaseName(databaseName: string): void {
  if (!/^vista_restore_[a-f0-9_]+$/u.test(databaseName)) {
    throw new Error('BACKUP_RESTORE_TARGET_NAME_INVALID');
  }
}

function isUnsupportedRestoreSetting(line: string): boolean {
  // PostgreSQL 17 added this client session setting; older supported targets do not recognize it.
  return /^\s*SET\s+transaction_timeout\s*=\s*0\s*;\s*$/iu.test(line);
}

function isSafeDatabaseIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_$]{0,127}$/u.test(value);
}

function quotePostgresIdentifier(value: string): string {
  if (!isSafeDatabaseIdentifier(value)) throw new Error('BACKUP_RECOVERY_TABLE_NOT_AVAILABLE');
  return `"${value}"`;
}

function quoteSqlString(value: string): string {
  if (value.includes('\0') || value.length > 2048) {
    throw new Error('BACKUP_RECOVERY_PRIMARY_KEY_INVALID');
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function parseRecoveryRecord(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('BACKUP_RECOVERY_RECORD_INVALID');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error('BACKUP_RECOVERY_RECORD_INVALID');
  }
}

function processSucceeded(
  child: ReturnType<typeof spawn>,
  failureCode = 'BACKUP_DATABASE_RESTORE_FAILED',
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    child.once('error', () => reject(new Error('BACKUP_RESTORE_TOOL_UNAVAILABLE')));
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(failureCode));
    });
  });
}
