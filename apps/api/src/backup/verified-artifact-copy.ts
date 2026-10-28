import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

const minimumPartBytes = 8 * 1024 * 1024;
const maximumS3Parts = 10_000;

export interface BackupArtifactStore {
  abortUpload(input: { key: string; uploadId: string }): Promise<void>;
  completeUpload(input: {
    key: string;
    parts: Array<{ eTag: string; partNumber: number }>;
    uploadId: string;
  }): Promise<void>;
  createUpload(input: { key: string; sha256: string }): Promise<string>;
  describe(key: string): Promise<{ sha256?: string; size: number } | undefined>;
  open(key: string): Promise<Readable>;
  uploadPart(input: {
    body: Buffer;
    key: string;
    partNumber: number;
    uploadId: string;
  }): Promise<string>;
}

export async function copyVerifiedBackupArtifact(input: {
  destination: BackupArtifactStore;
  expectedSha256: string;
  expectedSizeBytes: number;
  key: string;
  source: BackupArtifactStore;
}): Promise<void> {
  if (!/^[a-f0-9]{64}$/u.test(input.expectedSha256) || input.expectedSizeBytes <= 0) {
    throw new Error('BACKUP_REPLICA_EXPECTED_CHECKSUM_INVALID');
  }

  const existing = await input.destination.describe(input.key);
  if (existing) {
    if (
      existing.size !== input.expectedSizeBytes ||
      existing.sha256?.toLowerCase() !== input.expectedSha256
    ) {
      throw new Error('BACKUP_REPLICA_OBJECT_CONFLICT');
    }
    await verifyObject(input.destination, input.key, input.expectedSha256, input.expectedSizeBytes);
    return;
  }

  const partBytes = Math.max(
    minimumPartBytes,
    Math.ceil(input.expectedSizeBytes / maximumS3Parts / (1024 * 1024)) * 1024 * 1024,
  );
  const source = await input.source.open(input.key);
  let uploadId: string | undefined;
  let completed = false;
  let partNumber = 0;
  let bytesCopied = 0;
  let buffer: Buffer = Buffer.alloc(0);
  const hash = createHash('sha256');
  const parts: Array<{ eTag: string; partNumber: number }> = [];

  try {
    uploadId = await input.destination.createUpload({
      key: input.key,
      sha256: input.expectedSha256,
    });
    for await (const value of source) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
      hash.update(chunk);
      bytesCopied += chunk.length;
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      while (buffer.length >= partBytes) {
        partNumber += 1;
        if (partNumber > maximumS3Parts) throw new Error('BACKUP_REPLICA_PART_LIMIT_EXCEEDED');
        const body = buffer.subarray(0, partBytes);
        buffer = buffer.subarray(partBytes);
        parts.push({
          eTag: await input.destination.uploadPart({
            body,
            key: input.key,
            partNumber,
            uploadId,
          }),
          partNumber,
        });
      }
    }
    if (buffer.length) {
      partNumber += 1;
      parts.push({
        eTag: await input.destination.uploadPart({
          body: buffer,
          key: input.key,
          partNumber,
          uploadId,
        }),
        partNumber,
      });
    }
    if (bytesCopied !== input.expectedSizeBytes || hash.digest('hex') !== input.expectedSha256) {
      throw new Error('BACKUP_REPLICA_SOURCE_CHECKSUM_MISMATCH');
    }
    await input.destination.completeUpload({ key: input.key, parts, uploadId });
    completed = true;
    const stored = await input.destination.describe(input.key);
    if (
      !stored ||
      stored.size !== input.expectedSizeBytes ||
      stored.sha256?.toLowerCase() !== input.expectedSha256
    ) {
      throw new Error('BACKUP_REPLICA_STORED_CHECKSUM_MISMATCH');
    }
    await verifyObject(input.destination, input.key, input.expectedSha256, input.expectedSizeBytes);
  } catch (error) {
    source.destroy();
    if (uploadId && !completed) {
      await input.destination.abortUpload({ key: input.key, uploadId }).catch(() => undefined);
    }
    throw error;
  }
}

async function verifyObject(
  store: BackupArtifactStore,
  key: string,
  expectedSha256: string,
  expectedSizeBytes: number,
): Promise<void> {
  const hash = createHash('sha256');
  let size = 0;
  for await (const value of await store.open(key)) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    size += chunk.length;
    hash.update(chunk);
  }
  if (size !== expectedSizeBytes || hash.digest('hex') !== expectedSha256) {
    throw new Error('BACKUP_REPLICA_STORED_CHECKSUM_MISMATCH');
  }
}
