import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import { Readable } from 'node:stream';

import { copyVerifiedBackupArtifact } from '../backup/verified-artifact-copy.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';

@Injectable()
export class ObjectStorageService implements OnApplicationShutdown {
  private readonly bucket: string;
  private readonly backupBucket: string;
  private readonly independentBucket: string;
  private readonly independentClient: S3Client | undefined;
  private readonly independentCopyRequired: boolean;
  private readonly independentTargetCode: string;
  private readonly client: S3Client;
  private readonly timeoutMs: number;

  constructor(@Inject(APP_ENVIRONMENT) environment: AppEnvironment) {
    this.bucket = environment.S3_BUCKET;
    this.backupBucket = environment.BACKUP_S3_BUCKET;
    this.independentBucket = environment.BACKUP_REPLICA_S3_BUCKET;
    this.independentCopyRequired = environment.BACKUP_REPLICA_REQUIRED;
    this.independentTargetCode = environment.BACKUP_REPLICA_TARGET_CODE;
    this.timeoutMs = environment.DEPENDENCY_HEALTH_TIMEOUT_MS;
    this.client = new S3Client({
      credentials: {
        accessKeyId: environment.S3_ACCESS_KEY_ID,
        secretAccessKey: environment.S3_SECRET_ACCESS_KEY,
      },
      endpoint: environment.S3_ENDPOINT,
      forcePathStyle: environment.S3_FORCE_PATH_STYLE,
      region: environment.S3_REGION,
    });
    this.independentClient = environment.BACKUP_REPLICA_S3_ENDPOINT
      ? new S3Client({
          credentials: {
            accessKeyId: environment.BACKUP_REPLICA_S3_ACCESS_KEY_ID,
            secretAccessKey: environment.BACKUP_REPLICA_S3_SECRET_ACCESS_KEY,
          },
          endpoint: environment.BACKUP_REPLICA_S3_ENDPOINT,
          forcePathStyle: environment.BACKUP_REPLICA_S3_FORCE_PATH_STYLE,
          region: environment.BACKUP_REPLICA_S3_REGION,
        })
      : undefined;
  }

