import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
  unlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep, posix } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { ObjectStorageService } from '../storage/object-storage.service.js';

const archiveMagic = Buffer.from('VISTAFSBK1', 'ascii');
const manifestLimitBytes = 64 * 1024 * 1024;
const fileCountLimit = 100_000;

export interface BackupShareFile {
  contentIncluded: boolean;
  contentReference?: string;
  key: string;
  modifiedAt: string;
  sha256: string;
  size: number;
}

export type FileShareBackupMode = 'differential' | 'full' | 'incremental';

const systemImageExtensions = new Set(['.img', '.iso', '.qcow2', '.raw', '.vhd', '.vhdx', '.vmdk']);

export interface FileShareManifest {
  backupType: FileShareBackupMode;
  createdAt: string;
  deletedKeys: string[];
  files: BackupShareFile[];
  format: 'vista-file-share-backup-v1' | 'vista-file-share-backup-v2';
  sourceCode: string;
  sourceLocation: string;
}

interface ScannedFile extends BackupShareFile {
  device: number;
  inode: number;
  modifiedAtMs: number;
}

export class FileShareBackupArchive {
  manifestFromValue(value: unknown, sourceCode: string, sourceLocation: string): FileShareManifest {
    let encoded: string | undefined;
    try {
      encoded = JSON.stringify(value);
    } catch {
      throw new Error('BACKUP_FILE_MANIFEST_INVALID');
    }
    if (!encoded) throw new Error('BACKUP_FILE_MANIFEST_INVALID');
    const bytes = Buffer.from(encoded, 'utf8');
    if (bytes.length > manifestLimitBytes) throw new Error('BACKUP_FILE_MANIFEST_INVALID');
    return parseManifest(bytes, sourceCode, sourceLocation);
  }

  async assertSourceAvailable(configuredRoot: string, sourceLocation: string): Promise<void> {
    const root = await resolveShareRoot(configuredRoot, sourceLocation);
    await scanTree(root);
  }

  async assertSystemImageAvailable(configuredRoot: string, sourceLocation: string): Promise<void> {
    const root = await resolveShareRoot(configuredRoot, sourceLocation);
    const files = await scanTree(root);
    if (!files.some(({ key }) => systemImageExtensions.has(posix.extname(key).toLowerCase()))) {
      throw new Error('BACKUP_SYSTEM_IMAGE_NOT_FOUND');
    }
  }

