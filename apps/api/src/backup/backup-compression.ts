import { createGunzip, createGzip } from 'node:zlib';
import { Transform } from 'node:stream';

import { backupDatabaseEngine } from './backup-database-source.js';

export type BackupCompressionAlgorithm = 'gzip' | 'none' | 'postgres_custom';

export function backupCompressionAlgorithm(
  sourceType: 'cloud_service' | 'database' | 'email' | 'file' | 'file_share' | 'object_storage',
  compressionEnabled: boolean,
  databaseUrl?: string,
): BackupCompressionAlgorithm {
  if (!compressionEnabled) return 'none';
  if (sourceType !== 'database') return 'gzip';
  if (!databaseUrl || backupDatabaseEngine(databaseUrl) === 'postgresql') {
    return 'postgres_custom';
  }
  return 'gzip';
}

export function createBackupCompressor(algorithm: BackupCompressionAlgorithm) {
  return algorithm === 'gzip' ? createGzip({ level: 6 }) : undefined;
}

export function createBackupDecompressor(algorithm: BackupCompressionAlgorithm) {
  return algorithm === 'gzip' ? createGunzip() : undefined;
}

export function createUncompressedSizeGuard(expectedBytes: string | null) {
  if (!expectedBytes || !/^\d+$/u.test(expectedBytes) || BigInt(expectedBytes) <= 0n) {
    throw new Error('BACKUP_UNCOMPRESSED_SIZE_MISSING');
  }
  const expected = BigInt(expectedBytes);
  let actual = 0n;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      actual += BigInt(chunk.length);
      if (actual > expected) {
        callback(new Error('BACKUP_UNCOMPRESSED_SIZE_EXCEEDED'));
        return;
      }
      callback(null, chunk);
    },
    flush(callback) {
      if (actual !== expected) {
        callback(new Error('BACKUP_UNCOMPRESSED_SIZE_MISMATCH'));
        return;
      }
      callback();
    },
  });
}