  async ping(): Promise<number> {
    const startedAt = performance.now();
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }), {
      abortSignal: AbortSignal.timeout(this.timeoutMs),
    });
    return Math.round(performance.now() - startedAt);
  }

  async putObject(input: {
    body: Buffer;
    checksumSha256: string;
    key: string;
    mediaType: string;
  }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Body: input.body,
        Bucket: this.bucket,
        ContentLength: input.body.length,
        ContentType: input.mediaType,
        Key: input.key,
        Metadata: { 'vista-sha256': input.checksumSha256 },
      }),
    );
  }

  async getObject(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new Error('Object storage returned an empty response body');
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deleteBackupObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.backupBucket, Key: key }));
    if (this.independentClient) {
      await this.independentClient.send(
        new DeleteObjectCommand({ Bucket: this.independentBucket, Key: key }),
      );
    }
  }

  async createBackupUpload(key: string): Promise<string> {
    const result = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.backupBucket,
        ContentType: 'application/vnd.vista.encrypted-backup',
        Key: key,
        Metadata: { 'vista-backup-format': 'aes-256-gcm-v1' },
      }),
    );
    if (!result.UploadId) throw new Error('Backup storage did not create an upload session');
    return result.UploadId;
  }

  async uploadBackupPart(input: {
    body: Buffer;
    key: string;
    partNumber: number;
    uploadId: string;
  }): Promise<string> {
    const result = await this.client.send(
      new UploadPartCommand({
        Body: input.body,
        Bucket: this.backupBucket,
        Key: input.key,
        PartNumber: input.partNumber,
        UploadId: input.uploadId,
      }),
    );
    if (!result.ETag) throw new Error('Backup storage did not confirm an uploaded part');
    return result.ETag;
  }

  async completeBackupUpload(input: {
    key: string;
    parts: Array<{ ETag: string; PartNumber: number }>;
    uploadId: string;
  }): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.backupBucket,
        Key: input.key,
        MultipartUpload: { Parts: input.parts },
        UploadId: input.uploadId,
      }),
    );
  }

  async abortBackupUpload(input: { key: string; uploadId: string }): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.backupBucket,
        Key: input.key,
        UploadId: input.uploadId,
      }),
    );
  }

  async getBackupObjectStream(key: string): Promise<Readable> {
    try {
      return await this.getPrimaryBackupObjectStream(key);
    } catch (error) {
      if (!this.independentClient || !isObjectNotFound(error)) throw error;
      return this.readBackupObjectStream(this.independentClient, this.independentBucket, key);
    }
  }

  async getPrimaryBackupObjectStream(key: string): Promise<Readable> {
    return this.readBackupObjectStream(this.client, this.backupBucket, key);
  }

  async copyBackupObjectToIndependentStore(input: {
    expectedSha256: string;
    expectedSizeBytes: number;
    key: string;
  }): Promise<void> {
    if (!this.independentClient) {
      if (this.independentCopyRequired) throw new Error('BACKUP_REPLICA_NOT_CONFIGURED');
      return;
    }
    await copyVerifiedBackupArtifact({
      destination: this.artifactStore(this.independentClient, this.independentBucket),
      expectedSha256: input.expectedSha256,
      expectedSizeBytes: input.expectedSizeBytes,
      key: input.key,
      source: this.artifactStore(this.client, this.backupBucket),
    });
  }

  independentCopyConfigured(): boolean {
    return this.independentClient !== undefined;
  }

  independentCopyTargetCode(): string {
    return this.independentTargetCode;
  }

  async listFileObjects(): Promise<Array<{ etag?: string; key: string; size: number }>> {
    const objects: Array<{ etag?: string; key: string; size: number }> = [];
    let continuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        }),
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
        throw new Error('File storage returned an incomplete listing cursor');
      }
    } while (continuationToken);
    return objects;
  }

  async describeFileObject(key: string): Promise<{
    cacheControl?: string;
    contentDisposition?: string;
    contentEncoding?: string;
    contentLanguage?: string;
    contentType?: string;
    etag?: string;
    expires?: Date;
    metadata?: Record<string, string>;
    size: number;
  }> {
    const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    if (result.ContentLength === undefined) {
      throw new Error('File storage did not return an object length');
    }
    return {
      ...(result.CacheControl ? { cacheControl: result.CacheControl } : {}),
      ...(result.ContentDisposition ? { contentDisposition: result.ContentDisposition } : {}),
      ...(result.ContentEncoding ? { contentEncoding: result.ContentEncoding } : {}),
      ...(result.ContentLanguage ? { contentLanguage: result.ContentLanguage } : {}),
      ...(result.ContentType ? { contentType: result.ContentType } : {}),
      ...(result.ETag ? { etag: result.ETag } : {}),
      ...(result.Expires ? { expires: result.Expires } : {}),
      ...(result.Metadata ? { metadata: result.Metadata } : {}),
      size: result.ContentLength,
    };
  }

  async getFileObjectStream(key: string): Promise<{
    body: Readable;
    etag?: string;
    size: number;
  }> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body || result.ContentLength === undefined) {
      throw new Error('File storage returned an incomplete object response');
    }
    return {
      body: result.Body as Readable,
      ...(result.ETag ? { etag: result.ETag } : {}),
      size: result.ContentLength,
    };
  }

  async putRestoredFileObject(input: {
    body: Readable;
    cacheControl?: string;
    contentDisposition?: string;
    contentEncoding?: string;
    contentLanguage?: string;
    contentType?: string;
    expires?: Date;
    key: string;
    metadata?: Record<string, string>;
    size: number;
  }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Body: input.body,
        Bucket: this.backupBucket,
        CacheControl: input.cacheControl,
        ContentDisposition: input.contentDisposition,
        ContentEncoding: input.contentEncoding,
        ContentLanguage: input.contentLanguage,
        ContentLength: input.size,
        ContentType: input.contentType,
        Expires: input.expires,
        Key: input.key,
        Metadata: input.metadata,
      }),
    );
  }

  async getRestoredFileObjectStream(key: string): Promise<{ body: Readable; size: number }> {
    if (
      !/^restores\/[a-f0-9]{32}\/attempt-[1-9][0-9]*\/(?!\/).+$/u.test(key) ||
      key.split('/').some((segment) => segment === '.' || segment === '..') ||
      key.includes('\\') ||
      key.includes('\u0000')
    ) {
      throw new Error('BACKUP_RESTORE_OBJECT_KEY_INVALID');
    }
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.backupBucket, Key: key }),
    );
    if (!result.Body || result.ContentLength === undefined) {
      throw new Error('BACKUP_RESTORE_OBJECT_NOT_AVAILABLE');
    }
    return { body: result.Body as Readable, size: result.ContentLength };
  }

  async deleteRestoredFilePrefix(prefix: string): Promise<void> {
    if (!/^restores\/[a-f0-9]{32}\/attempt-[1-9][0-9]*\/$/u.test(prefix)) {
      throw new Error('BACKUP_RESTORE_PREFIX_INVALID');
    }
    let continuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.backupBucket,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
          Prefix: prefix,
        }),
      );
      const keys = (page.Contents ?? []).flatMap((object) =>
        object.Key ? [{ Key: object.Key }] : [],
      );
      if (keys.length) {
        const result = await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.backupBucket,
            Delete: { Objects: keys, Quiet: true },
          }),
        );
        if (result.Errors?.length) throw new Error('BACKUP_RESTORE_CLEANUP_FAILED');
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      if (page.IsTruncated && !continuationToken) {
        throw new Error('Restore storage returned an incomplete listing cursor');
      }
    } while (continuationToken);
  }

  async ensureBackupBucket(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.backupBucket }), {
      abortSignal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  bucketName(): string {
    return this.bucket;
  }

  backupBucketName(): string {
    return this.backupBucket;
  }

  onApplicationShutdown(): void {
    this.client.destroy();
    this.independentClient?.destroy();
  }

  private async readBackupObjectStream(
    client: S3Client,
    bucket: string,
    key: string,
  ): Promise<Readable> {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!result.Body) throw new Error('Backup storage returned an empty response body');
    return result.Body as Readable;
  }

  private artifactStore(client: S3Client, bucket: string) {
    return {
      abortUpload: async (input: { key: string; uploadId: string }) => {
        await client.send(
          new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: input.key,
            UploadId: input.uploadId,
          }),
        );
      },
      completeUpload: async (input: {
        key: string;
        parts: Array<{ eTag: string; partNumber: number }>;
        uploadId: string;
      }) => {
        await client.send(
          new CompleteMultipartUploadCommand({
            Bucket: bucket,
            Key: input.key,
            MultipartUpload: {
              Parts: input.parts.map((part) => ({ ETag: part.eTag, PartNumber: part.partNumber })),
            },
            UploadId: input.uploadId,
          }),
        );
      },
      createUpload: async (input: { key: string; sha256: string }) => {
        const result = await client.send(
          new CreateMultipartUploadCommand({
            Bucket: bucket,
            ContentType: 'application/vnd.vista.encrypted-backup',
            Key: input.key,
            Metadata: { 'vista-backup-format': 'aes-256-gcm-v1', 'vista-sha256': input.sha256 },
          }),
        );
        if (!result.UploadId) throw new Error('Independent backup storage did not start an upload');
        return result.UploadId;
      },
      describe: async (key: string) => {
        try {
          const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
          if (result.ContentLength === undefined) {
            throw new Error('Independent backup storage returned no object size');
          }
          return {
            ...(result.Metadata?.['vista-sha256']
              ? { sha256: result.Metadata['vista-sha256'] }
              : {}),
            size: result.ContentLength,
          };
        } catch (error) {
          if (isObjectNotFound(error)) return undefined;
          throw error;
        }
      },
      open: (key: string) => this.readBackupObjectStream(client, bucket, key),
      uploadPart: async (input: {
        body: Buffer;
        key: string;
        partNumber: number;
        uploadId: string;
      }) => {
        const result = await client.send(
          new UploadPartCommand({
            Body: input.body,
            Bucket: bucket,
            Key: input.key,
            PartNumber: input.partNumber,
            UploadId: input.uploadId,
          }),
        );
        if (!result.ETag) throw new Error('Independent backup storage did not confirm a part');
        return result.ETag;
      },
    };
  }
}

function isObjectNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { $metadata?: { httpStatusCode?: number }; name?: string };
  return (
    candidate.$metadata?.httpStatusCode === 404 ||
    candidate.name === 'NoSuchKey' ||
    candidate.name === 'NotFound'
  );
}