  async *open(
    configuredRoot: string,
    sourceCode: string,
    sourceLocation: string,
    options: {
      backupType?: FileShareBackupMode;
      baseline?: FileShareManifest;
      onManifest?: (manifest: FileShareManifest) => void;
    } = {},
  ): AsyncGenerator<Buffer> {
    const root = await resolveShareRoot(configuredRoot, sourceLocation);
    const scanned = await scanTree(root);
    if (scanned.length > fileCountLimit) throw new Error('BACKUP_FILE_COUNT_LIMIT_EXCEEDED');

    const files: ScannedFile[] = [];
    let totalBytes = 0;
    for (const file of scanned) {
      const hashed = await hashFile(root, file);
      totalBytes += hashed.size;
      if (!Number.isSafeInteger(totalBytes)) throw new Error('BACKUP_FILE_TOTAL_SIZE_INVALID');
      files.push(hashed);
    }
    await ensureSameTree(root, files);

    const backupType = options.backupType ?? 'full';
    if (backupType !== 'full' && !options.baseline) {
      throw new Error('BACKUP_INCREMENTAL_BASE_NOT_FOUND');
    }
    const baseline = options.baseline
      ? this.manifestFromValue(options.baseline, sourceCode, sourceLocation)
      : undefined;
    const baselineByKey = new Map(baseline?.files.map((file) => [file.key, file]));
    const currentKeys = new Set(files.map(({ key }) => key));
    const manifestFiles: BackupShareFile[] = files.map(({ key, modifiedAt, sha256, size }) => {
      const previous = baselineByKey.get(key);
      return {
        contentIncluded:
          backupType === 'full' ||
          !previous ||
          previous.sha256 !== sha256 ||
          previous.size !== size,
        key,
        modifiedAt,
        sha256,
        size,
      };
    });
    if (baseline) {
      const currentByKey = new Map(manifestFiles.map((file) => [file.key, file]));
      const baselinePayloads = new Map<string, string>();
      for (const previous of baseline.files) {
        const current = currentByKey.get(previous.key);
        if (current && (current.size !== previous.size || current.sha256 !== previous.sha256)) {
          continue;
        }
        const fingerprint = `${previous.size}:${previous.sha256}`;
        if (!baselinePayloads.has(fingerprint)) baselinePayloads.set(fingerprint, previous.key);
      }
      for (const file of manifestFiles) {
        if (!file.contentIncluded) continue;
        const baselineKey = baselinePayloads.get(`${file.size}:${file.sha256}`);
        if (baselineKey) {
          file.contentIncluded = false;
          file.contentReference = baselineKey;
        }
      }
    }
    const manifest: FileShareManifest = {
      backupType,
      createdAt: new Date().toISOString(),
      deletedKeys: (baseline?.files ?? [])
        .map(({ key }) => key)
        .filter((key) => !currentKeys.has(key))
        .sort((left, right) => left.localeCompare(right)),
      files: manifestFiles,
      format: backupType === 'full' ? 'vista-file-share-backup-v1' : 'vista-file-share-backup-v2',
      sourceCode,
      sourceLocation,
    };
    options.onManifest?.(manifest);
    const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
    if (manifestBytes.length > manifestLimitBytes) {
      throw new Error('BACKUP_FILE_MANIFEST_LIMIT_EXCEEDED');
    }
    const manifestLength = Buffer.alloc(4);
    manifestLength.writeUInt32BE(manifestBytes.length);
    yield archiveMagic;
    yield manifestLength;
    yield manifestBytes;

    for (const file of files) {
      if (!manifest.files.find((item) => item.key === file.key)?.contentIncluded) continue;
      const current = await inspectFile(root, file.key);
      assertUnchanged(file, current);
      const header = Buffer.alloc(8);
      header.writeBigUInt64BE(BigInt(file.size));
      yield header;
      const hash = createHash('sha256');
      let copied = 0;
      for await (const chunk of readNoFollow(join(root, ...file.key.split('/')))) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        copied += bytes.length;
        if (copied > file.size) throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
        hash.update(bytes);
        yield bytes;
      }
      assertUnchanged(file, await inspectFile(root, file.key));
      if (copied !== file.size || hash.digest('hex') !== file.sha256) {
        throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
      }
    }
    await ensureSameTree(root, files);
  }

  async validateFile(
    path: string,
    sourceCode: string,
    sourceLocation: string,
  ): Promise<FileShareManifest> {
    return this.validate(createReadStream(path), sourceCode, sourceLocation);
  }

  async validate(
    archive: Readable,
    sourceCode: string,
    sourceLocation: string,
  ): Promise<FileShareManifest> {
    return this.consume(archive, sourceCode, sourceLocation);
  }

  async restoreFile(
    path: string,
    sourceCode: string,
    sourceLocation: string,
    storage: ObjectStorageService,
    targetPrefix: string,
    onlyFileKey?: string,
  ): Promise<FileShareManifest> {
    return this.restore(
      createReadStream(path),
      sourceCode,
      sourceLocation,
      storage,
      targetPrefix,
      onlyFileKey,
    );
  }

  async restoreChain(
    archivePaths: readonly string[],
    sourceCode: string,
    sourceLocation: string,
    storage: ObjectStorageService,
    targetPrefix: string,
    onlyFileKey?: string,
  ): Promise<FileShareManifest> {
    if (!archivePaths.length) throw new Error('BACKUP_INCREMENTAL_BASE_NOT_FOUND');
    if (!/^restores\/[a-f0-9]{32}\/attempt-[1-9][0-9]*\/$/u.test(targetPrefix)) {
      throw new Error('BACKUP_RESTORE_PREFIX_INVALID');
    }

    if (onlyFileKey) {
      return this.restoreSelectedChain(
        archivePaths,
        sourceCode,
        sourceLocation,
        storage,
        targetPrefix,
        onlyFileKey,
      );
    }

    const stagingRoot = await mkdtemp(join(tmpdir(), 'vista-backup-restore-'));
    let previousKeys = new Set<string>();
    let finalManifest: FileShareManifest | undefined;
    try {
      for (const [index, archivePath] of archivePaths.entries()) {
        finalManifest = await this.applyArchiveToDirectory(
          archivePath,
          sourceCode,
          sourceLocation,
          stagingRoot,
          previousKeys,
          onlyFileKey,
        );
        if (index === 0 && finalManifest.backupType !== 'full') {
          throw new Error('BACKUP_INCREMENTAL_BASE_NOT_FOUND');
        }
        previousKeys = new Set(finalManifest.files.map(({ key }) => key));
      }
      if (!finalManifest) throw new Error('BACKUP_INCREMENTAL_BASE_NOT_FOUND');
      const selectedFiles = onlyFileKey
        ? finalManifest.files.filter(({ key }) => key === onlyFileKey)
        : finalManifest.files;
      if (onlyFileKey && selectedFiles.length !== 1) throw new Error('BACKUP_FILE_NOT_FOUND');
      for (const file of selectedFiles) {
        const path = join(stagingRoot, ...file.key.split('/'));
        await assertFileMatches(path, file);
        await storage.putRestoredFileObject({
          body: createReadStream(path),
          contentType: 'application/octet-stream',
          key: `${targetPrefix}${file.key}`,
          metadata: {
            'vista-file-modified-at': file.modifiedAt,
            'vista-file-sha256': file.sha256,
            'vista-source-code': sourceCode,
          },
          size: file.size,
        });
      }
      return finalManifest;
    } finally {
      await rm(stagingRoot, { force: true, recursive: true });
    }
  }

  async restore(
    archive: Readable,
    sourceCode: string,
    sourceLocation: string,
    storage: ObjectStorageService,
    targetPrefix: string,
    onlyFileKey?: string,
  ): Promise<FileShareManifest> {
    if (!/^restores\/[a-f0-9]{32}\/attempt-[1-9][0-9]*\/$/u.test(targetPrefix)) {
      throw new Error('BACKUP_RESTORE_PREFIX_INVALID');
    }
    return this.consume(
      archive,
      sourceCode,
      sourceLocation,
      async (file, body) => {
        await storage.putRestoredFileObject({
          body,
          contentType: 'application/octet-stream',
          key: `${targetPrefix}${file.key}`,
          metadata: {
            'vista-file-modified-at': file.modifiedAt,
            'vista-file-sha256': file.sha256,
            'vista-source-code': sourceCode,
          },
          size: file.size,
        });
      },
      onlyFileKey,
    );
  }

  private async consume(
    source: Readable,
    sourceCode: string,
    sourceLocation: string,
    consumeFile?: (file: BackupShareFile, body: Readable) => Promise<void>,
    onlyFileKey?: string,
    allowMissingSelectedFile = false,
  ): Promise<FileShareManifest> {
    const reader = new BinaryReader(source);
    const magic = await reader.readExact(archiveMagic.length);
    if (!magic.equals(archiveMagic)) throw new Error('BACKUP_FILE_ARCHIVE_FORMAT_INVALID');
    const manifestLength = (await reader.readExact(4)).readUInt32BE(0);
    if (manifestLength < 2 || manifestLength > manifestLimitBytes) {
      throw new Error('BACKUP_FILE_MANIFEST_INVALID');
    }
    const manifest = parseManifest(
      await reader.readExact(manifestLength),
      sourceCode,
      sourceLocation,
    );
    if (
      onlyFileKey !== undefined &&
      !allowMissingSelectedFile &&
      !manifest.files.some(({ key }) => key === onlyFileKey)
    ) {
      throw new Error('BACKUP_FILE_NOT_FOUND');
    }
    for (const file of manifest.files) {
      if (!file.contentIncluded) continue;
      const header = await reader.readExact(8);
      if (header.readBigUInt64BE(0) !== BigInt(file.size)) {
        throw new Error('BACKUP_FILE_ARCHIVE_SIZE_MISMATCH');
      }
      const hash = createHash('sha256');
      let read = 0;
      const body = Readable.from(
        (async function* () {
          for await (const chunk of reader.readBytes(file.size)) {
            read += chunk.length;
            hash.update(chunk);
            yield chunk;
          }
        })(),
      );
      if (consumeFile && (onlyFileKey === undefined || file.key === onlyFileKey)) {
        await consumeFile(file, body);
      } else {
        for await (const _chunk of body) void _chunk;
      }
      if (read !== file.size || hash.digest('hex') !== file.sha256) {
        throw new Error('BACKUP_FILE_CHECKSUM_MISMATCH');
      }
    }
    await reader.assertEnd();
    return manifest;
  }

  private async applyArchiveToDirectory(
    archivePath: string,
    sourceCode: string,
    sourceLocation: string,
    stagingRoot: string,
    previousKeys: ReadonlySet<string>,
    onlyFileKey?: string,
  ): Promise<FileShareManifest> {
    const manifest = await this.consume(
      createReadStream(archivePath),
      sourceCode,
      sourceLocation,
      async (file, body) => {
        if (onlyFileKey && file.key !== onlyFileKey) {
          for await (const _chunk of body) void _chunk;
          return;
        }
        const path = join(stagingRoot, ...file.key.split('/'));
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await pipeline(body, createWriteStream(path, { mode: 0o600 }));
      },
      onlyFileKey,
      true,
    );
    for (const file of manifest.files) {
      if (!file.contentReference) continue;
      const currentReference = manifest.files.find(({ key }) => key === file.contentReference);
      if (!previousKeys.has(file.contentReference) && !currentReference?.contentIncluded) {
        throw new Error('BACKUP_INCREMENTAL_CHAIN_INVALID');
      }
      const referencePath = join(stagingRoot, ...file.contentReference.split('/'));
      await assertFileMatches(referencePath, {
        contentIncluded: true,
        key: file.contentReference,
        modifiedAt: file.modifiedAt,
        sha256: file.sha256,
        size: file.size,
      });
      const targetPath = join(stagingRoot, ...file.key.split('/'));
      if (referencePath !== targetPath) {
        await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
        await copyFile(referencePath, targetPath);
      }
    }
    const currentKeys = new Set(manifest.files.map(({ key }) => key));
    for (const previousKey of previousKeys) {
      if (currentKeys.has(previousKey) || (onlyFileKey && previousKey !== onlyFileKey)) continue;
      await unlink(join(stagingRoot, ...previousKey.split('/'))).catch((error: unknown) => {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      });
    }
    return manifest;
  }

  private async restoreSelectedChain(
    archivePaths: readonly string[],
    sourceCode: string,
    sourceLocation: string,
    storage: ObjectStorageService,
    targetPrefix: string,
    selectedKey: string,
  ): Promise<FileShareManifest> {
    if (!archivePaths.length) throw new Error('BACKUP_INCREMENTAL_BASE_NOT_FOUND');
    const manifests: FileShareManifest[] = [];
    for (const path of archivePaths) {
      manifests.push(await this.validateFile(path, sourceCode, sourceLocation));
    }
    if (manifests[0]?.backupType !== 'full') {
      throw new Error('BACKUP_INCREMENTAL_BASE_NOT_FOUND');
    }
    for (const [index, manifest] of manifests.entries()) {
      if (
        index > 0 &&
        (manifest.backupType === 'full' || (manifest.backupType === 'differential' && index !== 1))
      ) {
        throw new Error('BACKUP_INCREMENTAL_CHAIN_INVALID');
      }
    }

    const finalManifest = manifests.at(-1);
    const finalFile = finalManifest?.files.find(({ key }) => key === selectedKey);
    if (!finalManifest || !finalFile) throw new Error('BACKUP_FILE_NOT_FOUND');
    let requiredKey = selectedKey;
    let payloadArchiveIndex = -1;
    for (let index = manifests.length - 1; index >= 0; index -= 1) {
      const manifest = manifests[index];
      const file = manifest?.files.find(({ key }) => key === requiredKey);
      if (!manifest || !file) throw new Error('BACKUP_INCREMENTAL_CHAIN_INVALID');
      if (file.contentIncluded) {
        payloadArchiveIndex = index;
        break;
      }
      if (index === 0) throw new Error('BACKUP_INCREMENTAL_CHAIN_INVALID');
      const previousKey = file.contentReference ?? file.key;
      const previousFile = manifests[index - 1]?.files.find(({ key }) => key === previousKey);
      if (!previousFile || previousFile.size !== file.size || previousFile.sha256 !== file.sha256) {
        throw new Error('BACKUP_INCREMENTAL_CHAIN_INVALID');
      }
      requiredKey = previousKey;
    }
    if (payloadArchiveIndex < 0) throw new Error('BACKUP_INCREMENTAL_CHAIN_INVALID');

    const stagingRoot = await mkdtemp(join(tmpdir(), 'vista-backup-selected-restore-'));
    const stagedPath = join(stagingRoot, 'selected-file.archive-content');
    try {
      await this.consume(
        createReadStream(archivePaths[payloadArchiveIndex]!),
        sourceCode,
        sourceLocation,
        async (_file, body) => {
          await pipeline(body, createWriteStream(stagedPath, { mode: 0o600 }));
        },
        requiredKey,
      );
      await assertFileMatches(stagedPath, finalFile);
      await storage.putRestoredFileObject({
        body: createReadStream(stagedPath),
        contentType: 'application/octet-stream',
        key: `${targetPrefix}${finalFile.key}`,
        metadata: {
          'vista-file-modified-at': finalFile.modifiedAt,
          'vista-file-sha256': finalFile.sha256,
          'vista-source-code': sourceCode,
        },
        size: finalFile.size,
      });
      return finalManifest;
    } finally {
      await rm(stagingRoot, { force: true, recursive: true });
    }
  }
}

