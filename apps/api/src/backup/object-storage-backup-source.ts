import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import type { AppEnvironment, BackupObjectStorageSourceConfig } from '@vista/config';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

import type { ObjectStorageService } from '../storage/object-storage.service.js';
import type { ObjectStorageBackupSource } from './object-storage-backup-archive.js';

const sourceRequestTimeoutMs = 30_000;

export interface ObjectStorageBackupSourceHandle {
  close(): void;
  source: ObjectStorageBackupSource;
}

export function resolveObjectStorageBackupSource(
  sourceCode: string | null,
  sourceLocation: string | null,
  environment: Pick<
    AppEnvironment,
    'BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON' | 'BACKUP_PRIMARY_OBJECT_STORAGE_SOURCE_CODE'
  >,
  managedStorage: ObjectStorageService,
  legacyManaged = false,
): ObjectStorageBackupSourceHandle {
  const normalizedCode = normalizeSourceCode(sourceCode);
  const config = environment.BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON?.[normalizedCode];
  if (config) {
    assertConfiguredBucketMatches(sourceLocation, config.bucket);
    const source = new S3ObjectStorageBackupSource(config);
    return { close: () => source.close(), source };
  }
  const primaryCode =
    environment.BACKUP_PRIMARY_OBJECT_STORAGE_SOURCE_CODE?.trim().toUpperCase() || 'VISTA-FILES-01';
  if (normalizedCode !== primaryCode && !legacyManaged) {
    throw new Error('BACKUP_OBJECT_STORAGE_SOURCE_NOT_CONFIGURED');
  }
  return { close: () => undefined, source: managedStorage };
}

export function objectStorageBackupSourceBucket(
  sourceCode: string | null,
  sourceLocation: string | null,
  environment: Pick<
    AppEnvironment,
    'BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON' | 'BACKUP_PRIMARY_OBJECT_STORAGE_SOURCE_CODE'
  >,
  managedBucket: string,
  legacyManaged = false,
): string {
  const normalizedCode = normalizeSourceCode(sourceCode);
  const config = environment.BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON?.[normalizedCode];
  if (config) {
    assertConfiguredBucketMatches(sourceLocation, config.bucket);
    return config.bucket;
  }
  const primaryCode =
    environment.BACKUP_PRIMARY_OBJECT_STORAGE_SOURCE_CODE?.trim().toUpperCase() || 'VISTA-FILES-01';
  if (normalizedCode !== primaryCode && !legacyManaged) {
    throw new Error('BACKUP_OBJECT_STORAGE_SOURCE_NOT_CONFIGURED');
  }
  return managedBucket;
}

export function objectStorageBackupSourceSnapshot(
  sourceCode: string | null,
  sourceLocation: string | null,
  environment: Pick<
    AppEnvironment,
    | 'BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON'
    | 'BACKUP_PRIMARY_OBJECT_STORAGE_SOURCE_CODE'
    | 'S3_ENDPOINT'
    | 'S3_REGION'
  >,
  managedBucket: string,
  legacyManaged = false,
): { bucket: string; identity: string } {
  const bucket = objectStorageBackupSourceBucket(
    sourceCode,
    sourceLocation,
    environment,
    managedBucket,
    legacyManaged,
  );
  const configured =
    environment.BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON?.[normalizeSourceCode(sourceCode)];
  const endpoint = configured?.endpoint ?? environment.S3_ENDPOINT;
  const region = configured?.region ?? environment.S3_REGION;
  if (!endpoint || !region) throw new Error('BACKUP_OBJECT_STORAGE_SOURCE_NOT_CONFIGURED');
  let normalizedEndpoint: string;
  try {
    normalizedEndpoint = new URL(endpoint).toString();
  } catch {
    throw new Error('BACKUP_OBJECT_STORAGE_SOURCE_NOT_CONFIGURED');
  }
  return {
    bucket,
    identity: createHash('sha256')
      .update(JSON.stringify([normalizedEndpoint, region, bucket]))
      .digest('hex'),
  };
}

export class S3ObjectStorageBackupSource implements ObjectStorageBackupSource {
  private readonly client: S3Client;

  constructor(
    private readonly config: BackupObjectStorageSourceConfig,
    client?: S3Client,
  ) {
    this.client =
      client ??
      new S3Client({
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle,
        region: config.region,
      });
  }

  bucketName(): string {
    return this.config.bucket;
  }

  async listFileObjects(): Promise<Array<{ etag?: string; key: string; size: number }>> {
    const objects: Array<{ etag?: string; key: string; size: number }> = [];
    let continuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        }),
        { abortSignal: AbortSignal.timeout(sourceRequestTimeoutMs) },
      );
      for (const object of page.Contents ?? []) {
        if (!object.Key || object.Size === undefined) continue;
        objects.push({
          ...(object.ETag ? { etag: object.ETag } : {}),
          key: object.Key,
          size: object.Size,
        });
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      if (page.IsTruncated && !continuationToken) {
        throw new Error('BACKUP_OBJECT_SOURCE_LIST_INCOMPLETE');
      }
    } while (continuationToken);
    return objects;
  }

  async describeFileObject(key: string) {
    const object = await this.client.send(
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(sourceRequestTimeoutMs) },
    );
    if (object.ContentLength === undefined) {
      throw new Error('BACKUP_OBJECT_SOURCE_DESCRIPTION_INCOMPLETE');
    }
    return {
      ...(object.CacheControl ? { cacheControl: object.CacheControl } : {}),
      ...(object.ContentDisposition ? { contentDisposition: object.ContentDisposition } : {}),
      ...(object.ContentEncoding ? { contentEncoding: object.ContentEncoding } : {}),
      ...(object.ContentLanguage ? { contentLanguage: object.ContentLanguage } : {}),
      ...(object.ContentType ? { contentType: object.ContentType } : {}),
      ...(object.ETag ? { etag: object.ETag } : {}),
      ...(object.Expires ? { expires: object.Expires } : {}),
      ...(object.Metadata ? { metadata: object.Metadata } : {}),
      size: object.ContentLength,
    };
  }

  async getFileObjectStream(key: string): Promise<{ body: Readable; etag?: string; size: number }> {
    const object = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(sourceRequestTimeoutMs) },
    );
    if (!object.Body || object.ContentLength === undefined) {
      throw new Error('BACKUP_OBJECT_SOURCE_READ_INCOMPLETE');
    }
    return {
      body: object.Body as Readable,
      ...(object.ETag ? { etag: object.ETag } : {}),
      size: object.ContentLength,
    };
  }

  close(): void {
    this.client.destroy();
  }
}

function normalizeSourceCode(sourceCode: string | null): string {
  const normalized = sourceCode?.trim().toUpperCase();
  if (!normalized) throw new Error('BACKUP_OBJECT_STORAGE_SOURCE_CODE_MISSING');
  return normalized;
}

function assertConfiguredBucketMatches(
  sourceLocation: string | null,
  configuredBucket: string,
): void {
  if (sourceLocation?.trim() !== configuredBucket) {
    throw new Error('BACKUP_OBJECT_STORAGE_SOURCE_BUCKET_MISMATCH');
  }
}
