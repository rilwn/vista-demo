import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import type { AppEnvironment, BackupObjectStorageSourceConfig } from '@vista/config';
import { describe, expect, it, vi } from 'vitest';

import type { ObjectStorageService } from '../storage/object-storage.service.js';
import { ObjectStorageBackupArchive } from './object-storage-backup-archive.js';
import {
  objectStorageBackupSourceSnapshot,
  resolveObjectStorageBackupSource,
  S3ObjectStorageBackupSource,
} from './object-storage-backup-source.js';

const config: BackupObjectStorageSourceConfig = {
  accessKeyId: 'read-only-access',
  bucket: 'vista-customer-documents',
  endpoint: 'https://s3.example.invalid',
  forcePathStyle: false,
  region: 'eu-central-1',
  secretAccessKey: 'deployment-secret-only',
};

describe('S3ObjectStorageBackupSource', () => {
  it('streams a stable configured bucket into the verified archive format', async () => {
    const content = Buffer.from('customer document from the configured cloud bucket');
    let listingCount = 0;
    const send = vi.fn((command: { constructor: { name: string } }) => {
      if (command.constructor.name === 'ListObjectsV2Command') {
        listingCount += 1;
        return {
          Contents: [{ ETag: '"doc-v1"', Key: 'customers/contract.pdf', Size: content.length }],
          IsTruncated: false,
        };
      }
      if (command.constructor.name === 'HeadObjectCommand') {
        return {
          ContentLength: content.length,
          ContentType: 'application/pdf',
          ETag: '"doc-v1"',
          Metadata: { 'record-id': 'partner-1' },
        };
      }
      if (command.constructor.name === 'GetObjectCommand') {
        return {
          Body: Readable.from([content]),
          ContentLength: content.length,
          ETag: '"doc-v1"',
        };
      }
      throw new Error(`Unexpected S3 command ${command.constructor.name}`);
    });
    const source = new S3ObjectStorageBackupSource(config, {
      destroy: vi.fn(),
      send,
    } as never);
    const archive = new ObjectStorageBackupArchive();
    const chunks: Buffer[] = [];
    for await (const chunk of archive.open(source)) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    const manifest = await archive.validate(Readable.from([bytes]), config.bucket);

    expect(source.bucketName()).toBe(config.bucket);
    expect(manifest.objects).toMatchObject([
      {
        contentType: 'application/pdf',
        key: 'customers/contract.pdf',
        metadata: { 'record-id': 'partner-1' },
        sha256: createHash('sha256').update(content).digest('hex'),
        size: content.length,
      },
    ]);
    expect(listingCount).toBe(3);
    expect(send).toHaveBeenCalledTimes(8);
    source.close();
  });

  it('uses deployment secrets for an explicitly mapped source and rejects an unmapped one', () => {
    const managed = { bucketName: () => 'vista-files' } as ObjectStorageService;
    const environment = {
      BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON: { 'CLOUD-DOCS': config },
      BACKUP_PRIMARY_OBJECT_STORAGE_SOURCE_CODE: 'VISTA-FILES-01',
    } as unknown as AppEnvironment;
    const handle = resolveObjectStorageBackupSource(
      'cloud-docs',
      config.bucket,
      environment,
      managed,
    );
    expect(handle.source.bucketName()).toBe(config.bucket);
    handle.close();

    expect(() =>
      resolveObjectStorageBackupSource(
        'UNMAPPED-DOCS',
        'vista-customer-documents',
        environment,
        managed,
      ),
    ).toThrow('BACKUP_OBJECT_STORAGE_SOURCE_NOT_CONFIGURED');
    const primary = resolveObjectStorageBackupSource(
      'VISTA-FILES-01',
      'Vista file store',
      environment,
      managed,
    );
    expect(primary.source).toBe(managed);
    primary.close();
    const legacy = resolveObjectStorageBackupSource(
      'OLD-FILES',
      'Vista file store',
      environment,
      managed,
      true,
    );
    expect(legacy.source).toBe(managed);
    legacy.close();
  });

  it('keeps the source fingerprint stable across credential rotation but changes it for a new endpoint', () => {
    const environment = {
      BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON: { 'CLOUD-DOCS': config },
      BACKUP_PRIMARY_OBJECT_STORAGE_SOURCE_CODE: 'VISTA-FILES-01',
      S3_ENDPOINT: 'https://managed.example.invalid',
      S3_REGION: 'eu-central-1',
    } as unknown as AppEnvironment;
    const original = objectStorageBackupSourceSnapshot(
      'CLOUD-DOCS',
      config.bucket,
      environment,
      'vista-files',
    );
    environment.BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON = {
      'CLOUD-DOCS': { ...config, secretAccessKey: 'rotated-secret' },
    };
    expect(
      objectStorageBackupSourceSnapshot('CLOUD-DOCS', config.bucket, environment, 'vista-files'),
    ).toEqual(original);
    environment.BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON = {
      'CLOUD-DOCS': { ...config, endpoint: 'https://different.example.invalid' },
    };
    expect(
      objectStorageBackupSourceSnapshot('CLOUD-DOCS', config.bucket, environment, 'vista-files')
        .identity,
    ).not.toBe(original.identity);
  });

  it('requires a configured source location to match the protected bucket exactly', () => {
    const managed = { bucketName: () => 'vista-files' } as ObjectStorageService;
    const environment = {
      BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON: { 'CLOUD-DOCS': config },
      BACKUP_PRIMARY_OBJECT_STORAGE_SOURCE_CODE: 'VISTA-FILES-01',
    } as unknown as AppEnvironment;
    expect(() =>
      resolveObjectStorageBackupSource('CLOUD-DOCS', 'another-bucket', environment, managed),
    ).toThrow('BACKUP_OBJECT_STORAGE_SOURCE_BUCKET_MISMATCH');
  });
});
