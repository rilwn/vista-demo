import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import type { AppEnvironment } from '@vista/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ObjectStorageService } from './object-storage.service.js';

interface FakeObject {
  body: Buffer;
  metadata: Record<string, string>;
}

interface FakeUpload {
  key: string;
  metadata: Record<string, string>;
  parts: Map<number, Buffer>;
}

interface CommandInput {
  input: Record<string, unknown>;
}

function notFound(): Error & { $metadata: { httpStatusCode: number } } {
  return Object.assign(new Error('not found'), {
    $metadata: { httpStatusCode: 404 },
    name: 'NoSuchKey',
  });
}

function objectKey(bucket: string, key: string): string {
  return `${bucket}/${key}`;
}

function inputString(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== 'string') throw new Error(`Missing string field: ${field}`);
  return value;
}

function environment(): AppEnvironment {
  return {
    BACKUP_REPLICA_REQUIRED: true,
    BACKUP_REPLICA_S3_ACCESS_KEY_ID: 'replica-access',
    BACKUP_REPLICA_S3_BUCKET: 'replica-backups',
    BACKUP_REPLICA_S3_ENDPOINT: 'https://replica.example.invalid',
    BACKUP_REPLICA_S3_FORCE_PATH_STYLE: true,
    BACKUP_REPLICA_S3_REGION: 'eu-central-1',
    BACKUP_REPLICA_S3_SECRET_ACCESS_KEY: 'replica-secret',
    BACKUP_REPLICA_TARGET_CODE: 'backup-vault-eu',
    BACKUP_S3_BUCKET: 'primary-backups',
    DEPENDENCY_HEALTH_TIMEOUT_MS: 1_000,
    S3_ACCESS_KEY_ID: 'primary-access',
    S3_BUCKET: 'vista-files',
    S3_ENDPOINT: 'https://primary.example.invalid',
    S3_FORCE_PATH_STYLE: true,
    S3_REGION: 'eu-central-1',
    S3_SECRET_ACCESS_KEY: 'primary-secret',
  } as AppEnvironment;
}

describe('ObjectStorageService independent backup copy', () => {
  afterEach(() => vi.restoreAllMocks());

  it('copies encrypted artifact bytes between distinct configured storage buckets and verifies the copy', async () => {
    const objects = new Map<string, FakeObject>();
    const uploads = new Map<string, FakeUpload>();
    const calls: Array<{ bucket: string; command: string }> = [];
    const sourceBody = Buffer.from('encrypted backup data from the primary store');
    const key = 'database/critical/run-01.dump.enc';
    const sha256 = createHash('sha256').update(sourceBody).digest('hex');
    objects.set(objectKey('primary-backups', key), {
      body: sourceBody,
      metadata: { 'vista-sha256': sha256 },
    });

    const fakeSend = (command: {
      input: Record<string, unknown>;
      constructor: { name: string };
    }) => {
      const { input } = command as CommandInput;
      const bucket = inputString(input, 'Bucket');
      const commandName = command.constructor.name;
      calls.push({ bucket, command: commandName });
      const keyValue = inputString(input, 'Key');
      const entryKey = objectKey(bucket, keyValue);

      if (command instanceof HeadObjectCommand) {
        const object = objects.get(entryKey);
        if (!object) throw notFound();
        return Promise.resolve({
          ContentLength: object.body.length,
          Metadata: object.metadata,
        } as never);
      }
      if (command instanceof GetObjectCommand) {
        const object = objects.get(entryKey);
        if (!object) throw notFound();
        return Promise.resolve({
          Body: Readable.from([object.body]),
          ContentLength: object.body.length,
        } as never);
      }
      if (command instanceof CreateMultipartUploadCommand) {
        const uploadId = `upload-${uploads.size + 1}`;
        uploads.set(uploadId, {
          key: entryKey,
          metadata: (input['Metadata'] ?? {}) as Record<string, string>,
          parts: new Map(),
        });
        return Promise.resolve({ UploadId: uploadId } as never);
      }
      if (command instanceof UploadPartCommand) {
        const upload = uploads.get(inputString(input, 'UploadId'));
        if (!upload || upload.key !== entryKey) throw new Error('upload not found');
        const partNumber = Number(input['PartNumber']);
        upload.parts.set(partNumber, Buffer.from(input['Body'] as Buffer));
        return Promise.resolve({ ETag: `etag-${partNumber}` } as never);
      }
      if (command instanceof CompleteMultipartUploadCommand) {
        const uploadId = inputString(input, 'UploadId');
        const upload = uploads.get(uploadId);
        if (!upload || upload.key !== entryKey) throw new Error('upload not found');
        const body = Buffer.concat(
          [...upload.parts.entries()]
            .sort(([left], [right]) => left - right)
            .map(([, part]) => part),
        );
        objects.set(entryKey, { body, metadata: upload.metadata });
        uploads.delete(uploadId);
        return Promise.resolve({} as never);
      }
      if (command instanceof AbortMultipartUploadCommand) {
        uploads.delete(inputString(input, 'UploadId'));
        return Promise.resolve({} as never);
      }
      if (command instanceof DeleteObjectCommand) {
        objects.delete(entryKey);
        return Promise.resolve({} as never);
      }
      throw new Error(`Unexpected S3 command: ${commandName}`);
    };
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(fakeSend as never);

    const storage = new ObjectStorageService(environment());
    try {
      expect(storage.independentCopyConfigured()).toBe(true);
      expect(storage.independentCopyTargetCode()).toBe('backup-vault-eu');
      await storage.copyBackupObjectToIndependentStore({
        expectedSha256: sha256,
        expectedSizeBytes: sourceBody.length,
        key,
      });

      expect(objects.get(objectKey('replica-backups', key))).toEqual({
        body: sourceBody,
        metadata: {
          'vista-backup-format': 'aes-256-gcm-v1',
          'vista-sha256': sha256,
        },
      });
      expect(
        calls.some(
          ({ bucket, command }) => bucket === 'primary-backups' && command === 'GetObjectCommand',
        ),
      ).toBe(true);
      expect(
        calls.some(
          ({ bucket, command }) =>
            bucket === 'replica-backups' && command === 'CompleteMultipartUploadCommand',
        ),
      ).toBe(true);
      expect(
        calls.filter(
          ({ bucket, command }) => bucket === 'replica-backups' && command === 'GetObjectCommand',
        ),
      ).toHaveLength(1);
      expect(uploads.size).toBe(0);
    } finally {
      storage.onApplicationShutdown();
    }
  });

  it('falls back to the verified independent object only when the primary object is missing', async () => {
    const replicaBytes = Buffer.from('verified independent copy');
    const calls: string[] = [];
    const fakeSend = (command: {
      input: Record<string, unknown>;
      constructor: { name: string };
    }) => {
      const { input } = command as CommandInput;
      calls.push(inputString(input, 'Bucket'));
      if (command instanceof GetObjectCommand) {
        if (input['Bucket'] === 'primary-backups') throw notFound();
        return Promise.resolve({ Body: Readable.from([replicaBytes]) } as never);
      }
      throw new Error(`Unexpected S3 command: ${command.constructor.name}`);
    };
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(fakeSend as never);

    const storage = new ObjectStorageService(environment());
    try {
      const stream = await storage.getBackupObjectStream('database/critical/run-02.dump.enc');
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));

      expect(Buffer.concat(chunks)).toEqual(replicaBytes);
      expect(calls).toEqual(['primary-backups', 'replica-backups']);
    } finally {
      storage.onApplicationShutdown();
    }
  });
});
