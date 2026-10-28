import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { ObjectStorageService } from '../storage/object-storage.service.js';

const archiveMagic = Buffer.from('VISTAOBJBAK1', 'ascii');
const manifestLimitBytes = 64 * 1024 * 1024;
const objectCountLimit = 100_000;
const chunkSizeBytes = 4 * 1024 * 1024;
const chunkCountLimit = 1_000_000;

export interface BackupObjectBlock {
  sha256: string;
  size: number;
}

export interface BackupArchiveBlock extends BackupObjectBlock {
  contentIncluded: boolean;
}

export interface BackupFileObject {
  cacheControl?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  contentLanguage?: string;
  blocks?: BackupObjectBlock[];
  contentType?: string;
  etag?: string;
  expires?: string;
  key: string;
  metadata?: Record<string, string>;
  sha256?: string;
  size: number;
  contentIncluded?: boolean;
  contentReference?: string;
}

export type ObjectStorageBackupMode = 'differential' | 'full' | 'incremental';

export interface ObjectStorageBackupSource {
  bucketName(): string;
  close?(): void | Promise<void>;
  describeFileObject(key: string): Promise<{
    cacheControl?: string;
    contentDisposition?: string;
    contentEncoding?: string;
    contentLanguage?: string;
    contentType?: string;
    etag?: string;
    expires?: Date;
    metadata?: Record<string, string>;
    size: number;
  }>;
  getFileObjectStream(key: string): Promise<{ body: Readable; etag?: string; size: number }>;
  listFileObjects(): Promise<Array<{ etag?: string; key: string; size: number }>>;
}

export interface ObjectStorageBackupManifest {
  backupType?: ObjectStorageBackupMode;
  createdAt: string;
  deletedKeys?: string[];
  format:
    | 'vista-object-store-backup-v1'
    | 'vista-object-store-backup-v2'
    | 'vista-object-store-backup-v3';
  chunks?: BackupArchiveBlock[];
  objects: BackupFileObject[];
  sourceBucket: string;
}

export class ObjectStorageBackupArchive {
  manifestFromValue(value: unknown, expectedSourceBucket: string): ObjectStorageBackupManifest {
    let encoded: string | undefined;
    try {
      encoded = JSON.stringify(value);
    } catch {
      throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
    }
    if (!encoded) throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
    const bytes = Buffer.from(encoded, 'utf8');
    if (bytes.length > manifestLimitBytes) throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
    return parseManifest(bytes, expectedSourceBucket);
  }

  open(
    storage: ObjectStorageBackupSource,
    options: { backupType?: ObjectStorageBackupMode; baseline?: ObjectStorageBackupManifest } = {},
  ): Readable {
    return Readable.from(this.writeArchive(storage, options));
  }

  async validateFile(
    path: string,
    expectedSourceBucket: string,
  ): Promise<ObjectStorageBackupManifest> {
    return this.validate(createReadStream(path), expectedSourceBucket);
  }

  async validate(
    archive: Readable,
    expectedSourceBucket: string,
  ): Promise<ObjectStorageBackupManifest> {
    return this.consumeArchive(archive, expectedSourceBucket, undefined, undefined, true);
  }

  async restoreFile(
    path: string,
    expectedSourceBucket: string,
    storage: ObjectStorageService,
    targetPrefix: string,
    onlyObjectKey?: string,
  ): Promise<ObjectStorageBackupManifest> {
    if (!/^restores\/[a-f0-9]{32}\/attempt-[1-9][0-9]*\/$/u.test(targetPrefix)) {
      throw new Error('BACKUP_RESTORE_PREFIX_INVALID');
    }
    return this.restoreChain([path], expectedSourceBucket, storage, targetPrefix, onlyObjectKey);
  }