async function assertFileMatches(path: string, expected: BackupShareFile): Promise<void> {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(bytes);
    size += bytes.length;
  }
  if (size !== expected.size || hash.digest('hex') !== expected.sha256) {
    throw new Error('BACKUP_INCREMENTAL_CHAIN_MISMATCH');
  }
}

async function resolveShareRoot(configuredRoot: string, sourceLocation: string): Promise<string> {
  if (!configuredRoot || !isAbsolute(configuredRoot)) {
    throw new Error('BACKUP_FILE_SOURCE_ROOT_NOT_CONFIGURED');
  }
  if (
    !sourceLocation ||
    sourceLocation.includes('\\') ||
    sourceLocation.includes('\u0000') ||
    isAbsolute(sourceLocation) ||
    /^[a-zA-Z]:/u.test(sourceLocation) ||
    sourceLocation.split('/').some((part) => part === '..')
  ) {
    throw new Error('BACKUP_FILE_SOURCE_LOCATION_INVALID');
  }
  const root = await realpath(configuredRoot);
  const candidate = resolve(root, sourceLocation || '.');
  const relativeCandidate = relative(root, candidate);
  if (
    relativeCandidate === '..' ||
    relativeCandidate.startsWith(`..${sep}`) ||
    isAbsolute(relativeCandidate)
  ) {
    throw new Error('BACKUP_FILE_SOURCE_LOCATION_INVALID');
  }
  let current = root;
  for (const segment of relativeCandidate.split(sep).filter(Boolean)) {
    current = join(current, segment);
    const stats = await lstat(current);
    if (stats.isSymbolicLink()) throw new Error('BACKUP_FILE_SOURCE_SYMLINK_NOT_ALLOWED');
  }
  const sourceRoot = await realpath(candidate);
  const relativeRoot = relative(root, sourceRoot);
  if (relativeRoot === '..' || relativeRoot.startsWith(`..${sep}`) || isAbsolute(relativeRoot)) {
    throw new Error('BACKUP_FILE_SOURCE_LOCATION_INVALID');
  }
  const stats = await lstat(sourceRoot);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('BACKUP_FILE_SOURCE_NOT_DIRECTORY');
  }
  return sourceRoot;
}

