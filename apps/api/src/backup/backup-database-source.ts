import type { AppEnvironment } from '@vista/config';

type DatabaseSourceEnvironment = Pick<
  AppEnvironment,
  'BACKUP_DATABASE_SOURCE_URLS_JSON' | 'BACKUP_PRIMARY_DATABASE_SOURCE_CODE' | 'DATABASE_URL'
>;

export type BackupDatabaseEngine = 'mariadb' | 'postgresql';

export function backupDatabaseSourceUrl(
  sourceCode: string | null,
  environment: DatabaseSourceEnvironment,
): string {
  const normalizedSourceCode = sourceCode?.trim().toUpperCase();
  if (!normalizedSourceCode) throw new Error('BACKUP_DATABASE_SOURCE_CODE_MISSING');

  const namedUrl = environment.BACKUP_DATABASE_SOURCE_URLS_JSON?.[normalizedSourceCode];
  if (namedUrl) return namedUrl;

  const primarySourceCode =
    environment.BACKUP_PRIMARY_DATABASE_SOURCE_CODE?.trim().toUpperCase() || 'VISTA-DB-01';
  if (normalizedSourceCode === primarySourceCode) return environment.DATABASE_URL;

  throw new Error('BACKUP_DATABASE_SOURCE_NOT_CONFIGURED');
}

export function backupDatabaseEngine(databaseUrl: string): BackupDatabaseEngine {
  let protocol: string;
  try {
    protocol = new URL(databaseUrl).protocol;
  } catch {
    throw new Error('BACKUP_DATABASE_URL_INVALID');
  }
  if (['postgres:', 'postgresql:'].includes(protocol)) return 'postgresql';
  if (['mariadb:', 'mysql:', 'mysql2:'].includes(protocol)) return 'mariadb';
  throw new Error('BACKUP_DATABASE_ENGINE_UNSUPPORTED');
}

export function databaseRestoreTargetMatches(
  sourceCode: string | null,
  sourceEnvironment: DatabaseSourceEnvironment,
  restoreUrl: string,
): boolean {
  if (!restoreUrl) return false;
  try {
    return (
      backupDatabaseEngine(backupDatabaseSourceUrl(sourceCode, sourceEnvironment)) ===
      backupDatabaseEngine(restoreUrl)
    );
  } catch {
    return false;
  }
}

export function databaseEngineMatchesRestoreTarget(
  sourceEngine: BackupDatabaseEngine | null | undefined,
  restoreUrl: string,
): boolean {
  if (!sourceEngine || !restoreUrl) return false;
  try {
    return sourceEngine === backupDatabaseEngine(restoreUrl);
  } catch {
    return false;
  }
}

export function isBackupDatabaseEngine(
  value: string | null | undefined,
): value is BackupDatabaseEngine {
  return value === 'mariadb' || value === 'postgresql';
}
