import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import type { ObjectStorageService } from '../storage/object-storage.service.js';
import { ObjectStorageBackupArchive } from './object-storage-backup-archive.js';

describe('ObjectStorageBackupArchive', () => {
  it('archives, verifies, and restores object contents and metadata into an isolated prefix', async () => {
    const files = new Map([
      [
        'documents/contract-α.pdf',
        {
          contentType: 'application/pdf',
          etag: '"contract-v1"',
          metadata: { 'parent-record': 'partner-17' },
          value: Buffer.from('%PDF-contract'),
        },
      ],
      ['empty.bin', { etag: '"empty-v1"', value: Buffer.alloc(0) }],
    ]);
    const restored = new Map<string, { metadata?: Record<string, string>; value: Buffer }>();
    const storage = {
      bucketName: () => 'vista-files',
      describeFileObject: vi.fn((key: string) => {
        const file = files.get(key);
        if (!file) throw new Error('NoSuchKey');
        return {
          ...(file.contentType ? { contentType: file.contentType } : {}),
          etag: file.etag,
          ...(file.metadata ? { metadata: file.metadata } : {}),
          size: file.value.length,
        };
      }),
      getFileObjectStream: vi.fn((key: string) => {
        const file = files.get(key);
        if (!file) throw new Error('NoSuchKey');
        return { body: Readable.from([file.value]), etag: file.etag, size: file.value.length };
      }),
      listFileObjects: vi.fn(() =>
        [...files].map(([key, file]) => ({ etag: file.etag, key, size: file.value.length })),
      ),
      putRestoredFileObject: vi.fn(
        async (input: { body: Readable; key: string; metadata?: Record<string, string> }) => {
          const chunks: Buffer[] = [];
          for await (const chunk of input.body) chunks.push(Buffer.from(chunk));
          restored.set(input.key, {
            ...(input.metadata ? { metadata: input.metadata } : {}),
            value: Buffer.concat(chunks),
          });
        },
      ),
    } as unknown as ObjectStorageService;
    const archive = new ObjectStorageBackupArchive();
    const archiveChunks: Buffer[] = [];
    for await (const chunk of archive.open(storage)) archiveChunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(archiveChunks);

    const manifest = await archive.validate(Readable.from([bytes]), 'vista-files');
    expect(manifest.objects.map(({ key }) => key)).toEqual([
      'documents/contract-α.pdf',
      'empty.bin',
    ]);

    const targetPrefix = 'restores/7a2ec5d06b0149c7ae112137281df13c/attempt-1/';
    await archive.restore(Readable.from([bytes]), 'vista-files', storage, targetPrefix);
    expect(restored.get(`${targetPrefix}documents/contract-α.pdf`)).toEqual({
      metadata: { 'parent-record': 'partner-17' },
      value: Buffer.from('%PDF-contract'),
    });
    expect(restored.get(`${targetPrefix}empty.bin`)?.value).toEqual(Buffer.alloc(0));
    expect(files.get('documents/contract-α.pdf')?.value).toEqual(Buffer.from('%PDF-contract'));
  });

  it.each(['vista-object-store-backup-v1', 'vista-object-store-backup-v2'] as const)(
    'continues to validate and restore legacy %s archives',
    async (format) => {
      const content = Buffer.from('legacy archive content');
      const legacyObject = {
        key: 'legacy/manual.txt',
        size: content.length,
        ...(format === 'vista-object-store-backup-v2'
          ? {
              contentIncluded: true,
              etag: 'legacy-v1',
              sha256: createHash('sha256').update(content).digest('hex'),
            }
          : {}),
      };
      const manifest = {
        ...(format === 'vista-object-store-backup-v2'
          ? { backupType: 'full', deletedKeys: [] }
          : {}),
        createdAt: '2026-10-28T00:00:00.000Z',
        format,
        objects: [legacyObject],
        sourceBucket: 'vista-files',
      };
      const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
      const prefix = Buffer.alloc(Buffer.byteLength('VISTAOBJBAK1') + 4);
      prefix.write('VISTAOBJBAK1', 0, 'ascii');
      prefix.writeUInt32BE(manifestBytes.length, Buffer.byteLength('VISTAOBJBAK1'));
      const sizeHeader = Buffer.alloc(8);
      sizeHeader.writeBigUInt64BE(BigInt(content.length));
      const legacyBytes = Buffer.concat([prefix, manifestBytes, sizeHeader, content]);
      const archive = new ObjectStorageBackupArchive();
      const restored = new Map<string, Buffer>();
      const storage = {
        putRestoredFileObject: vi.fn(async (input: { body: Readable; key: string }) => {
          const chunks: Buffer[] = [];
          for await (const chunk of input.body) chunks.push(Buffer.from(chunk));
          restored.set(input.key, Buffer.concat(chunks));
        }),
      } as unknown as ObjectStorageService;

      const parsed = await archive.validate(Readable.from([legacyBytes]), 'vista-files');
      expect(parsed.format).toBe(format);
      await archive.restore(
        Readable.from([legacyBytes]),
        'vista-files',
        storage,
        'restores/7a2ec5d06b0149c7ae112137281df13c/attempt-8/',
      );
      expect(
        restored.get('restores/7a2ec5d06b0149c7ae112137281df13c/attempt-8/legacy/manual.txt'),
      ).toEqual(content);
    },
  );

  it('rejects source mutation, truncation, wrong bucket, and trailing bytes', async () => {
    const file = { etag: '"before"', value: Buffer.from('safe') };
    let listCall = 0;
    const storage = {
      bucketName: () => 'vista-files',
      describeFileObject: vi.fn(() => ({ etag: file.etag, size: file.value.length })),
      getFileObjectStream: vi.fn(() => ({
        body: Readable.from([file.value]),
        etag: file.etag,
        size: file.value.length,
      })),
      listFileObjects: vi.fn(() => {
        listCall += 1;
        return [{ etag: listCall === 1 ? '"before"' : '"after"', key: 'a.txt', size: 4 }];
      }),
    } as unknown as ObjectStorageService;
    const archive = new ObjectStorageBackupArchive();
    await expect(drain(archive.open(storage))).rejects.toThrow('BACKUP_SOURCE_CHANGED_DURING_SCAN');

    const stableStorage = {
      ...storage,
      listFileObjects: vi.fn(() => [{ etag: '"before"', key: 'a.txt', size: 4 }]),
    } as unknown as ObjectStorageService;
    const chunks: Buffer[] = [];
    for await (const chunk of archive.open(stableStorage)) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    await expect(
      archive.validate(Readable.from([bytes.subarray(0, bytes.length - 1)]), 'vista-files'),
    ).rejects.toThrow('BACKUP_OBJECT_ARCHIVE_TRUNCATED');
    await expect(archive.validate(Readable.from([bytes]), 'different-bucket')).rejects.toThrow(
      'BACKUP_OBJECT_MANIFEST_INVALID',
    );
    await expect(
      archive.validate(
        Readable.from([Buffer.concat([bytes, Buffer.from('extra')])]),
        'vista-files',
      ),
    ).rejects.toThrow('BACKUP_OBJECT_ARCHIVE_TRAILING_DATA');
  });

  it('fails the archive if the file store changes while the object bodies are streamed', async () => {
    const file = { etag: '"before"', value: Buffer.from('safe') };
    let listCall = 0;
    const storage = {
      bucketName: () => 'vista-files',
      describeFileObject: vi.fn(() => ({ etag: '"before"', size: 4 })),
      getFileObjectStream: vi.fn(() => {
        const etag = file.etag;
        file.etag = '"after"';
        return { body: Readable.from([file.value]), etag, size: file.value.length };
      }),
      listFileObjects: vi.fn(() => {
        listCall += 1;
        return [{ etag: listCall <= 2 ? '"before"' : file.etag, key: 'a.txt', size: 4 }];
      }),
    } as unknown as ObjectStorageService;
    const archive = new ObjectStorageBackupArchive();
    await expect(drain(archive.open(storage))).rejects.toThrow('BACKUP_SOURCE_CHANGED_DURING_SCAN');
  });

  it('only writes restore output under the generated isolated namespace', async () => {
    const archive = new ObjectStorageBackupArchive();
    const storage = {} as ObjectStorageService;
    await expect(
      archive.restore(Readable.from([]), 'vista-files', storage, 'documents/live/'),
    ).rejects.toThrow('BACKUP_RESTORE_PREFIX_INVALID');
  });

  it('restores one selected file while preserving the verified archive manifest', async () => {
    const storage = makeStorageWithTwoFiles();
    const archive = new ObjectStorageBackupArchive();
    const bytes: Buffer[] = [];
    for await (const chunk of archive.open(storage)) bytes.push(Buffer.from(chunk));
    const restored = new Map<string, Buffer>();
    const putRestoredFileObject = vi.fn(async (input: { body: Readable; key: string }) => {
      const chunks: Buffer[] = [];
      for await (const chunk of input.body) chunks.push(Buffer.from(chunk));
      restored.set(input.key, Buffer.concat(chunks));
    });
    const target = { ...storage, putRestoredFileObject } as unknown as ObjectStorageService;
    const targetPrefix = 'restores/7a2ec5d06b0149c7ae112137281df13c/attempt-2/';

    const manifest = await archive.restore(
      Readable.from([Buffer.concat(bytes)]),
      'vista-files',
      target,
      targetPrefix,
      'documents/one.pdf',
    );

    expect(manifest.objects).toHaveLength(2);
    expect([...restored.keys()]).toEqual([`${targetPrefix}documents/one.pdf`]);
    expect(restored.get(`${targetPrefix}documents/one.pdf`)).toEqual(Buffer.from('one'));
  });

  it('deduplicates identical payloads within an archive and restores each object key', async () => {
    const sharedBody = Buffer.from('same verified contents');
    const files = new Map([
      ['documents/first.txt', { etag: 'first-version', value: sharedBody }],
      ['documents/second.txt', { etag: 'second-version', value: Buffer.from(sharedBody) }],
    ]);
    const storage = {
      bucketName: () => 'vista-files',
      describeFileObject: vi.fn((key: string) => {
        const file = files.get(key);
        if (!file) throw new Error('NoSuchKey');
        return { etag: file.etag, size: file.value.length };
      }),
      getFileObjectStream: vi.fn((key: string) => {
        const file = files.get(key);
        if (!file) throw new Error('NoSuchKey');
        return { body: Readable.from([file.value]), etag: file.etag, size: file.value.length };
      }),
      listFileObjects: vi.fn(() =>
        [...files].map(([key, file]) => ({ etag: file.etag, key, size: file.value.length })),
      ),
    } as unknown as ObjectStorageService;
    const archive = new ObjectStorageBackupArchive();
    const bytes = await collect(archive.open(storage));
    const manifest = await archive.validate(Readable.from([bytes]), 'vista-files');
    expect(manifest.objects).toMatchObject([
      { contentIncluded: true, key: 'documents/first.txt' },
      {
        contentIncluded: false,
        contentReference: 'documents/first.txt',
        key: 'documents/second.txt',
      },
    ]);

    const restored = new Map<string, Buffer>();
    const putRestoredFileObject = vi.fn(async (input: { body: Readable; key: string }) => {
      const chunks: Buffer[] = [];
      for await (const chunk of input.body) chunks.push(Buffer.from(chunk));
      restored.set(input.key, Buffer.concat(chunks));
    });
    const target = { ...storage, putRestoredFileObject } as unknown as ObjectStorageService;
    const targetPrefix = 'restores/7a2ec5d06b0149c7ae112137281df13c/attempt-5/';
    await archive.restore(Readable.from([bytes]), 'vista-files', target, targetPrefix);

    expect([...restored.keys()].sort()).toEqual([
      `${targetPrefix}documents/first.txt`,
      `${targetPrefix}documents/second.txt`,
    ]);
    expect(restored.get(`${targetPrefix}documents/first.txt`)).toEqual(sharedBody);
    expect(restored.get(`${targetPrefix}documents/second.txt`)).toEqual(sharedBody);
    expect(putRestoredFileObject).toHaveBeenCalledTimes(2);
  });

  it('reuses a verified prior-run payload when an object moves to a new key', async () => {
    const payload = Buffer.alloc(64 * 1024, 0x41);
    const files = new Map([
      ['archive/old-key.bin', { etag: 'old-v1', value: payload }],
      ['documents/keep.txt', { etag: 'keep-v1', value: Buffer.from('keep') }],
    ]);
    const storage = {
      bucketName: () => 'vista-files',
      describeFileObject: vi.fn((key: string) => {
        const file = files.get(key);
        if (!file) throw new Error('NoSuchKey');
        return { etag: file.etag, size: file.value.length };
      }),
      getFileObjectStream: vi.fn((key: string) => {
        const file = files.get(key);
        if (!file) throw new Error('NoSuchKey');
        return { body: Readable.from([file.value]), etag: file.etag, size: file.value.length };
      }),
      listFileObjects: vi.fn(() =>
        [...files].map(([key, file]) => ({ etag: file.etag, key, size: file.value.length })),
      ),
    } as unknown as ObjectStorageService;
    const archive = new ObjectStorageBackupArchive();
    const fullBytes = await collect(archive.open(storage));
    const fullManifest = await archive.validate(Readable.from([fullBytes]), 'vista-files');
    files.delete('archive/old-key.bin');
    files.set('archive/new-key.bin', { etag: 'new-v1', value: Buffer.from(payload) });
    const deltaBytes = await collect(
      archive.open(storage, { backupType: 'incremental', baseline: fullManifest }),
    );
    const deltaManifest = await archive.validate(Readable.from([deltaBytes]), 'vista-files');
    expect(deltaManifest.objects.find(({ key }) => key === 'archive/new-key.bin')).toMatchObject({
      contentIncluded: false,
      contentReference: 'archive/old-key.bin',
    });
    expect(deltaManifest.deletedKeys).toEqual(['archive/old-key.bin']);
    expect(deltaBytes.length).toBeLessThan(2_000);

    const staging = await mkdtemp(join(tmpdir(), 'vista-object-cross-run-test-'));
    try {
      const fullPath = join(staging, 'full.archive');
      const deltaPath = join(staging, 'delta.archive');
      await writeFile(fullPath, fullBytes);
      await writeFile(deltaPath, deltaBytes);
      const restored = new Map<string, Buffer>();
      const putRestoredFileObject = vi.fn(async (input: { body: Readable; key: string }) => {
        const chunks: Buffer[] = [];
        for await (const chunk of input.body) chunks.push(Buffer.from(chunk));
        restored.set(input.key, Buffer.concat(chunks));
      });
      const target = {
        ...storage,
        putRestoredFileObject,
      } as unknown as ObjectStorageService;
      const targetPrefix = 'restores/7a2ec5d06b0149c7ae112137281df13c/attempt-6/';
      await archive.restoreChain(
        [fullPath, deltaPath],
        'vista-files',
        target,
        targetPrefix,
        'archive/new-key.bin',
      );
      expect([...restored.keys()]).toEqual([`${targetPrefix}archive/new-key.bin`]);
      expect(restored.get(`${targetPrefix}archive/new-key.bin`)).toEqual(payload);
    } finally {
      await rm(staging, { force: true, recursive: true });
    }
  });

  it('stores only changed blocks in a delta and restores the selected object from its block chain', async () => {
    const blockSize = 4 * 1024 * 1024;
    const original = Buffer.concat([
      Buffer.alloc(blockSize, 0x41),
      Buffer.alloc(blockSize, 0x42),
      Buffer.alloc(blockSize, 0x43),
    ]);
    const edited = Buffer.concat([
      Buffer.alloc(blockSize, 0x41),
      Buffer.alloc(blockSize, 0x44),
      Buffer.alloc(blockSize, 0x43),
    ]);
    const files = new Map([['manuals/large-manual.bin', { etag: 'manual-v1', value: original }]]);
    const storage = {
      bucketName: () => 'vista-files',
      describeFileObject: vi.fn((key: string) => {
        const file = files.get(key);
        if (!file) throw new Error('NoSuchKey');
        return { etag: file.etag, size: file.value.length };
      }),
      getFileObjectStream: vi.fn((key: string) => {
        const file = files.get(key);
        if (!file) throw new Error('NoSuchKey');
        return { body: Readable.from([file.value]), etag: file.etag, size: file.value.length };
      }),
      listFileObjects: vi.fn(() =>
        [...files].map(([key, file]) => ({ etag: file.etag, key, size: file.value.length })),
      ),
    } as unknown as ObjectStorageService;
    const archive = new ObjectStorageBackupArchive();
    const fullBytes = await collect(archive.open(storage));
    const baseline = await archive.validate(Readable.from([fullBytes]), 'vista-files');
    expect(baseline.chunks).toHaveLength(3);
    expect(baseline.chunks?.every(({ contentIncluded }) => contentIncluded)).toBe(true);

    files.set('manuals/large-manual.bin', { etag: 'manual-v2', value: edited });
    const deltaBytes = await collect(
      archive.open(storage, { backupType: 'incremental', baseline }),
    );
    const delta = await archive.validate(Readable.from([deltaBytes]), 'vista-files');
    expect(delta.chunks?.filter(({ contentIncluded }) => contentIncluded)).toHaveLength(1);
    expect(deltaBytes.length).toBeLessThan(blockSize + 20_000);

    const staging = await mkdtemp(join(tmpdir(), 'vista-object-block-dedup-test-'));
    try {
      const fullPath = join(staging, 'full.archive');
      const deltaPath = join(staging, 'delta.archive');
      await writeFile(fullPath, fullBytes);
      await writeFile(deltaPath, deltaBytes);
      const restored = new Map<string, Buffer>();
      const putRestoredFileObject = vi.fn(async (input: { body: Readable; key: string }) => {
        const chunks: Buffer[] = [];
        for await (const chunk of input.body) chunks.push(Buffer.from(chunk));
        restored.set(input.key, Buffer.concat(chunks));
      });
      const target = {
        ...storage,
        putRestoredFileObject,
      } as unknown as ObjectStorageService;
      const prefix = 'restores/7a2ec5d06b0149c7ae112137281df13c/attempt-7/';
      await archive.restoreChain(
        [fullPath, deltaPath],
        'vista-files',
        target,
        prefix,
        'manuals/large-manual.bin',
      );
      expect(restored.get(`${prefix}manuals/large-manual.bin`)?.equals(edited)).toBe(true);
      expect(putRestoredFileObject).toHaveBeenCalledTimes(1);
    } finally {
      await rm(staging, { force: true, recursive: true });
    }
  });

  it('archives object-store deltas and reconstructs a changed snapshot in isolation', async () => {
    const files = new Map([
      ['contracts/current.pdf', { etag: 'contract-v1', value: Buffer.from('contract v1') }],
      ['manuals/keep.txt', { etag: 'manual-v1', value: Buffer.from('unchanged') }],
      ['obsolete/old.txt', { etag: 'old-v1', value: Buffer.from('remove me') }],
    ]);
    const storage = {
      bucketName: () => 'vista-files',
      describeFileObject: vi.fn((key: string) => {
        const file = files.get(key);
        if (!file) throw new Error('NoSuchKey');
        return { etag: file.etag, size: file.value.length };
      }),
      getFileObjectStream: vi.fn((key: string) => {
        const file = files.get(key);
        if (!file) throw new Error('NoSuchKey');
        return { body: Readable.from([file.value]), etag: file.etag, size: file.value.length };
      }),
      listFileObjects: vi.fn(() =>
        [...files].map(([key, file]) => ({ etag: file.etag, key, size: file.value.length })),
      ),
    } as unknown as ObjectStorageService;
    const restored = new Map<string, Buffer>();
    const target = {
      ...storage,
      putRestoredFileObject: vi.fn(async (input: { body: Readable; key: string }) => {
        const chunks: Buffer[] = [];
        for await (const chunk of input.body) chunks.push(Buffer.from(chunk));
        restored.set(input.key, Buffer.concat(chunks));
      }),
    } as unknown as ObjectStorageService;
    const archive = new ObjectStorageBackupArchive();
    const fullBytes = await collect(archive.open(storage));
    const fullManifest = await archive.validate(Readable.from([fullBytes]), 'vista-files');

    files.set('contracts/current.pdf', {
      etag: 'contract-v2',
      value: Buffer.from('contract v2'),
    });
    files.delete('obsolete/old.txt');
    files.set('receipts/new.pdf', { etag: 'new-v1', value: Buffer.from('new object') });
    const deltaBytes = await collect(
      archive.open(storage, { backupType: 'incremental', baseline: fullManifest }),
    );
    const deltaManifest = await archive.validate(Readable.from([deltaBytes]), 'vista-files');
    expect(deltaManifest).toMatchObject({
      backupType: 'incremental',
      format: 'vista-object-store-backup-v3',
    });
    expect(deltaManifest.deletedKeys).toEqual(['obsolete/old.txt']);
    expect(deltaManifest.objects.find(({ key }) => key === 'manuals/keep.txt')).toMatchObject({
      contentIncluded: false,
    });
    expect(deltaManifest.objects.find(({ key }) => key === 'contracts/current.pdf')).toMatchObject({
      contentIncluded: true,
    });

    const staging = await mkdtemp(join(tmpdir(), 'vista-object-archive-test-'));
    try {
      const fullPath = join(staging, 'full.archive');
      const deltaPath = join(staging, 'incremental.archive');
      await writeFile(fullPath, fullBytes);
      await writeFile(deltaPath, deltaBytes);
      const targetPrefix = 'restores/7a2ec5d06b0149c7ae112137281df13c/attempt-3/';
      const restoredManifest = await archive.restoreChain(
        [fullPath, deltaPath],
        'vista-files',
        target,
        targetPrefix,
      );

      expect(restoredManifest.objects.map(({ key }) => key)).toEqual([
        'contracts/current.pdf',
        'manuals/keep.txt',
        'receipts/new.pdf',
      ]);
      expect(restored.get(`${targetPrefix}contracts/current.pdf`)).toEqual(
        Buffer.from('contract v2'),
      );
      expect(restored.get(`${targetPrefix}manuals/keep.txt`)).toEqual(Buffer.from('unchanged'));
      expect(restored.get(`${targetPrefix}receipts/new.pdf`)).toEqual(Buffer.from('new object'));
      expect(restored.has(`${targetPrefix}obsolete/old.txt`)).toBe(false);
      expect(files.get('contracts/current.pdf')?.value).toEqual(Buffer.from('contract v2'));

      files.set('contracts/current.pdf', {
        etag: 'contract-v1',
        value: Buffer.from('contract v1'),
      });
      const differentialBytes = await collect(
        archive.open(storage, { backupType: 'differential', baseline: fullManifest }),
      );
      const differentialManifest = await archive.validate(
        Readable.from([differentialBytes]),
        'vista-files',
      );
      expect(differentialManifest.backupType).toBe('differential');
      expect(
        differentialManifest.objects.find(({ key }) => key === 'contracts/current.pdf')
          ?.contentIncluded,
      ).toBe(false);
      expect(differentialManifest.deletedKeys).toEqual(['obsolete/old.txt']);

      const differentialPath = join(staging, 'differential.archive');
      await writeFile(differentialPath, differentialBytes);
      const differentialPrefix = 'restores/7a2ec5d06b0149c7ae112137281df13c/attempt-4/';
      await archive.restoreChain(
        [fullPath, differentialPath],
        'vista-files',
        target,
        differentialPrefix,
      );
      expect(restored.get(`${differentialPrefix}contracts/current.pdf`)).toEqual(
        Buffer.from('contract v1'),
      );
      expect(restored.get(`${differentialPrefix}receipts/new.pdf`)).toEqual(
        Buffer.from('new object'),
      );
      expect(restored.has(`${differentialPrefix}obsolete/old.txt`)).toBe(false);
    } finally {
      await rm(staging, { force: true, recursive: true });
    }
  });

  it('rejects a selected file not present in the verified manifest before writing any object', async () => {
    const storage = makeStorageWithTwoFiles();
    const archive = new ObjectStorageBackupArchive();
    const bytes: Buffer[] = [];
    for await (const chunk of archive.open(storage)) bytes.push(Buffer.from(chunk));
    const putRestoredFileObject = vi.fn();
    const target = { ...storage, putRestoredFileObject } as unknown as ObjectStorageService;

    await expect(
      archive.restore(
        Readable.from([Buffer.concat(bytes)]),
        'vista-files',
        target,
        'restores/7a2ec5d06b0149c7ae112137281df13c/attempt-2/',
        'documents/not-in-this-point.pdf',
      ),
    ).rejects.toThrow('BACKUP_OBJECT_NOT_FOUND');
    expect(putRestoredFileObject).not.toHaveBeenCalled();
  });
});

function makeStorageWithTwoFiles(): ObjectStorageService {
  const files = new Map([
    ['documents/one.pdf', Buffer.from('one')],
    ['documents/two.pdf', Buffer.from('two')],
  ]);
  return {
    bucketName: () => 'vista-files',
    describeFileObject: vi.fn((key: string) => {
      const body = files.get(key);
      if (!body) throw new Error('NoSuchKey');
      return { etag: `"${key}"`, size: body.length };
    }),
    getFileObjectStream: vi.fn((key: string) => {
      const body = files.get(key);
      if (!body) throw new Error('NoSuchKey');
      return { body: Readable.from([body]), etag: `"${key}"`, size: body.length };
    }),
    listFileObjects: vi.fn(() =>
      [...files].map(([key, body]) => ({ etag: `"${key}"`, key, size: body.length })),
    ),
  } as unknown as ObjectStorageService;
}

async function drain(stream: Readable): Promise<void> {
  for await (const _chunk of stream) void _chunk;
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