async function scanTree(root: string): Promise<ScannedFile[]> {
  const files: ScannedFile[] = [];
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      validateRelativeFileKey(key);
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('BACKUP_FILE_SOURCE_SYMLINK_NOT_ALLOWED');
      if (entry.isDirectory()) {
        await visit(path, key);
      } else if (entry.isFile()) {
        files.push(await inspectFile(root, key));
        if (files.length > fileCountLimit) throw new Error('BACKUP_FILE_COUNT_LIMIT_EXCEEDED');
      } else {
        throw new Error('BACKUP_FILE_SOURCE_SPECIAL_FILE_NOT_ALLOWED');
      }
    }
  };
  await visit(root, '');
  return files.sort((left, right) => left.key.localeCompare(right.key));
}

async function hashFile(root: string, file: ScannedFile): Promise<ScannedFile> {
  const current = await inspectFile(root, file.key);
  assertUnchanged(file, current);
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of readNoFollow(join(root, ...file.key.split('/')))) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    hash.update(bytes);
  }
  assertUnchanged(file, await inspectFile(root, file.key));
  if (size !== file.size) throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
  return { ...file, sha256: hash.digest('hex') };
}

async function inspectFile(root: string, key: string): Promise<ScannedFile> {
  validateRelativeFileKey(key);
  const path = join(root, ...key.split('/'));
  const actual = await realpath(path);
  const relativeActual = relative(root, actual);
  if (
    relativeActual === '..' ||
    relativeActual.startsWith(`..${sep}`) ||
    isAbsolute(relativeActual)
  ) {
    throw new Error('BACKUP_FILE_SOURCE_LOCATION_INVALID');
  }
  const stats = await lstat(path);
  if (stats.isSymbolicLink()) throw new Error('BACKUP_FILE_SOURCE_SYMLINK_NOT_ALLOWED');
  if (!stats.isFile() || !Number.isSafeInteger(stats.size) || stats.size < 0) {
    throw new Error('BACKUP_FILE_SOURCE_SPECIAL_FILE_NOT_ALLOWED');
  }
  return {
    contentIncluded: true,
    device: stats.dev,
    inode: stats.ino,
    key,
    modifiedAt: stats.mtime.toISOString(),
    modifiedAtMs: stats.mtimeMs,
    sha256: '',
    size: stats.size,
  };
}