  async restore(
    archive: Readable,
    expectedSourceBucket: string,
    storage: ObjectStorageService,
    targetPrefix: string,
    onlyObjectKey?: string,
  ): Promise<ObjectStorageBackupManifest> {
    if (!/^restores\/[a-f0-9]{32}\/attempt-[1-9][0-9]*\/$/u.test(targetPrefix)) {
      throw new Error('BACKUP_RESTORE_PREFIX_INVALID');
    }
    const directory = await mkdtemp(join(tmpdir(), 'vista-object-archive-restore-'));
    const archivePath = join(directory, 'archive.bin');
    try {
      await pipeline(archive, createWriteStream(archivePath, { mode: 0o600 }));
      return await this.restoreChain(
        [archivePath],
        expectedSourceBucket,
        storage,
        targetPrefix,
        onlyObjectKey,
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }

  async restoreChain(
    archivePaths: readonly string[],
    expectedSourceBucket: string,
    storage: ObjectStorageService,
    targetPrefix: string,
    onlyObjectKey?: string,
  ): Promise<ObjectStorageBackupManifest> {
    if (!archivePaths.length) throw new Error('BACKUP_INCREMENTAL_BASE_NOT_FOUND');
    if (!/^restores\/[a-f0-9]{32}\/attempt-[1-9][0-9]*\/$/u.test(targetPrefix)) {
      throw new Error('BACKUP_RESTORE_PREFIX_INVALID');
    }

    const stagingRoot = await mkdtemp(join(tmpdir(), 'vista-object-restore-'));
    let staged = new Map<string, { object: BackupFileObject; path: string }>();
    let stagedChunks = new Map<string, { descriptor: BackupObjectBlock; path: string }>();
    let finalManifest: ObjectStorageBackupManifest | undefined;
    try {
      for (const [index, archivePath] of archivePaths.entries()) {
        const previous = staged;
        const next = new Map(previous);
        const previousChunks = stagedChunks;
        const nextChunks = new Map(previousChunks);
        finalManifest = await this.consumeArchive(
          createReadStream(archivePath),
          expectedSourceBucket,
          async (object, body) => {
            if (!object.contentIncluded) return;
            const path = join(
              stagingRoot,
              `${createHash('sha256').update(object.key).digest('hex')}.obj`,
            );
            await pipeline(body, createWriteStream(path, { mode: 0o600 }));
            next.set(object.key, { object, path });
          },
          undefined,
          true,
          async (chunk, body) => {
            const fingerprint = blockFingerprint(chunk);
            const path = join(stagingRoot, `${chunk.sha256}-${chunk.size}.chunk`);
            await pipeline(body, createWriteStream(path, { mode: 0o600 }));
            nextChunks.set(fingerprint, {
              descriptor: { sha256: chunk.sha256, size: chunk.size },
              path,
            });
          },
        );
        if (index === 0 && finalManifest.backupType !== 'full') {
          throw new Error('BACKUP_INCREMENTAL_BASE_NOT_FOUND');
        }
        if (finalManifest.format === 'vista-object-store-backup-v3') {
          const included = new Set(
            (finalManifest.chunks ?? [])
              .filter((chunk) => chunk.contentIncluded)
              .map(blockFingerprint),
          );
          for (const chunk of finalManifest.chunks ?? []) {
            if (
              !included.has(blockFingerprint(chunk)) &&
              !previousChunks.has(blockFingerprint(chunk))
            ) {
              throw new Error('BACKUP_INCREMENTAL_CHAIN_INVALID');
            }
          }
          for (const object of finalManifest.objects) {
            if ((object.blocks ?? []).some((block) => !nextChunks.has(blockFingerprint(block)))) {
              throw new Error('BACKUP_INCREMENTAL_CHAIN_INVALID');
            }
          }
          if (
            index > 0 &&
            (finalManifest.backupType === 'full' ||
              (finalManifest.backupType === 'differential' && index !== 1))
          ) {
            throw new Error('BACKUP_INCREMENTAL_CHAIN_INVALID');
          }
          stagedChunks = nextChunks;
          staged = new Map();
          continue;
        }
        if (stagedChunks.size > 0) throw new Error('BACKUP_INCREMENTAL_CHAIN_INVALID');
        const snapshotKeys = new Set(finalManifest.objects.map(({ key }) => key));
        if (snapshotKeys.size !== finalManifest.objects.length) {
          throw new Error('BACKUP_INCREMENTAL_CHAIN_INVALID');
        }
        for (const object of finalManifest.objects) {
          if (!object.contentIncluded) {
            if (object.contentReference) {
              const reference = next.get(object.contentReference);
              if (
                !reference ||
                reference.object.size !== object.size ||
                reference.object.sha256 !== object.sha256
              ) {
                throw new Error('BACKUP_INCREMENTAL_CHAIN_INVALID');
              }
              next.set(object.key, { object, path: reference.path });
            } else {
              const base = previous.get(object.key);
              if (!base || !sameObjectSnapshot(base.object, object)) {
                throw new Error('BACKUP_INCREMENTAL_CHAIN_INVALID');
              }
              next.set(object.key, { object, path: base.path });
            }
          } else if (!next.has(object.key)) {
            throw new Error('BACKUP_INCREMENTAL_CHAIN_INVALID');
          }
        }
        for (const key of finalManifest.deletedKeys ?? []) next.delete(key);
        if (
          snapshotKeys.size !== next.size ||
          [...next.keys()].some((key) => !snapshotKeys.has(key))
        ) {
          throw new Error('BACKUP_INCREMENTAL_CHAIN_INVALID');
        }
        if (
          index > 0 &&
          (finalManifest.backupType === 'full' ||
            (finalManifest.backupType === 'differential' && index !== 1))
        ) {
          throw new Error('BACKUP_INCREMENTAL_CHAIN_INVALID');
        }
        staged = next;
      }

      if (!finalManifest) throw new Error('BACKUP_INCREMENTAL_BASE_NOT_FOUND');
      const selected = onlyObjectKey
        ? finalManifest.objects.filter(({ key }) => key === onlyObjectKey)
        : finalManifest.objects;
      if (onlyObjectKey && selected.length !== 1) throw new Error('BACKUP_OBJECT_NOT_FOUND');
      if (finalManifest.format === 'vista-object-store-backup-v3') {
        const restoredPaths = new Map<string, string>();
        for (const object of selected) {
          const path = join(
            stagingRoot,
            `${createHash('sha256').update(object.key).digest('hex')}.restored`,
          );
          const digest = createHash('sha256');
          let restoredSize = 0;
          const reconstructed = Readable.from(
            (async function* () {
              for (const block of object.blocks ?? []) {
                const stagedBlock = stagedChunks.get(blockFingerprint(block));
                if (!stagedBlock || stagedBlock.descriptor.size !== block.size) {
                  throw new Error('BACKUP_INCREMENTAL_CHAIN_INVALID');
                }
                for await (const chunk of createReadStream(stagedBlock.path)) {
                  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                  restoredSize += bytes.length;
                  digest.update(bytes);
                  yield bytes;
                }
              }
            })(),
          );
          await pipeline(reconstructed, createWriteStream(path, { mode: 0o600 }));
          if (restoredSize !== object.size || digest.digest('hex') !== object.sha256) {
            throw new Error('BACKUP_OBJECT_ARCHIVE_HASH_MISMATCH');
          }
          restoredPaths.set(object.key, path);
        }
        for (const object of selected) {
          const path = restoredPaths.get(object.key);
          if (!path) throw new Error('BACKUP_INCREMENTAL_CHAIN_INVALID');
          await storage.putRestoredFileObject({
            body: createReadStream(path),
            ...(object.cacheControl ? { cacheControl: object.cacheControl } : {}),
            ...(object.contentDisposition ? { contentDisposition: object.contentDisposition } : {}),
            ...(object.contentEncoding ? { contentEncoding: object.contentEncoding } : {}),
            ...(object.contentLanguage ? { contentLanguage: object.contentLanguage } : {}),
            ...(object.contentType ? { contentType: object.contentType } : {}),
            ...(object.expires ? { expires: new Date(object.expires) } : {}),
            key: `${targetPrefix}${object.key}`,
            ...(object.metadata ? { metadata: object.metadata } : {}),
            size: object.size,
          });
        }
        return finalManifest;
      }
      for (const object of selected) {
        const entry = staged.get(object.key);
        if (
          !entry ||
          !sameObjectDescription(entry.object, object) ||
          (object.sha256 !== undefined && entry.object.sha256 !== object.sha256)
        ) {
          throw new Error('BACKUP_INCREMENTAL_CHAIN_INVALID');
        }
        await storage.putRestoredFileObject({
          body: createReadStream(entry.path),
          ...(object.cacheControl ? { cacheControl: object.cacheControl } : {}),
          ...(object.contentDisposition ? { contentDisposition: object.contentDisposition } : {}),
          ...(object.contentEncoding ? { contentEncoding: object.contentEncoding } : {}),
          ...(object.contentLanguage ? { contentLanguage: object.contentLanguage } : {}),
          ...(object.contentType ? { contentType: object.contentType } : {}),
          ...(object.expires ? { expires: new Date(object.expires) } : {}),
          key: `${targetPrefix}${object.key}`,
          ...(object.metadata ? { metadata: object.metadata } : {}),
          size: object.size,
        });
      }
      return finalManifest;
    } finally {
      await rm(stagingRoot, { force: true, recursive: true });
    }
  }

  private async *writeArchive(
    storage: ObjectStorageBackupSource,
    options: { backupType?: ObjectStorageBackupMode; baseline?: ObjectStorageBackupManifest },
  ): AsyncGenerator<Buffer> {
    try {
      const listed = (await storage.listFileObjects()).sort((left, right) =>
        left.key.localeCompare(right.key),
      );
      if (listed.length > objectCountLimit) throw new Error('BACKUP_OBJECT_COUNT_LIMIT_EXCEEDED');
      const backupType = options.backupType ?? 'full';
      const baseline = options.baseline
        ? this.manifestFromValue(options.baseline, storage.bucketName())
        : undefined;
      if (backupType !== 'full' && !baseline) {
        throw new Error('BACKUP_INCREMENTAL_BASE_NOT_FOUND');
      }
      if (backupType === 'differential' && baseline?.backupType !== 'full') {
        throw new Error('BACKUP_INCREMENTAL_BASE_NOT_FOUND');
      }
      const baselineByKey = new Map(baseline?.objects.map((object) => [object.key, object]));
      const objects: BackupFileObject[] = [];
      let totalBytes = 0;
      for (const item of listed) {
        validateKey(item.key);
        if (!Number.isSafeInteger(item.size) || item.size < 0) {
          throw new Error('BACKUP_OBJECT_SIZE_INVALID');
        }
        const metadata = await storage.describeFileObject(item.key);
        if (metadata.size !== item.size || (item.etag && metadata.etag !== item.etag)) {
          throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
        }
        if (backupType !== 'full' && !metadata.etag) {
          throw new Error('BACKUP_OBJECT_VERSION_UNAVAILABLE');
        }
        totalBytes += metadata.size;
        if (!Number.isSafeInteger(totalBytes)) throw new Error('BACKUP_OBJECT_TOTAL_SIZE_INVALID');
        const object: BackupFileObject = {
          ...(metadata.cacheControl ? { cacheControl: metadata.cacheControl } : {}),
          ...(metadata.contentDisposition
            ? { contentDisposition: metadata.contentDisposition }
            : {}),
          ...(metadata.contentEncoding ? { contentEncoding: metadata.contentEncoding } : {}),
          ...(metadata.contentLanguage ? { contentLanguage: metadata.contentLanguage } : {}),
          ...(metadata.contentType ? { contentType: metadata.contentType } : {}),
          ...(metadata.etag ? { etag: metadata.etag } : {}),
          ...(metadata.expires ? { expires: metadata.expires.toISOString() } : {}),
          key: item.key,
          ...(metadata.metadata ? { metadata: metadata.metadata } : {}),
          ...(await hashObjectBlocks(storage, item, metadata)),
          size: metadata.size,
        };
        const previous = baselineByKey.get(item.key);
        object.contentIncluded =
          backupType === 'full' ||
          baseline?.format !== 'vista-object-store-backup-v3' ||
          !previous ||
          !sameObjectSnapshot(previous, object);
        objects.push(object);
      }
      if (baseline) {
        const currentByKey = new Map(objects.map((object) => [object.key, object]));
        const baselinePayloads = new Map<string, string>();
        for (const previous of baseline.objects) {
          if (baseline.format !== 'vista-object-store-backup-v3') break;
          const current = currentByKey.get(previous.key);
          if (current && (current.size !== previous.size || current.sha256 !== previous.sha256)) {
            continue;
          }
          const fingerprint = `${previous.size}:${previous.sha256}`;
          if (!baselinePayloads.has(fingerprint)) baselinePayloads.set(fingerprint, previous.key);
        }
        for (const object of objects) {
          if (!object.contentIncluded || !object.sha256) continue;
          const baselineKey = baselinePayloads.get(`${object.size}:${object.sha256}`);
          if (baselineKey) {
            object.contentIncluded = false;
            object.contentReference = baselineKey;
          }
        }
      }
      const includedPayloads = new Map<string, string>();
      for (const object of objects) {
        if (!object.contentIncluded || !object.sha256) continue;
        const fingerprint = `${object.size}:${object.sha256}`;
        const firstKey = includedPayloads.get(fingerprint);
        if (firstKey) {
          object.contentIncluded = false;
          object.contentReference = firstKey;
        } else {
          includedPayloads.set(fingerprint, object.key);
        }
      }
      const baselineBlocks = new Set(
        baseline?.format === 'vista-object-store-backup-v3'
          ? (baseline.chunks ?? []).map(blockFingerprint)
          : [],
      );
      const chunksByFingerprint = new Map<string, BackupArchiveBlock>();
      for (const object of objects) {
        for (const block of object.blocks ?? []) {
          const fingerprint = blockFingerprint(block);
          if (chunksByFingerprint.has(fingerprint)) continue;
          chunksByFingerprint.set(fingerprint, {
            ...block,
            contentIncluded: backupType === 'full' || !baselineBlocks.has(fingerprint),
          });
        }
      }
      const chunks = [...chunksByFingerprint.values()];
      if (chunks.length > chunkCountLimit) throw new Error('BACKUP_OBJECT_CHUNK_LIMIT_EXCEEDED');
      const includedChunks = new Map(
        chunks
          .filter((chunk) => chunk.contentIncluded)
          .map((chunk) => [blockFingerprint(chunk), chunk]),
      );
      const currentKeys = new Set(objects.map(({ key }) => key));
      const manifest: ObjectStorageBackupManifest = {
        backupType,
        createdAt: new Date().toISOString(),
        deletedKeys: (baseline?.objects ?? [])
          .map(({ key }) => key)
          .filter((key) => !currentKeys.has(key))
          .sort((left, right) => left.localeCompare(right)),
        format: 'vista-object-store-backup-v3',
        chunks,
        objects,
        sourceBucket: storage.bucketName(),
      };
      const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
      if (manifestBytes.length > manifestLimitBytes) {
        throw new Error('BACKUP_OBJECT_MANIFEST_LIMIT_EXCEEDED');
      }
      await ensureSameListing(storage, listed);

      const manifestLength = Buffer.alloc(4);
      manifestLength.writeUInt32BE(manifestBytes.length);
      yield archiveMagic;
      yield manifestLength;
      yield manifestBytes;
      const emittedChunks = new Set<string>();
      for (const object of objects) {
        const currentObject = await storage.getFileObjectStream(object.key);
        if (
          currentObject.size !== object.size ||
          (object.etag !== undefined && currentObject.etag !== object.etag)
        ) {
          currentObject.body.destroy();
          throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
        }
        let copiedBytes = 0;
        const digest = createHash('sha256');
        const objectBlocks = object.blocks ?? [];
        let blockIndex = 0;
        for await (const bytes of fixedBlocks(currentObject.body, chunkSizeBytes)) {
          copiedBytes += bytes.length;
          if (copiedBytes > object.size) throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
          digest.update(bytes);
          const descriptor = objectBlocks[blockIndex];
          if (
            !descriptor ||
            descriptor.size !== bytes.length ||
            descriptor.sha256 !== sha256(bytes)
          ) {
            throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
          }
          const fingerprint = blockFingerprint(descriptor);
          const included = includedChunks.get(fingerprint);
          if (included && !emittedChunks.has(fingerprint)) {
            const sizeHeader = Buffer.alloc(8);
            sizeHeader.writeBigUInt64BE(BigInt(bytes.length));
            yield sizeHeader;
            yield bytes;
            emittedChunks.add(fingerprint);
          }
          blockIndex += 1;
        }
        if (
          copiedBytes !== object.size ||
          blockIndex !== objectBlocks.length ||
          digest.digest('hex') !== object.sha256 ||
          !sameObjectDescription(
            object,
            objectFromDescription(object.key, await storage.describeFileObject(object.key)),
          )
        ) {
          throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
        }
      }
      if (emittedChunks.size !== includedChunks.size) {
        throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
      }
      await ensureSameListing(storage, listed);
    } finally {
      await storage.close?.();
    }
  }

  private async consumeArchive(
    source: Readable,
    expectedSourceBucket: string,
    consumeObject?: (object: BackupFileObject, body: Readable) => Promise<void>,
    onlyObjectKey?: string,
    allowDelta = false,
    consumeChunk?: (chunk: BackupArchiveBlock, body: Readable) => Promise<void>,
  ): Promise<ObjectStorageBackupManifest> {
    const reader = new BinaryReader(source);
    const magic = await reader.readExact(archiveMagic.length);
    if (!magic.equals(archiveMagic)) throw new Error('BACKUP_OBJECT_ARCHIVE_FORMAT_INVALID');
    const manifestLength = (await reader.readExact(4)).readUInt32BE(0);
    if (manifestLength < 2 || manifestLength > manifestLimitBytes) {
      throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
    }
    let manifest: ObjectStorageBackupManifest;
    try {
      manifest = parseManifest(await reader.readExact(manifestLength), expectedSourceBucket);
    } catch (error) {
      source.destroy();
      throw error;
    }
    if (onlyObjectKey !== undefined && !manifest.objects.some(({ key }) => key === onlyObjectKey)) {
      source.destroy();
      throw new Error('BACKUP_OBJECT_NOT_FOUND');
    }
    if (!allowDelta && manifest.backupType !== 'full') {
      source.destroy();
      throw new Error('BACKUP_INCREMENTAL_BASE_NOT_FOUND');
    }
    if (
      onlyObjectKey &&
      !manifest.objects.find(({ key }) => key === onlyObjectKey)?.contentIncluded
    ) {
      source.destroy();
      throw new Error('BACKUP_INCREMENTAL_BASE_NOT_FOUND');
    }
    const consumeVerifiedBody = async (
      size: number,
      expectedSha256: string | undefined,
      consume: ((body: Readable) => Promise<void>) | undefined,
    ): Promise<void> => {
      const sizeHeader = await reader.readExact(8);
      if (sizeHeader.readBigUInt64BE(0) !== BigInt(size)) {
        throw new Error('BACKUP_OBJECT_ARCHIVE_SIZE_MISMATCH');
      }
      const body = Readable.from(reader.readBytes(size));
      let readBytes = 0;
      const digest = createHash('sha256');
      const verifiedBody = Readable.from(
        (async function* () {
          for await (const chunk of body) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            readBytes += bytes.length;
            digest.update(bytes);
            yield bytes;
          }
        })(),
      );
      if (consume) {
        await consume(verifiedBody);
      } else {
        for await (const _chunk of verifiedBody) void _chunk;
      }
      if (readBytes !== size) throw new Error('BACKUP_OBJECT_ARCHIVE_TRUNCATED');
      if (expectedSha256 && digest.digest('hex') !== expectedSha256) {
        throw new Error('BACKUP_OBJECT_ARCHIVE_HASH_MISMATCH');
      }
    };
    if (manifest.format === 'vista-object-store-backup-v3') {
      for (const chunk of manifest.chunks ?? []) {
        if (!chunk.contentIncluded) continue;
        await consumeVerifiedBody(
          chunk.size,
          chunk.sha256,
          consumeChunk ? (body) => consumeChunk(chunk, body) : undefined,
        );
      }
    } else {
      for (const object of manifest.objects) {
        if (!object.contentIncluded) continue;
        await consumeVerifiedBody(
          object.size,
          object.sha256,
          consumeObject && (onlyObjectKey === undefined || object.key === onlyObjectKey)
            ? (body) => consumeObject(object, body)
            : undefined,
        );
      }
    }
    await reader.assertEnd();
    return manifest;
  }
}

async function ensureSameListing(
  storage: ObjectStorageBackupSource,
  expected: readonly { etag?: string; key: string; size: number }[],
): Promise<void> {
  const current = (await storage.listFileObjects()).sort((left, right) =>
    left.key.localeCompare(right.key),
  );
  if (
    current.length !== expected.length ||
    current.some(
      (item, index) =>
        item.key !== expected[index]?.key ||
        item.size !== expected[index]?.size ||
        item.etag !== expected[index]?.etag,
    )
  ) {
    throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
  }
}

type ObjectDescription = Awaited<ReturnType<ObjectStorageBackupSource['describeFileObject']>>;

async function hashObjectBlocks(
  storage: ObjectStorageBackupSource,
  listed: { etag?: string; key: string; size: number },
  description: ObjectDescription,
): Promise<{ blocks: BackupObjectBlock[]; sha256: string }> {
  const source = await storage.getFileObjectStream(listed.key);
  if (
    source.size !== listed.size ||
    source.size !== description.size ||
    (listed.etag !== undefined && source.etag !== listed.etag)
  ) {
    source.body.destroy();
    throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
  }
  const digest = createHash('sha256');
  let copiedBytes = 0;
  const blocks: BackupObjectBlock[] = [];
  for await (const bytes of fixedBlocks(source.body, chunkSizeBytes)) {
    copiedBytes += bytes.length;
    if (copiedBytes > listed.size) throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
    digest.update(bytes);
    blocks.push({ sha256: sha256(bytes), size: bytes.length });
    if (blocks.length > chunkCountLimit) throw new Error('BACKUP_OBJECT_CHUNK_LIMIT_EXCEEDED');
  }
  const checksum = digest.digest('hex');
  if (
    copiedBytes !== listed.size ||
    !sameObjectDescription(
      objectFromDescription(listed.key, description),
      objectFromDescription(listed.key, await storage.describeFileObject(listed.key)),
    )
  ) {
    throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
  }
  return { blocks, sha256: checksum };
}

async function* fixedBlocks(source: Readable, blockSize: number): AsyncGenerator<Buffer> {
  let pending = Buffer.alloc(0);
  for await (const chunk of source) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let offset = 0;
    if (pending.length > 0) {
      const take = Math.min(blockSize - pending.length, bytes.length);
      pending = Buffer.concat([pending, bytes.subarray(0, take)]);
      offset = take;
      if (pending.length === blockSize) {
        yield pending;
        pending = Buffer.alloc(0);
      }
    }
    while (offset + blockSize <= bytes.length) {
      yield bytes.subarray(offset, offset + blockSize);
      offset += blockSize;
    }
    if (offset < bytes.length) pending = Buffer.from(bytes.subarray(offset));
  }
  if (pending.length > 0) yield pending;
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function blockFingerprint(block: BackupObjectBlock): string {
  return `${block.sha256}:${block.size}`;
}

function objectFromDescription(key: string, description: ObjectDescription): BackupFileObject {
  return {
    ...(description.cacheControl ? { cacheControl: description.cacheControl } : {}),
    ...(description.contentDisposition
      ? { contentDisposition: description.contentDisposition }
      : {}),
    ...(description.contentEncoding ? { contentEncoding: description.contentEncoding } : {}),
    ...(description.contentLanguage ? { contentLanguage: description.contentLanguage } : {}),
    ...(description.contentType ? { contentType: description.contentType } : {}),
    ...(description.etag ? { etag: description.etag } : {}),
    ...(description.expires ? { expires: description.expires.toISOString() } : {}),
    key,
    ...(description.metadata ? { metadata: description.metadata } : {}),
    size: description.size,
  };
}

function sameObjectDescription(left: BackupFileObject, right: BackupFileObject): boolean {
  return (
    left.key === right.key &&
    left.size === right.size &&
    left.etag === right.etag &&
    left.cacheControl === right.cacheControl &&
    left.contentDisposition === right.contentDisposition &&
    left.contentEncoding === right.contentEncoding &&
    left.contentLanguage === right.contentLanguage &&
    left.contentType === right.contentType &&
    left.expires === right.expires &&
    JSON.stringify(sortedRecord(left.metadata)) === JSON.stringify(sortedRecord(right.metadata))
  );
}

function sameObjectSnapshot(left: BackupFileObject, right: BackupFileObject): boolean {
  return (
    sameObjectDescription(left, right) &&
    typeof left.sha256 === 'string' &&
    left.sha256 === right.sha256
  );
}

function sortedRecord(
  value: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!value) return undefined;
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
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
      throw new Error('BACKUP_OBJECT_ARCHIVE_SIZE_INVALID');
    const chunks: Buffer[] = [];
    let remaining = size;
    while (remaining > 0) {
      if (this.buffered.length === 0) await this.readNext();
      if (this.buffered.length === 0) throw new Error('BACKUP_OBJECT_ARCHIVE_TRUNCATED');
      const take = Math.min(remaining, this.buffered.length);
      chunks.push(this.buffered.subarray(0, take));
      this.buffered = this.buffered.subarray(take);
      remaining -= take;
    }
    return Buffer.concat(chunks, size);
  }

  async *readBytes(size: number): AsyncGenerator<Buffer> {
    if (!Number.isSafeInteger(size) || size < 0)
      throw new Error('BACKUP_OBJECT_ARCHIVE_SIZE_INVALID');
    let remaining = size;
    while (remaining > 0) {
      if (this.buffered.length === 0) await this.readNext();
      if (this.buffered.length === 0) throw new Error('BACKUP_OBJECT_ARCHIVE_TRUNCATED');
      const take = Math.min(remaining, this.buffered.length);
      const chunk = this.buffered.subarray(0, take);
      this.buffered = this.buffered.subarray(take);
      remaining -= take;
      yield chunk;
    }
  }

  async assertEnd(): Promise<void> {
    if (this.buffered.length > 0) throw new Error('BACKUP_OBJECT_ARCHIVE_TRAILING_DATA');
    if (!this.ended) await this.readNext();
    if (this.buffered.length > 0) throw new Error('BACKUP_OBJECT_ARCHIVE_TRAILING_DATA');
    if (!this.ended) throw new Error('BACKUP_OBJECT_ARCHIVE_TRAILING_DATA');
  }

  private async readNext(): Promise<void> {
    if (this.ended) return;
    const next = await this.iterator.next();
    if (next.done) {
      this.ended = true;
      return;
    }
    const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
    this.buffered = this.buffered.length ? Buffer.concat([this.buffered, chunk]) : chunk;
  }
}

