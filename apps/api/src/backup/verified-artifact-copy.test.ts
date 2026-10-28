import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { copyVerifiedBackupArtifact, type BackupArtifactStore } from './verified-artifact-copy.js';

class MemoryArtifactStore implements BackupArtifactStore {
  readonly objects = new Map<string, { body: Buffer; sha256?: string }>();
  readonly uploads = new Map<string, { chunks: Buffer[]; key: string }>();
  private nextUpload = 0;

  abortUpload(input: { uploadId: string }): Promise<void> {
    this.uploads.delete(input.uploadId);
    return Promise.resolve();
  }

  completeUpload(input: { key: string; uploadId: string }): Promise<void> {
    const upload = this.uploads.get(input.uploadId);
    if (!upload || upload.key !== input.key) throw new Error('missing upload');
    const body = Buffer.concat(upload.chunks);
    this.objects.set(input.key, { body, sha256: createHash('sha256').update(body).digest('hex') });
    this.uploads.delete(input.uploadId);
    return Promise.resolve();
  }

  createUpload(input: { key: string; sha256: string }): Promise<string> {
    const id = `upload-${++this.nextUpload}`;
    this.uploads.set(id, { chunks: [], key: input.key });
    (this.uploads.get(id) as { sha256?: string }).sha256 = input.sha256;
    return Promise.resolve(id);
  }

  describe(key: string): Promise<{ sha256?: string; size: number } | undefined> {
    const object = this.objects.get(key);
    return Promise.resolve(
      object
        ? { ...(object.sha256 ? { sha256: object.sha256 } : {}), size: object.body.length }
        : undefined,
    );
  }

  open(key: string): Promise<Readable> {
    const object = this.objects.get(key);
    if (!object) throw new Error('missing object');
    return Promise.resolve(Readable.from([object.body]));
  }

  uploadPart(input: {
    body: Buffer;
    key: string;
    uploadId: string;
    partNumber: number;
  }): Promise<string> {
    const upload = this.uploads.get(input.uploadId);
    if (!upload || upload.key !== input.key) throw new Error('missing upload');
    upload.chunks[input.partNumber - 1] = Buffer.from(input.body);
    return Promise.resolve(`part-${input.partNumber}`);
  }
}

describe('copyVerifiedBackupArtifact', () => {
  it('copies, checks, and safely replays an encrypted artifact into the independent store', async () => {
    const source = new MemoryArtifactStore();
    const destination = new MemoryArtifactStore();
    const body = Buffer.from('encrypted backup artifact bytes');
    const sha256 = createHash('sha256').update(body).digest('hex');
    source.objects.set('database/LOCAL/one.dump.enc', { body, sha256 });

    const input = {
      destination,
      expectedSha256: sha256,
      expectedSizeBytes: body.length,
      key: 'database/LOCAL/one.dump.enc',
      source,
    };
    await copyVerifiedBackupArtifact(input);
    await copyVerifiedBackupArtifact(input);

    expect(destination.objects.get(input.key)?.body).toEqual(body);
    expect(destination.uploads.size).toBe(0);
  });

  it('aborts an incomplete upload when the source differs from the recorded backup checksum', async () => {
    const source = new MemoryArtifactStore();
    const destination = new MemoryArtifactStore();
    const body = Buffer.from('changed source');
    source.objects.set('backup.enc', { body });

    await expect(
      copyVerifiedBackupArtifact({
        destination,
        expectedSha256: 'a'.repeat(64),
        expectedSizeBytes: body.length,
        key: 'backup.enc',
        source,
      }),
    ).rejects.toThrow('BACKUP_REPLICA_SOURCE_CHECKSUM_MISMATCH');
    expect(destination.uploads.size).toBe(0);
    expect(destination.objects.has('backup.enc')).toBe(false);
  });

  it('refuses to overwrite a conflicting object already in the independent store', async () => {
    const source = new MemoryArtifactStore();
    const destination = new MemoryArtifactStore();
    const body = Buffer.from('correct');
    const hash = createHash('sha256').update(body).digest('hex');
    destination.objects.set('backup.enc', { body: Buffer.from('different'), sha256: hash });

    await expect(
      copyVerifiedBackupArtifact({
        destination,
        expectedSha256: hash,
        expectedSizeBytes: body.length,
        key: 'backup.enc',
        source,
      }),
    ).rejects.toThrow('BACKUP_REPLICA_OBJECT_CONFLICT');
  });
});