async function ensureSameTree(root: string, expected: readonly ScannedFile[]): Promise<void> {
  const current = await scanTree(root);
  if (
    current.length !== expected.length ||
    current.some((file, index) => {
      const prior = expected[index];
      return (
        !prior ||
        file.key !== prior.key ||
        file.size !== prior.size ||
        file.device !== prior.device ||
        file.inode !== prior.inode ||
        file.modifiedAtMs !== prior.modifiedAtMs
      );
    })
  ) {
    throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
  }
}

async function* readNoFollow(path: string): AsyncGenerator<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error('BACKUP_FILE_SOURCE_SPECIAL_FILE_NOT_ALLOWED');
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function assertUnchanged(before: ScannedFile, after: ScannedFile): void {
  if (
    before.key !== after.key ||
    before.size !== after.size ||
    before.device !== after.device ||
    before.inode !== after.inode ||
    before.modifiedAtMs !== after.modifiedAtMs
  ) {
    throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
  }
}

function validateRelativeFileKey(key: string): void {
  if (
    !key ||
    key.includes('\\') ||
    key.includes('\u0000') ||
    key.startsWith('/') ||
    key.split('/').some((part) => !part || part === '.' || part === '..') ||
    posix.normalize(key) !== key ||
    basename(key) === ''
  ) {
    throw new Error('BACKUP_FILE_KEY_INVALID');
  }
}

