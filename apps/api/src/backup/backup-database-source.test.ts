import { describe, expect, it } from 'vitest';

import type { AppEnvironment } from '@vista/config';

import {
  backupDatabaseEngine,
  backupDatabaseSourceUrl,
  databaseEngineMatchesRestoreTarget,
  databaseRestoreTargetMatches,
} from './backup-database-source.js';

const environment = {
  BACKUP_DATABASE_SOURCE_URLS_JSON: {
    'LEGACY-DB': 'mariadb://backup:secret@legacy.example.invalid/vista',
    'MYSQL-DB': 'mysql://backup:secret@mysql.example.invalid/vista',
    'REPORTING-DB': 'postgresql://backup:secret@reports.example.invalid/reporting',
  },
  BACKUP_PRIMARY_DATABASE_SOURCE_CODE: 'VISTA-DB-01',
  DATABASE_URL: 'postgresql://vista:secret@localhost:5432/vista',
} as unknown as AppEnvironment;

describe('backupDatabaseSourceUrl', () => {
  it('uses the configured primary application database for its registered source code', () => {
    expect(backupDatabaseSourceUrl('vista-db-01', environment)).toBe(environment.DATABASE_URL);
  });

  it('resolves another protected PostgreSQL source without storing its credentials in the database', () => {
    expect(backupDatabaseSourceUrl('reporting-db', environment)).toBe(
      'postgresql://backup:secret@reports.example.invalid/reporting',
    );
  });

  it('resolves MySQL-compatible sources and validates the matching isolated restore target', () => {
    expect(backupDatabaseSourceUrl('mysql-db', environment)).toBe(
      'mysql://backup:secret@mysql.example.invalid/vista',
    );
    expect(backupDatabaseSourceUrl('legacy-db', environment)).toBe(
      'mariadb://backup:secret@legacy.example.invalid/vista',
    );
    expect(backupDatabaseEngine('mysql://backup:secret@mysql.example.invalid/vista')).toBe(
      'mariadb',
    );
    expect(
      databaseRestoreTargetMatches(
        'MYSQL-DB',
        environment,
        'mariadb://restore:secret@recovery.example.invalid/recovery',
      ),
    ).toBe(true);
    expect(
      databaseRestoreTargetMatches(
        'MYSQL-DB',
        environment,
        'postgresql://restore:secret@recovery.example.invalid/recovery',
      ),
    ).toBe(false);
  });

  it('matches a database restore target from immutable archive metadata without source credentials', () => {
    expect(
      databaseEngineMatchesRestoreTarget(
        'mariadb',
        'mysql://restore:secret@recovery.example.invalid/recovery',
      ),
    ).toBe(true);
    expect(
      databaseEngineMatchesRestoreTarget(
        'postgresql',
        'mariadb://restore:secret@recovery.example.invalid/recovery',
      ),
    ).toBe(false);
    expect(
      databaseEngineMatchesRestoreTarget(null, 'postgresql://restore@localhost/recovery'),
    ).toBe(false);
  });

  it('refuses to run an unconfigured database source instead of backing up the wrong database', () => {
    expect(() => backupDatabaseSourceUrl('PAYROLL-DB', environment)).toThrow(
      'BACKUP_DATABASE_SOURCE_NOT_CONFIGURED',
    );
  });

  it('refuses a missing source code', () => {
    expect(() => backupDatabaseSourceUrl(null, environment)).toThrow(
      'BACKUP_DATABASE_SOURCE_CODE_MISSING',
    );
  });
});