function parseManifest(bytes: Buffer, expectedSourceBucket: string): ObjectStorageBackupManifest {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
  }
  if (!value || typeof value !== 'object') throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
  const manifest = value as Record<string, unknown>;
  const format = manifest['format'];
  const sourceBucket = manifest['sourceBucket'];
  const createdAt = manifest['createdAt'];
  const rawObjects = manifest['objects'];
  if (
    (format !== 'vista-object-store-backup-v1' &&
      format !== 'vista-object-store-backup-v2' &&
      format !== 'vista-object-store-backup-v3') ||
    sourceBucket !== expectedSourceBucket ||
    typeof createdAt !== 'string' ||
    !Number.isFinite(Date.parse(createdAt)) ||
    !Array.isArray(rawObjects) ||
    rawObjects.length > objectCountLimit
  ) {
    throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
  }
  const isLegacy = format === 'vista-object-store-backup-v1';
  const isBlockArchive = format === 'vista-object-store-backup-v3';
  const rawBackupType = manifest['backupType'];
  let backupType: ObjectStorageBackupMode | undefined;
  if (!isLegacy) {
    if (
      rawBackupType !== 'full' &&
      rawBackupType !== 'incremental' &&
      rawBackupType !== 'differential'
    ) {
      throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
    }
    backupType = rawBackupType;
  }
  const rawDeletedKeys = manifest['deletedKeys'];
  const deletedKeys: string[] = [];
  if (!isLegacy) {
    if (!Array.isArray(rawDeletedKeys)) throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
    for (const key of rawDeletedKeys) {
      if (typeof key !== 'string') throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
      deletedKeys.push(key);
    }
  }
  const seen = new Set<string>();
  let totalBytes = 0;
  const objects: BackupFileObject[] = [];
  for (const rawObject of rawObjects) {
    if (!rawObject || typeof rawObject !== 'object' || Array.isArray(rawObject)) {
      throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
    }
    const object = rawObject as Record<string, unknown>;
    const key = object['key'];
    const size = object['size'];
    if (typeof key !== 'string' || !Number.isSafeInteger(size) || (size as number) < 0) {
      throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
    }
    validateKey(key);
    if (seen.has(key)) throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
    seen.add(key);
    const optionalString = (field: string): string | undefined => {
      const entry = object[field];
      if (entry !== undefined && typeof entry !== 'string') {
        throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
      }
      return entry;
    };
    const etag = optionalString('etag');
    const cacheControl = optionalString('cacheControl');
    const contentDisposition = optionalString('contentDisposition');
    const contentEncoding = optionalString('contentEncoding');
    const contentLanguage = optionalString('contentLanguage');
    const contentType = optionalString('contentType');
    const expires = optionalString('expires');
    const contentReference = optionalString('contentReference');
    let blocks: BackupObjectBlock[] | undefined;
    if (isBlockArchive) {
      const rawBlocks = object['blocks'];
      if (!Array.isArray(rawBlocks) || rawBlocks.length > chunkCountLimit) {
        throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
      }
      blocks = rawBlocks.map((rawBlock) => parseBlockDescriptor(rawBlock));
      const describedSize = blocks.reduce((sum, block) => sum + block.size, 0);
      if (!Number.isSafeInteger(describedSize) || describedSize !== size) {
        throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
      }
    }
    if (expires !== undefined && !Number.isFinite(Date.parse(expires))) {
      throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
    }
    const rawMetadata = object['metadata'];
    let metadata: Record<string, string> | undefined;
    if (rawMetadata !== undefined) {
      if (!rawMetadata || typeof rawMetadata !== 'object' || Array.isArray(rawMetadata)) {
        throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
      }
      const entries = Object.entries(rawMetadata);
      if (entries.some(([, entry]) => typeof entry !== 'string')) {
        throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
      }
      metadata = Object.fromEntries(entries);
    }
    const rawContentIncluded = object['contentIncluded'];
    const rawSha256 = object['sha256'];
    if (
      !isLegacy &&
      (typeof rawContentIncluded !== 'boolean' ||
        typeof rawSha256 !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(rawSha256))
    ) {
      throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
    }
    objects.push({
      ...(cacheControl !== undefined ? { cacheControl } : {}),
      ...(contentDisposition !== undefined ? { contentDisposition } : {}),
      ...(contentEncoding !== undefined ? { contentEncoding } : {}),
      ...(contentLanguage !== undefined ? { contentLanguage } : {}),
      ...(contentType !== undefined ? { contentType } : {}),
      contentIncluded: isLegacy ? true : (rawContentIncluded as boolean),
      ...(contentReference !== undefined ? { contentReference } : {}),
      ...(blocks !== undefined ? { blocks } : {}),
      ...(etag !== undefined ? { etag } : {}),
      ...(expires !== undefined ? { expires } : {}),
      key,
      ...(metadata ? { metadata } : {}),
      ...(typeof rawSha256 === 'string' ? { sha256: rawSha256 } : {}),
      size: size as number,
    });
    totalBytes += size as number;
    if (!Number.isSafeInteger(totalBytes)) throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
  }
  let chunks: BackupArchiveBlock[] | undefined;
  if (isBlockArchive) {
    const rawChunks = manifest['chunks'];
    if (!Array.isArray(rawChunks) || rawChunks.length > chunkCountLimit) {
      throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
    }
    const seenChunks = new Set<string>();
    chunks = rawChunks.map((rawChunk) => {
      if (!rawChunk || typeof rawChunk !== 'object' || Array.isArray(rawChunk)) {
        throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
      }
      const record = rawChunk as Record<string, unknown>;
      const descriptor = parseBlockDescriptor(record);
      const contentIncluded = record['contentIncluded'];
      const fingerprint = blockFingerprint(descriptor);
      if (
        typeof contentIncluded !== 'boolean' ||
        seenChunks.has(fingerprint) ||
        (backupType === 'full' && !contentIncluded)
      ) {
        throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
      }
      seenChunks.add(fingerprint);
      return { ...descriptor, contentIncluded };
    });
    const referencedChunks = new Set(
      objects.flatMap((object) => (object.blocks ?? []).map(blockFingerprint)),
    );
    if (
      referencedChunks.size !== chunks.length ||
      chunks.some((chunk) => !referencedChunks.has(blockFingerprint(chunk)))
    ) {
      throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
    }
    for (const object of objects) {
      if ((object.blocks ?? []).some((block) => !seenChunks.has(blockFingerprint(block)))) {
        throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
      }
    }
  }
  const objectsByKey = new Map(objects.map((object) => [object.key, object]));
  for (const object of objects) {
    if (!object.contentReference) continue;
    validateKey(object.contentReference);
    const target = objectsByKey.get(object.contentReference);
    if (
      object.contentIncluded ||
      (target &&
        (target.size !== object.size ||
          target.sha256 !== object.sha256 ||
          (backupType === 'full' && !target.contentIncluded))) ||
      (!target && backupType === 'full')
    ) {
      throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
    }
  }
  if (
    new Set(deletedKeys).size !== deletedKeys.length ||
    deletedKeys.some((key) => {
      validateKey(key);
      return seen.has(key);
    }) ||
    (backupType === 'full' &&
      (deletedKeys.length > 0 ||
        objects.some((object) => !object.contentIncluded && !object.contentReference)))
  ) {
    throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
  }
  return {
    backupType: backupType ?? 'full',
    createdAt,
    deletedKeys,
    format,
    ...(chunks !== undefined ? { chunks } : {}),
    objects,
    sourceBucket,
  };
}

function parseBlockDescriptor(value: unknown): BackupObjectBlock {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
  }
  const descriptor = value as Record<string, unknown>;
  const sha256Value = descriptor['sha256'];
  const size = descriptor['size'];
  if (
    typeof sha256Value !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(sha256Value) ||
    !Number.isSafeInteger(size) ||
    (size as number) <= 0 ||
    (size as number) > chunkSizeBytes
  ) {
    throw new Error('BACKUP_OBJECT_MANIFEST_INVALID');
  }
  return { sha256: sha256Value, size: size as number };
}

function validateKey(key: string): void {
  if (
    key.length === 0 ||
    key.startsWith('/') ||
    Buffer.byteLength(key, 'utf8') > 1024 ||
    key.includes('\u0000') ||
    key.includes('\\') ||
    key.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new Error('BACKUP_OBJECT_KEY_INVALID');
  }
}