function parseManifest(
  bytes: Buffer,
  sourceCode: string,
  sourceLocation: string,
): FileShareManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('BACKUP_FILE_MANIFEST_INVALID');
  }
  if (
    !isRecord(raw) ||
    !['vista-file-share-backup-v1', 'vista-file-share-backup-v2'].includes(String(raw['format']))
  ) {
    throw new Error('BACKUP_FILE_MANIFEST_INVALID');
  }
  const format = raw['format'] as FileShareManifest['format'];
  const backupType =
    format === 'vista-file-share-backup-v1'
      ? 'full'
      : raw['backupType'] === 'incremental' || raw['backupType'] === 'differential'
        ? raw['backupType']
        : undefined;
  if (raw['sourceCode'] !== sourceCode || raw['sourceLocation'] !== sourceLocation) {
    throw new Error('BACKUP_FILE_MANIFEST_INVALID');
  }
  if (
    !backupType ||
    typeof raw['createdAt'] !== 'string' ||
    !Number.isFinite(Date.parse(raw['createdAt'])) ||
    !Array.isArray(raw['files']) ||
    raw['files'].length > fileCountLimit ||
    (format === 'vista-file-share-backup-v2' && !Array.isArray(raw['deletedKeys']))
  ) {
    throw new Error('BACKUP_FILE_MANIFEST_INVALID');
  }
  const files: BackupShareFile[] = [];
  const keys = new Set<string>();
  let totalBytes = 0;
  for (const candidate of raw['files']) {
    if (!isRecord(candidate)) throw new Error('BACKUP_FILE_MANIFEST_INVALID');
    const { key, modifiedAt, sha256, size } = candidate;
    const contentIncluded =
      format === 'vista-file-share-backup-v1' ? true : candidate['contentIncluded'];
    const rawContentReference = candidate['contentReference'];
    if (
      typeof key !== 'string' ||
      typeof modifiedAt !== 'string' ||
      !Number.isFinite(Date.parse(modifiedAt)) ||
      typeof sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(sha256) ||
      typeof size !== 'number' ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      typeof contentIncluded !== 'boolean' ||
      (rawContentReference !== undefined && typeof rawContentReference !== 'string')
    ) {
      throw new Error('BACKUP_FILE_MANIFEST_INVALID');
    }
    validateRelativeFileKey(key);
    if (keys.has(key)) throw new Error('BACKUP_FILE_MANIFEST_INVALID');
    keys.add(key);
    totalBytes += size;
    if (!Number.isSafeInteger(totalBytes)) throw new Error('BACKUP_FILE_TOTAL_SIZE_INVALID');
    const contentReference = rawContentReference;
    if (contentReference) validateRelativeFileKey(contentReference);
    files.push({
      contentIncluded,
      ...(contentReference ? { contentReference } : {}),
      key,
      modifiedAt,
      sha256,
      size,
    });
  }
  const deletedKeys =
    format === 'vista-file-share-backup-v1' ? [] : (raw['deletedKeys'] as unknown[]);
  const deletedSet = new Set<string>();
  for (const key of deletedKeys) {
    if (typeof key !== 'string' || keys.has(key) || deletedSet.has(key)) {
      throw new Error('BACKUP_FILE_MANIFEST_INVALID');
    }
    validateRelativeFileKey(key);
    deletedSet.add(key);
  }
  const filesByKey = new Map(files.map((file) => [file.key, file]));
  for (const file of files) {
    if (!file.contentReference) continue;
    const reference = filesByKey.get(file.contentReference);
    if (
      format === 'vista-file-share-backup-v1' ||
      backupType === 'full' ||
      file.contentIncluded ||
      (reference && (reference.size !== file.size || reference.sha256 !== file.sha256))
    ) {
      throw new Error('BACKUP_FILE_MANIFEST_INVALID');
    }
  }
  return {
    backupType,
    createdAt: raw['createdAt'],
    deletedKeys: [...deletedSet].sort((left, right) => left.localeCompare(right)),
    files,
    format,
    sourceCode,
    sourceLocation,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class BinaryReader {
  private readonly iterator: AsyncIterator<Buffer | string>;
  private buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private ended = false;

  constructor(source: Readable) {
    this.iterator = source[Symbol.asyncIterator]();
  }

  async readExact(size: number): Promise<Buffer> {
    if (!Number.isSafeInteger(size) || size < 0)
      throw new Error('BACKUP_FILE_ARCHIVE_SIZE_INVALID');
    const chunks: Buffer[] = [];
    let remaining = size;
    while (remaining > 0) {
      if (this.buffered.length === 0) await this.readNext();
      if (this.buffered.length === 0) throw new Error('BACKUP_FILE_ARCHIVE_TRUNCATED');
      const take = Math.min(remaining, this.buffered.length);
      chunks.push(this.buffered.subarray(0, take));
      this.buffered = this.buffered.subarray(take);
      remaining -= take;
    }
    return Buffer.concat(chunks, size);
  }

  async *readBytes(size: number): AsyncGenerator<Buffer> {
    if (!Number.isSafeInteger(size) || size < 0)
      throw new Error('BACKUP_FILE_ARCHIVE_SIZE_INVALID');
    let remaining = size;
    while (remaining > 0) {
      if (this.buffered.length === 0) await this.readNext();
      if (this.buffered.length === 0) throw new Error('BACKUP_FILE_ARCHIVE_TRUNCATED');
      const take = Math.min(remaining, this.buffered.length);
      const chunk = this.buffered.subarray(0, take);
      this.buffered = this.buffered.subarray(take);
      remaining -= take;
      yield chunk;
    }
  }

  async assertEnd(): Promise<void> {
    if (this.buffered.length > 0) throw new Error('BACKUP_FILE_ARCHIVE_TRAILING_DATA');
    if (!this.ended) await this.readNext();
    if (this.buffered.length > 0 || !this.ended) {
      throw new Error('BACKUP_FILE_ARCHIVE_TRAILING_DATA');
    }
  }

  private async readNext(): Promise<void> {
    if (this.ended) return;
    const next = await this.iterator.next();
    if (next.done) {
      this.ended = true;
      return;
    }
    const chunk = next.value;
    this.buffered = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  }
}
