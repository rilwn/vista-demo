import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { hasPermission } from '@vista/auth';
import type { AppEnvironment } from '@vista/config';
import type {
  ManagedFile,
  ManagedFilePage,
  ManagedFileParentType,
  ManagedFileStatus,
} from '@vista/contracts';
import type { Pool, PoolClient } from 'pg';

import { AuditService } from '../audit/audit.service.js';
import type {
  AuthenticationContext,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';
import { StructuredLogger } from '../logging/structured-logger.service.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import type { ManagedFileListQueryDto, ManagedFileUploadDto } from './files.dto.js';

export interface ManagedFileUpload {
  buffer: Buffer;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
}

export interface ManagedFileContent {
  buffer: Buffer;
  fileName: string;
  mediaType: string;
}

interface FileRow {
  bucket: string;
  byte_size: string;
  checksum_sha256: string;
  created_at: Date | string;
  id: string;
  inspection_method: string | null;
  is_current: boolean;
  issuer_account_id: string;
  media_type: string;
  original_name: string;
  parent_id: string;
  parent_type: ManagedFileParentType;
  scanned_at: Date | string | null;
  status: ManagedFileStatus;
  storage_key: string;
  version: number;
  version_count: string;
  version_group_id: string;
}

interface StoredFileRow extends FileRow {
  replaces_object_id: string | null;
}

interface IdempotencyRow {
  request_hash: string;
  response_body: unknown;
  status: string;
}

interface NormalizedUpload {
  buffer: Buffer;
  checksumSha256: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
}

interface VersionTarget {
  parentId: string;
  parentType: ManagedFileParentType;
  replacesObjectId?: string;
  version: number;
  versionGroupId: string;
}

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

@Injectable()
export class FilesService {
  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ObjectStorageService) private readonly storage: ObjectStorageService,
    @Inject(StructuredLogger) private readonly logger: StructuredLogger,
  ) {}

  async list(
    query: ManagedFileListQueryDto,
    auth: AuthenticationContext,
  ): Promise<ManagedFilePage> {
    const pool = this.database.getPool();
    await this.authorizeParent(pool, query.parentType, query.parentId, 'view', auth);
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 20);
    const offset = (page - 1) * pageSize;
    const [countResult, filesResult] = await Promise.all([
      pool.query<{ total: string }>(
        `SELECT count(DISTINCT version_group_id)::text AS total
         FROM files.objects
         WHERE parent_type = $1 AND parent_id = $2 AND status <> 'deleted'`,
        [query.parentType, query.parentId],
      ),
      pool.query<FileRow>(
        `WITH ranked AS (
           SELECT object.*,
                  count(*) OVER (PARTITION BY version_group_id)::text AS version_count,
                  row_number() OVER (
                    PARTITION BY version_group_id ORDER BY version DESC, created_at DESC, id DESC
                  ) = 1 AS is_current
           FROM files.objects object
           WHERE parent_type = $1 AND parent_id = $2 AND status <> 'deleted'
         )
         SELECT * FROM ranked
         WHERE is_current = true
         ORDER BY created_at DESC, id DESC
         LIMIT $3 OFFSET $4`,
        [query.parentType, query.parentId, pageSize, offset],
      ),
    ]);
    const total = Number(countResult.rows[0]?.total ?? 0);
    return {
      items: filesResult.rows.map(mapFile),
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }

  async versions(id: string, auth: AuthenticationContext): Promise<ManagedFile[]> {
    const pool = this.database.getPool();
    const file = await this.findFile(pool, id);
    await this.authorizeParent(pool, file.parent_type, file.parent_id, 'view', auth);
    const result = await pool.query<FileRow>(
      `SELECT object.*,
              count(*) OVER (PARTITION BY version_group_id)::text AS version_count,
              version = max(version) OVER (PARTITION BY version_group_id) AS is_current
       FROM files.objects object
       WHERE version_group_id = $1 AND status <> 'deleted'
       ORDER BY version DESC, created_at DESC`,
      [file.version_group_id],
    );
    return result.rows.map(mapFile);
  }

  async content(id: string, auth: AuthenticationContext): Promise<ManagedFileContent> {
    const pool = this.database.getPool();
    const file = await this.findFile(pool, id);
    await this.authorizeParent(pool, file.parent_type, file.parent_id, 'view', auth);
    if (file.status !== 'available') {
      throw new ApiErrorException(
        'FILE_NOT_AVAILABLE',
        'This file is not available for download.',
        HttpStatus.CONFLICT,
      );
    }
    let buffer: Buffer;
    try {
      buffer = await this.storage.getObject(file.storage_key);
    } catch {
      throw new ApiErrorException(
        'FILE_CONTENT_UNAVAILABLE',
        'The stored file could not be retrieved.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const checksum = createHash('sha256').update(buffer).digest('hex');
    if (buffer.length !== Number(file.byte_size) || checksum !== file.checksum_sha256) {
      this.logger.event('error', 'files.content.integrity_failed', {
        fileId: file.id,
        parentId: file.parent_id,
        parentType: file.parent_type,
      });
      throw new ApiErrorException(
        'FILE_CONTENT_INTEGRITY_FAILED',
        'The stored file did not pass integrity verification.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { buffer, fileName: file.original_name, mediaType: file.media_type };
  }

  upload(
    input: ManagedFileUploadDto,
    file: ManagedFileUpload,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<ManagedFile> {
    const versionGroupId = randomUUID();
    return this.writeFile(
      `files.create:${input.parentType}:${input.parentId}`,
      key,
      file,
      { parentId: input.parentId, parentType: input.parentType },
      auth,
      metadata,
      async (client) => {
        await this.authorizeParent(client, input.parentType, input.parentId, 'edit', auth);
        return {
          parentId: input.parentId,
          parentType: input.parentType,
          version: 1,
          versionGroupId,
        };
      },
    );
  }

  uploadVersion(
    id: string,
    file: ManagedFileUpload,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<ManagedFile> {
    return this.writeFile(
      `files.version:${id}`,
      key,
      file,
      { replacesFileId: id },
      auth,
      metadata,
      async (client) => {
        const base = await this.findFile(client, id);
        await this.authorizeParent(client, base.parent_type, base.parent_id, 'edit', auth);
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [base.version_group_id]);
        const latest = await client.query<{ id: string; version: number }>(
          `SELECT id, version FROM files.objects
           WHERE version_group_id = $1
           ORDER BY version DESC, created_at DESC, id DESC
           LIMIT 1 FOR UPDATE`,
          [base.version_group_id],
        );
        const current = latest.rows[0];
        if (!current) throw fileNotFound();
        return {
          parentId: base.parent_id,
          parentType: base.parent_type,
          replacesObjectId: current.id,
          version: current.version + 1,
          versionGroupId: base.version_group_id,
        };
      },
    );
  }

  private async writeFile(
    scope: string,
    key: string | undefined,
    upload: ManagedFileUpload,
    requestIdentity: object,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    target: (client: PoolClient) => Promise<VersionTarget>,
  ): Promise<ManagedFile> {
    const normalized = this.normalizeUpload(upload);
    const idempotencyKey = validKey(key);
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          ...requestIdentity,
          checksumSha256: normalized.checksumSha256,
          fileName: normalized.fileName,
          mediaType: normalized.mediaType,
          sizeBytes: normalized.sizeBytes,
        }),
      )
      .digest('hex');
    const client = await this.database.getPool().connect();
    let uploadedStorageKey: string | undefined;
    let committed = false;
    try {
      await client.query('BEGIN');
      const replay = await claim(
        client,
        scope,
        idempotencyKey,
        hash,
        this.environment.IDEMPOTENCY_TTL_SECONDS,
      );
      if (replay) {
        await client.query('COMMIT');
        committed = true;
        return replay;
      }
      const versionTarget = await target(client);
      const id = randomUUID();
      const storageKey = storageKeyFor(id, versionTarget);
      await this.storage.putObject({
        body: normalized.buffer,
        checksumSha256: normalized.checksumSha256,
        key: storageKey,
        mediaType: normalized.mediaType,
      });
      uploadedStorageKey = storageKey;
      await client.query(
        `INSERT INTO files.objects (
           id, parent_type, parent_id, storage_key, bucket, original_name, media_type,
           byte_size, checksum_sha256, version, version_group_id, replaces_object_id,
           status, issuer_account_id, scanned_at, inspection_method
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                   'available', $13, now(), 'structural-signature')`,
        [
          id,
          versionTarget.parentType,
          versionTarget.parentId,
          storageKey,
          this.storage.bucketName(),
          normalized.fileName,
          normalized.mediaType,
          normalized.sizeBytes,
          normalized.checksumSha256,
          versionTarget.version,
          versionTarget.versionGroupId,
          versionTarget.replacesObjectId ?? null,
          auth.accountId,
        ],
      );
      const result = await this.findFile(client, id);
      const eventType =
        versionTarget.version === 1 ? 'files.object.created' : 'files.object.version_created';
      await this.appendSideEffects(client, result, eventType, idempotencyKey, auth, metadata);
      const response = mapFile(result);
      await client.query(
        `UPDATE platform.idempotency_keys
         SET status = 'completed', response_status = 201, response_body = $3
         WHERE scope = $1 AND idempotency_key = $2`,
        [scope, idempotencyKey, response],
      );
      await client.query('COMMIT');
      committed = true;
      return response;
    } catch (error) {
      if (!committed) await client.query('ROLLBACK');
      if (uploadedStorageKey && !committed) await this.cleanupOrphan(uploadedStorageKey);
      throw error;
    } finally {
      client.release();
    }
  }

  private normalizeUpload(input: ManagedFileUpload): NormalizedUpload {
    const mediaType = input.mediaType.trim().toLowerCase();
    if (!this.environment.FILE_ALLOWED_MEDIA_TYPES.includes(mediaType)) {
      throw new ApiErrorException(
        'FILE_TYPE_NOT_ALLOWED',
        'Upload a PDF, JPEG, PNG, or WebP file.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (
      !Buffer.isBuffer(input.buffer) ||
      input.buffer.length < 1 ||
      input.buffer.length > this.environment.FILE_UPLOAD_MAX_BYTES ||
      input.sizeBytes !== input.buffer.length
    ) {
      throw new ApiErrorException(
        'FILE_SIZE_INVALID',
        `The file must be between 1 byte and ${formatMegabytes(this.environment.FILE_UPLOAD_MAX_BYTES)} MB.`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!matchesDeclaredType(mediaType, input.buffer)) {
      throw new ApiErrorException(
        'FILE_CONTENT_TYPE_MISMATCH',
        'The file content does not match its declared type.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const fileName = basename(input.fileName.trim().replaceAll('\\', '/'));
    if (!fileName || fileName.length > 255 || containsControlCharacter(fileName)) {
      throw new ApiErrorException(
        'FILE_NAME_INVALID',
        'The file name is invalid or too long.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return {
      buffer: input.buffer,
      checksumSha256: createHash('sha256').update(input.buffer).digest('hex'),
      fileName,
      mediaType,
      sizeBytes: input.buffer.length,
    };
  }

  private async findFile(queryable: Queryable, id: string): Promise<StoredFileRow> {
    const result = await queryable.query<StoredFileRow>(
      `SELECT * FROM (${fileSelect}) ranked_file WHERE id = $1`,
      [id],
    );
    const file = result.rows[0];
    if (!file) throw fileNotFound();
    return file;
  }

  private async authorizeParent(
    queryable: Queryable,
    parentType: ManagedFileParentType,
    parentId: string,
    action: 'edit' | 'view',
    auth: AuthenticationContext,
  ): Promise<void> {
    const module = parentType === 'warranty_claim' ? 'erp.service' : 'crm';
    if (!hasPermission(auth.permissions, { action, module })) {
      throw new ApiErrorException(
        'FILE_PARENT_ACCESS_DENIED',
        'You do not have access to files for this record.',
        HttpStatus.FORBIDDEN,
      );
    }
    let parent;
    if (parentType === 'partner') {
      parent = await queryable.query<{ id: string }>(
        'SELECT id FROM master_data.partners WHERE id = $1',
        [parentId],
      );
    } else if (parentType === 'crm_interaction') {
      parent = await queryable.query<{ id: string }>(
        'SELECT id FROM crm.interactions WHERE id = $1',
        [parentId],
      );
    } else {
      parent = await queryable.query<{ id: string }>(
        `SELECT claim.id
             FROM service.warranty_claims claim
             LEFT JOIN service.requests request ON request.id = claim.service_request_id
             LEFT JOIN service.work_orders work_order ON work_order.service_request_id = request.id
             WHERE claim.id = $1
               AND ($2::boolean OR work_order.assigned_technician_account_id = $3)`,
        [
          parentId,
          hasPermission(auth.permissions, { action: 'approve', module: 'erp.service' }),
          auth.accountId,
        ],
      );
    }
    if (!parent.rows[0]) {
      throw new ApiErrorException(
        'FILE_PARENT_NOT_FOUND',
        'The related record was not found or is not available to your account.',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private async appendSideEffects(
    client: PoolClient,
    file: StoredFileRow,
    eventType: string,
    idempotencyKey: string,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<void> {
    const after = mapFile(file);
    await client.query(
      `INSERT INTO integration.outbox_events (
         id, aggregate_type, aggregate_id, event_type, event_version,
         correlation_id, idempotency_key, payload
       ) VALUES ($1, 'file_object', $2, $3, 1, $4, $5, $6)`,
      [
        randomUUID(),
        file.id,
        eventType,
        metadata.correlationId,
        `${eventType}:${idempotencyKey}`,
        after,
      ],
    );
    await this.audit.append(
      {
        action: eventType,
        actorAccountId: auth.accountId,
        after: after as unknown as Record<string, unknown>,
        correlationId: metadata.correlationId,
        ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
        targetId: file.id,
        targetType: 'file_object',
        ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
      },
      client,
    );
  }

  private async cleanupOrphan(storageKey: string): Promise<void> {
    try {
      await this.storage.deleteObject(storageKey);
    } catch {
      this.logger.event('error', 'files.orphan_cleanup.failed', { storageKey });
    }
  }
}

const fileSelect = `
  SELECT object.id, object.parent_type, object.parent_id, object.storage_key, object.bucket,
         object.original_name, object.media_type, object.byte_size::text, object.checksum_sha256,
         object.version, object.status, object.issuer_account_id, object.created_at, object.scanned_at,
         object.version_group_id, object.replaces_object_id, object.inspection_method,
         count(*) OVER (PARTITION BY object.version_group_id)::text AS version_count,
         object.version = max(object.version) OVER (PARTITION BY object.version_group_id) AS is_current
  FROM files.objects object`;

function mapFile(row: FileRow): ManagedFile {
  return {
    byteSize: Number(row.byte_size),
    checksumSha256: row.checksum_sha256,
    createdAt: iso(row.created_at),
    id: row.id,
    ...(row.inspection_method ? { inspectionMethod: row.inspection_method } : {}),
    isCurrent: row.is_current,
    issuerAccountId: row.issuer_account_id,
    mediaType: row.media_type,
    originalName: row.original_name,
    parentId: row.parent_id,
    parentType: row.parent_type,
    ...(row.scanned_at ? { scannedAt: iso(row.scanned_at) } : {}),
    status: row.status,
    version: row.version,
    versionCount: Number(row.version_count),
    versionGroupId: row.version_group_id,
  };
}

async function claim(
  client: PoolClient,
  scope: string,
  key: string,
  hash: string,
  ttlSeconds: number,
): Promise<ManagedFile | undefined> {
  const inserted = await client.query(
    `INSERT INTO platform.idempotency_keys (
       scope, idempotency_key, request_hash, status, expires_at
     ) VALUES ($1, $2, $3, 'processing', now() + make_interval(secs => $4))
     ON CONFLICT DO NOTHING RETURNING idempotency_key`,
    [scope, key, hash, ttlSeconds],
  );
  if (inserted.rowCount === 1) return undefined;
  const existing = await client.query<IdempotencyRow>(
    `SELECT request_hash, response_body, status
     FROM platform.idempotency_keys
     WHERE scope = $1 AND idempotency_key = $2
     FOR UPDATE`,
    [scope, key],
  );
  const row = existing.rows[0];
  if (row?.request_hash === hash && row.status === 'completed' && row.response_body) {
    return row.response_body as ManagedFile;
  }
  throw new ApiErrorException(
    'IDEMPOTENCY_KEY_REUSED',
    'The idempotency key was already used for another file operation.',
    HttpStatus.CONFLICT,
  );
}

function validKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length < 8 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/u.test(key)) {
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_INVALID',
      'Provide a stable idempotency key containing 8 to 128 safe characters.',
      HttpStatus.BAD_REQUEST,
    );
  }
  return key;
}

function matchesDeclaredType(mediaType: string, buffer: Buffer): boolean {
  if (mediaType === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mediaType === 'image/jpeg')
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mediaType === 'image/png')
    return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mediaType === 'image/webp')
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  return false;
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function storageKeyFor(id: string, target: VersionTarget): string {
  return `managed/${target.parentType}/${target.parentId}/${target.versionGroupId}/v${target.version}/${id}`;
}

function fileNotFound(): ApiErrorException {
  return new ApiErrorException(
    'FILE_NOT_FOUND',
    'The file record was not found.',
    HttpStatus.NOT_FOUND,
  );
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1);
}
