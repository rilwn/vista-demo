import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { SpawnOptions } from 'node:child_process';
import type { spawn as nodeSpawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PostgresBackupDumpRunner } from './postgres-backup-dump.runner.js';

describe('MySQL and MariaDB backup adapter', () => {
  let temporaryDirectory = '';

  afterEach(async () => {
    if (temporaryDirectory.startsWith(tmpdir())) {
      await rm(temporaryDirectory, { force: true, recursive: true });
      temporaryDirectory = '';
    }
  });

  it('streams a TLS-protected MariaDB export without placing credentials in arguments', async () => {
    const command = fakeDatabaseCommands();
    const runner = new PostgresBackupDumpRunner(command.spawn);
    const dump = runner.open(
      'mariadb://backup:secret%40pass@db.example.invalid/vista?ssl-mode=VERIFY_IDENTITY&ssl-ca=%2Fetc%2Fssl%2Fca.pem',
    );
    const chunks: Buffer[] = [];
    for await (const chunk of dump.stdout) chunks.push(Buffer.from(chunk));
    await dump.completed;

    expect(Buffer.concat(chunks).toString('utf8')).toContain('-- MariaDB dump');
    expect(command.calls[0]?.args).toEqual(
      expect.arrayContaining([
        '--ssl',
        '--ssl-verify-server-cert',
        '--ssl-ca=/etc/ssl/ca.pem',
        '--single-transaction',
        '--routines',
        '--events',
        'vista',
      ]),
    );
    expect(command.calls[0]?.executable).toBe('mariadb-dump');
    expect(command.calls[0]?.environment.MYSQL_PWD).toBe('secret@pass');
    expect(command.calls[0]?.args.join(' ')).not.toContain('secret');
  });

  it('validates, creates, verifies, restores, and safely drops an isolated MySQL database', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'vista-mysql-backup-'));
    const archive = join(temporaryDirectory, 'mariadb.sql');
    await writeFile(archive, '-- MariaDB dump 10.19\nCREATE TABLE demo(id INT);\n');
    const command = fakeDatabaseCommands();
    const runner = new PostgresBackupDumpRunner(command.spawn);
    const adminUrl = 'mysql://restore:secret@recovery.example.invalid/recovery';
    const databaseName = 'vista_restore_012345abcdef_1';
    const databaseUrl = `mysql://restore:secret@recovery.example.invalid/${databaseName}`;

    await expect(runner.validateArchive(archive, databaseUrl)).resolves.toEqual({
      hasVistaMigrationLedger: false,
    });
    await runner.createIsolatedDatabase(adminUrl, databaseName);
    await runner.restore(databaseUrl, archive);
    await runner.verifyIsolatedDatabase(databaseUrl);
    await runner.dropIsolatedDatabase(adminUrl, databaseName);

    expect(command.calls.map(({ executable }) => executable)).toEqual([
      'mariadb',
      'mariadb',
      'mariadb',
      'mariadb',
    ]);
    expect(command.inputs).toEqual(['-- MariaDB dump 10.19\nCREATE TABLE demo(id INT);\n']);
    expect(command.calls[0]?.args).toContain(
      `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4`,
    );
    expect(command.calls[1]?.args).toContain(databaseName);
    expect(command.calls[3]?.args).toContain(`DROP DATABASE IF EXISTS \`${databaseName}\``);
  });

  it('rejects untrusted connection settings and malformed dump files', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'vista-mysql-invalid-'));
    const malformedArchive = join(temporaryDirectory, 'invalid.sql');
    await writeFile(malformedArchive, 'not a database archive');
    const command = fakeDatabaseCommands();
    const runner = new PostgresBackupDumpRunner(command.spawn);
    expect(() =>
      runner.open('mysql://backup:secret@db.example.invalid/vista?ssl-mode=DISABLED'),
    ).toThrow('BACKUP_DATABASE_TLS_REQUIRED');
    await expect(
      runner.validateArchive(malformedArchive, 'mysql://backup:secret@db/vista'),
    ).rejects.toThrow('BACKUP_ARCHIVE_INVALID');
    await expect(
      runner.createIsolatedDatabase('mysql://backup:secret@db/vista', 'unsafe-name'),
    ).rejects.toThrow('BACKUP_RESTORE_TARGET_NAME_INVALID');
  });

  it('lists primary-key tables and exports only the requested MariaDB row', async () => {
    const command = fakeDatabaseCommands();
    const runner = new PostgresBackupDumpRunner(command.spawn);
    const databaseUrl =
      'mariadb://restore:secret@recovery.example.invalid/vista_restore_012345abcdef_1';

    await expect(runner.listRecoveryTables(databaseUrl)).resolves.toEqual([
      { name: 'customers', primaryKeyColumns: ['id'] },
    ]);
    await expect(
      runner.readRecoveryRecord(databaseUrl, 'customers', { id: "owner's-record" }),
    ).resolves.toEqual({ id: 'owner', name: 'Recovered customer' });
    expect(
      command.calls.some(({ args }) =>
        args.some((argument) => argument.includes("CAST(`id` AS CHAR)='owner''s-record'")),
      ),
    ).toBe(true);
    await expect(
      runner.readRecoveryRecord(databaseUrl, 'customers; DROP TABLE x', { id: '1' }),
    ).rejects.toThrow('BACKUP_RECOVERY_TABLE_NOT_AVAILABLE');
  });
});

function fakeDatabaseCommands() {
  const calls: Array<{
    args: string[];
    environment: NodeJS.ProcessEnv;
    executable: string;
  }> = [];
  const inputs: string[] = [];
  const spawn = vi.fn((executable: string, args: readonly string[], options: SpawnOptions = {}) => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    const child = new EventEmitter() as EventEmitter & {
      kill: ReturnType<typeof vi.fn>;
      stderr: PassThrough;
      stdin: PassThrough;
      stdout: PassThrough;
    };
    Object.assign(child, { kill: vi.fn(), stderr, stdin, stdout });
    calls.push({
      args: [...args],
      environment: options.env ?? {},
      executable,
    });
    if (executable === 'mariadb-dump') {
      queueMicrotask(() => {
        stdout.end('-- MariaDB dump 10.19\n');
        stderr.end();
        child.emit('close', 0);
      });
    } else if (args.includes('--execute')) {
      queueMicrotask(() => {
        const statement = args[args.indexOf('--execute') + 1] ?? '';
        if (statement.startsWith('SELECT COUNT(*)')) stdout.end('2\n');
        else if (statement.includes('KEY_COLUMN_USAGE')) stdout.end('customers\tid\n');
        else if (statement.includes('information_schema.COLUMNS')) stdout.end('id\nname\n');
        else if (statement.includes('JSON_OBJECT')) {
          stdout.end('{"id":"owner","name":"Recovered customer"}\n');
        } else stdout.end();
        stderr.end();
        child.emit('close', 0);
      });
    } else {
      stdin.on('data', (chunk: Buffer) => inputs.push(Buffer.from(chunk).toString('utf8')));
      stdin.on('finish', () => {
        stderr.end();
        child.emit('close', 0);
      });
    }
    return child;
  }) as unknown as typeof nodeSpawn;
  return { calls, inputs, spawn };
}
