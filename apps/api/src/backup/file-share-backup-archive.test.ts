import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ObjectStorageService } from '../storage/object-storage.service.js';
import { FileShareBackupArchive } from './file-share-backup-archive.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe('FileShareBackupArchive', () => {
  it('accepts only a mounted folder containing an exported system-image file', async () => {
    const root = await makeDirectory();
    const source = join(root, 'server-snapshot');
    const ordinaryFolder = join(root, 'documents');
    await mkdir(source);
    await mkdir(ordinaryFolder);
    await writeFile(join(source, 'root-disk.qcow2'), Buffer.from('QFI\xfbtest-image'));
    await writeFile(join(ordinaryFolder, 'readme.txt'), 'ordinary file snapshot');
    const archive = new FileShareBackupArchive();

    await expect(
      archive.assertSystemImageAvailable(root, 'server-snapshot'),
    ).resolves.toBeUndefined();
    await expect(archive.assertSystemImageAvailable(root, 'documents')).rejects.toThrow(
      'BACKUP_SYSTEM_IMAGE_NOT_FOUND',
    );
  });

  it('archives, verifies, and restores full or selected files under a new isolated prefix', async () => {
    const root = await makeDirectory();
    const source = join(root, 'finance');
    await mkdir(join(source, 'invoices'), { recursive: true });
    await writeFile(join(source, 'invoices', 'one.pdf'), Buffer.from('%PDF-one'));
    await writeFile(join(source, 'empty.txt'), Buffer.alloc(0));

    const archive = new FileShareBackupArchive();
    const bytes = await collect(archive.open(root, 'FINANCE-SHARE', 'finance'));
    const manifest = await archive.validate(Readable.from([bytes]), 'FINANCE-SHARE', 'finance');
    expect(manifest.files.map(({ key }) => key)).toEqual(['empty.txt', 'invoices/one.pdf']);

    const restored = new Map<string, Buffer>();
    const storage = restoreStorage(restored);
    const prefix = 'restores/7a2ec5d06b0149c7ae112137281df13c/attempt-1/';
    await archive.restore(Readable.from([bytes]), 'FINANCE-SHARE', 'finance', storage, prefix);
    expect([...restored.keys()].sort()).toEqual([
      `${prefix}empty.txt`,
      `${prefix}invoices/one.pdf`,
    ]);
    expect(restored.get(`${prefix}invoices/one.pdf`)).toEqual(Buffer.from('%PDF-one'));
    expect(await readFile(join(source, 'invoices', 'one.pdf'))).toEqual(Buffer.from('%PDF-one'));

    restored.clear();
    await archive.restore(
      Readable.from([bytes]),
      'FINANCE-SHARE',
      'finance',
      storage,
      'restores/7a2ec5d06b0149c7ae112137281df13c/attempt-2/',
      'invoices/one.pdf',
    );
    expect([...restored.keys()]).toEqual([
      'restores/7a2ec5d06b0149c7ae112137281df13c/attempt-2/invoices/one.pdf',
    ]);
  });

  it('rejects paths outside the configured root and symbolic links', async () => {
    const root = await makeDirectory();
    const outside = join(root, 'outside');
    const source = join(root, 'sources');
    await mkdir(outside);
    await mkdir(source);
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(outside, join(source, 'escape'));
    const archive = new FileShareBackupArchive();

    await expect(collect(archive.open(source, 'TEST-SHARE', '../outside'))).rejects.toThrow(
      'BACKUP_FILE_SOURCE_LOCATION_INVALID',
    );
    await expect(collect(archive.open(source, 'TEST-SHARE', '.'))).rejects.toThrow(
      'BACKUP_FILE_SOURCE_SYMLINK_NOT_ALLOWED',
    );
  });

  it('rejects changed or malformed archives and selected paths not in the manifest', async () => {
    const root = await makeDirectory();
    await writeFile(join(root, 'sample.txt'), 'original');
    const archive = new FileShareBackupArchive();
    const bytes = await collect(archive.open(root, 'TEST-SHARE', '.'));
    const target = restoreStorage(new Map());

    await expect(
      archive.restore(
        Readable.from([bytes]),
        'OTHER-SHARE',
        '.',
        target,
        'restores/7a2ec5d06b0149c7ae112137281df13c/attempt-1/',
      ),
    ).rejects.toThrow('BACKUP_FILE_MANIFEST_INVALID');
    await expect(
      archive.restore(
        Readable.from([bytes]),
        'TEST-SHARE',
        '.',
        target,
        'restores/7a2ec5d06b0149c7ae112137281df13c/attempt-1/',
        'missing.txt',
      ),
    ).rejects.toThrow('BACKUP_FILE_NOT_FOUND');
    await expect(
      archive.validate(Readable.from([bytes.subarray(0, bytes.length - 1)]), 'TEST-SHARE', '.'),
    ).rejects.toThrow('BACKUP_FILE_ARCHIVE_TRUNCATED');
  });

  it('creates incremental and differential deltas and restores complete snapshots through their base', async () => {
    const root = await makeDirectory();
    const source = join(root, 'finance');
    await mkdir(source);
    await writeFile(join(source, 'unchanged.txt'), 'keep this');
    await writeFile(join(source, 'changed.txt'), 'version one');
    await writeFile(join(source, 'removed.txt'), 'remove this');

    const archive = new FileShareBackupArchive();
    const fullBytes = await collect(archive.open(root, 'FINANCE-SHARE', 'finance'));
    const baseManifest = await archive.validate(
      Readable.from([fullBytes]),
      'FINANCE-SHARE',
      'finance',
    );
    const fullPath = join(root, 'full.archive');
    await writeFile(fullPath, fullBytes);

    await writeFile(join(source, 'changed.txt'), 'version two');
    await writeFile(join(source, 'added.txt'), 'new file');
    await rm(join(source, 'removed.txt'));

    const incrementalBytes = await collect(
      archive.open(root, 'FINANCE-SHARE', 'finance', {
        backupType: 'incremental',
        baseline: baseManifest,
      }),
    );
    const incrementalManifest = await archive.validate(
      Readable.from([incrementalBytes]),
      'FINANCE-SHARE',
      'finance',
    );
    expect(incrementalManifest).toMatchObject({
      backupType: 'incremental',
      deletedKeys: ['removed.txt'],
      format: 'vista-file-share-backup-v2',
    });
    expect(
      incrementalManifest.files.map(({ key, contentIncluded }) => [key, contentIncluded]),
    ).toEqual([
      ['added.txt', true],
      ['changed.txt', true],
      ['unchanged.txt', false],
    ]);

    const incrementalPath = join(root, 'incremental.archive');
    await writeFile(incrementalPath, incrementalBytes);
    const restored = new Map<string, Buffer>();
    const storage = restoreStorage(restored);
    const incrementalPrefix = 'restores/7a2ec5d06b0149c7ae112137281df13c/attempt-1/';
    await archive.restoreChain(
      [fullPath, incrementalPath],
      'FINANCE-SHARE',
      'finance',
      storage,
      incrementalPrefix,
    );
    expect([...restored.keys()].sort()).toEqual([
      `${incrementalPrefix}added.txt`,
      `${incrementalPrefix}changed.txt`,
      `${incrementalPrefix}unchanged.txt`,
    ]);
    expect(restored.get(`${incrementalPrefix}changed.txt`)).toEqual(Buffer.from('version two'));
    expect(restored.get(`${incrementalPrefix}unchanged.txt`)).toEqual(Buffer.from('keep this'));

    const differentialBytes = await collect(
      archive.open(root, 'FINANCE-SHARE', 'finance', {
        backupType: 'differential',
        baseline: baseManifest,
      }),
    );
    const differentialManifest = await archive.validate(
      Readable.from([differentialBytes]),
      'FINANCE-SHARE',
      'finance',
    );
    expect(differentialManifest.backupType).toBe('differential');
    expect(differentialManifest.deletedKeys).toEqual(['removed.txt']);

    const differentialPath = join(root, 'differential.archive');
    await writeFile(differentialPath, differentialBytes);
    restored.clear();
    const differentialPrefix = 'restores/7a2ec5d06b0149c7ae112137281df13c/attempt-2/';
    await archive.restoreChain(
      [fullPath, differentialPath],
      'FINANCE-SHARE',
      'finance',
      storage,
      differentialPrefix,
      'unchanged.txt',
    );
    expect([...restored.keys()]).toEqual([`${differentialPrefix}unchanged.txt`]);
    expect(restored.get(`${differentialPrefix}unchanged.txt`)).toEqual(Buffer.from('keep this'));
  });

  it('reuses and restores a payload from a prior run after it moves to a new path', async () => {
    const root = await makeDirectory();
    const source = join(root, 'finance');
    await mkdir(source);
    const payload = Buffer.alloc(64 * 1024, 0x41);
    await writeFile(join(source, 'old-key.bin'), payload);
    await writeFile(join(source, 'keep.txt'), 'keep');

    const archive = new FileShareBackupArchive();
    const fullBytes = await collect(archive.open(root, 'FINANCE-SHARE', 'finance'));
    const fullManifest = await archive.validate(
      Readable.from([fullBytes]),
      'FINANCE-SHARE',
      'finance',
    );
    const fullPath = join(root, 'full.archive');
    await writeFile(fullPath, fullBytes);

    await rm(join(source, 'old-key.bin'));
    await writeFile(join(source, 'new-key.bin'), payload);
    const deltaBytes = await collect(
      archive.open(root, 'FINANCE-SHARE', 'finance', {
        backupType: 'incremental',
        baseline: fullManifest,
      }),
    );
    const deltaManifest = await archive.validate(
      Readable.from([deltaBytes]),
      'FINANCE-SHARE',
      'finance',
    );
    expect(deltaManifest.files.find(({ key }) => key === 'new-key.bin')).toMatchObject({
      contentIncluded: false,
      contentReference: 'old-key.bin',
    });
    expect(deltaManifest.deletedKeys).toEqual(['old-key.bin']);
    expect(deltaBytes.length).toBeLessThan(2_000);

    const deltaPath = join(root, 'delta.archive');
    await writeFile(deltaPath, deltaBytes);
    const restored = new Map<string, Buffer>();
    const storage = restoreStorage(restored);
    const fullPrefix = 'restores/7a2ec5d06b0149c7ae112137281df13c/attempt-3/';
    await archive.restoreChain(
      [fullPath, deltaPath],
      'FINANCE-SHARE',
      'finance',
      storage,
      fullPrefix,
    );
    expect(restored.get(`${fullPrefix}new-key.bin`)).toEqual(payload);
    expect(restored.has(`${fullPrefix}old-key.bin`)).toBe(false);

    restored.clear();
    const selectedPrefix = 'restores/7a2ec5d06b0149c7ae112137281df13c/attempt-4/';
    await archive.restoreChain(
      [fullPath, deltaPath],
      'FINANCE-SHARE',
      'finance',
      storage,
      selectedPrefix,
      'new-key.bin',
    );
    expect([...restored.keys()]).toEqual([`${selectedPrefix}new-key.bin`]);
    expect(restored.get(`${selectedPrefix}new-key.bin`)).toEqual(payload);
  });

  it('rejects incremental archives restored without their full base', async () => {
    const root = await makeDirectory();
    await writeFile(join(root, 'current.txt'), 'current');
    const archive = new FileShareBackupArchive();
    await expect(
      collect(
        archive.open(root, 'TEST-SHARE', '.', {
          backupType: 'incremental',
        }),
      ),
    ).rejects.toThrow('BACKUP_INCREMENTAL_BASE_NOT_FOUND');

    const fullBytes = await collect(archive.open(root, 'TEST-SHARE', '.'));
    const manifest = await archive.validate(Readable.from([fullBytes]), 'TEST-SHARE', '.');
    await rm(join(root, 'current.txt'));
    const deltaBytes = await collect(
      archive.open(root, 'TEST-SHARE', '.', {
        backupType: 'incremental',
        baseline: manifest,
      }),
    );
    const deltaPath = join(root, 'delta.archive');
    await writeFile(deltaPath, deltaBytes);
    const restored = new Map<string, Buffer>();
    await expect(
      archive.restoreChain(
        [deltaPath],
        'TEST-SHARE',
        '.',
        restoreStorage(restored),
        'restores/7a2ec5d06b0149c7ae112137281df13c/attempt-1/',
      ),
    ).rejects.toThrow('BACKUP_INCREMENTAL_BASE_NOT_FOUND');
    expect(restored).toEqual(new Map());
  });
});

async function makeDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'vista-backup-share-'));
  temporaryDirectories.push(path);
  return path;
}

async function collect(stream: AsyncIterable<Buffer>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function restoreStorage(target: Map<string, Buffer>): ObjectStorageService {
  return {
    putRestoredFileObject: vi.fn(async (input: { body: Readable; key: string }) => {
      const chunks: Buffer[] = [];
      for await (const chunk of input.body) chunks.push(Buffer.from(chunk));
      target.set(input.key, Buffer.concat(chunks));
    }),
  } as unknown as ObjectStorageService;
}
