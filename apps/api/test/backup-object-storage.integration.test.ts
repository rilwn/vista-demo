import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';

import { ObjectStorageBackupArchive } from '../src/backup/object-storage-backup-archive.js';
import { S3ObjectStorageBackupSource } from '../src/backup/object-storage-backup-source.js';
import type { ObjectStorageService } from '../src/storage/object-storage.service.js';

const runStorageTests = process.env['RUN_OBJECT_STORAGE_TESTS'] === 'true';

describe.skipIf(!runStorageTests)('S3-compatible backup source', () => {
  it('reads and verifies a real local S3 bucket and restores its files in isolation', async () => {
    const endpoint = process.env['S3_ENDPOINT'];
    const accessKeyId = process.env['S3_ACCESS_KEY_ID'];
    const secretAccessKey = process.env['S3_SECRET_ACCESS_KEY'];
    const region = process.env['S3_REGION'] || 'us-east-1';
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error('Local S3 test configuration is incomplete');
    }
    const url = new URL(endpoint);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('The object-storage integration test requires a loopback endpoint');
    }
    const bucket = `vista-backup-test-${randomUUID().replaceAll('-', '')}`;
    if (!/^vista-backup-test-[a-f0-9]{32}$/u.test(bucket)) {
      throw new Error('Refusing to use an unexpected test bucket');
    }
    const config = {
      accessKeyId,
      bucket,
      endpoint,
      forcePathStyle: true,
      region,
      secretAccessKey,
    };
    const client = new S3Client({
      credentials: { accessKeyId, secretAccessKey },
      endpoint,
      forcePathStyle: true,
      region,
    });
    let created = false;
    try {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
        throw new Error('The generated test bucket already exists');
      } catch (error) {
        const response = error as { $metadata?: { httpStatusCode?: number } };
        if (response.$metadata?.httpStatusCode !== 404) throw error;
      }
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      created = true;
      await client.send(
        new PutObjectCommand({
          Body: Buffer.from('Vista test document'),
          Bucket: bucket,
          ContentType: 'text/plain',
          Key: 'documents/example.txt',
          Metadata: { source: 'integration-test' },
        }),
      );
      await client.send(
        new PutObjectCommand({ Body: Buffer.alloc(0), Bucket: bucket, Key: 'empty.txt' }),
      );

      const source = new S3ObjectStorageBackupSource(config);
      let bytes: Buffer;
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of new ObjectStorageBackupArchive().open(source)) {
          chunks.push(Buffer.from(chunk));
        }
        bytes = Buffer.concat(chunks);
      } finally {
        source.close();
      }
      const archive = new ObjectStorageBackupArchive();
      const manifest = await archive.validate(Readable.from([bytes]), bucket);
      expect(manifest.objects.map(({ key }) => key)).toEqual([
        'documents/example.txt',
        'empty.txt',
      ]);
      const restored = new Map<string, Buffer>();
      const target = {
        putRestoredFileObject: vi.fn(async (input: { body: Readable; key: string }) => {
          const chunks: Buffer[] = [];
          for await (const chunk of input.body) chunks.push(Buffer.from(chunk));
          restored.set(input.key, Buffer.concat(chunks));
        }),
      } as unknown as ObjectStorageService;
      const prefix = 'restores/7a2ec5d06b0149c7ae112137281df13c/attempt-1/';
      await archive.restore(Readable.from([bytes]), bucket, target, prefix);
      expect(restored.get(`${prefix}documents/example.txt`)).toEqual(
        Buffer.from('Vista test document'),
      );
      expect(restored.get(`${prefix}empty.txt`)).toEqual(Buffer.alloc(0));
    } finally {
      try {
        if (created) await removeTestBucket(client, bucket);
      } finally {
        client.destroy();
      }
    }
  }, 30_000);
});

async function removeTestBucket(client: S3Client, bucket: string): Promise<void> {
  if (!/^vista-backup-test-[a-f0-9]{32}$/u.test(bucket)) {
    throw new Error('Refusing to clean an unexpected test bucket');
  }
  const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
  const allowedKeys = new Set(['documents/example.txt', 'empty.txt']);
  const keys = (listed.Contents ?? []).map((entry) => entry.Key);
  if (listed.IsTruncated || keys.some((key) => !key || !allowedKeys.has(key))) {
    throw new Error('Refusing to clean an unexpected object-storage test bucket');
  }
  for (const key of keys) {
    if (!key) throw new Error('Refusing to remove an unnamed test object');
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
  await client.send(new DeleteBucketCommand({ Bucket: bucket }));
}
