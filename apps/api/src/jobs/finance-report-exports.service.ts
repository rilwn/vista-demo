import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  FinanceReportDefinition,
  FinanceReportDefinitionKey,
  FinanceReportExport,
  FinanceReportExportPage,
  ReportExportFormat,
  ReportExportStatus,
  ServiceReportDefinition,
  ServiceReportDefinitionKey,
  ServiceReportExport,
  ServiceReportExportPage,
} from '@vista/contracts';
import { UnrecoverableError } from 'bullmq';

import { AuditService } from '../audit/audit.service.js';
import type {
  AuthenticationContext,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { DatabaseService } from '../database/database.service.js';
import { FinanceReportsService } from '../finance/finance-reports.service.js';
import { StructuredLogger } from '../logging/structured-logger.service.js';
import { ServiceReportsService } from '../service/service-reports.service.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import type { BackgroundJobContext } from './job-handler-registry.service.js';
import { JobQueueService } from './job-queue.service.js';
import type {
  CreateFinanceReportExportDto,
  FinanceReportExportPageQueryDto,
} from './finance-report-exports.dto.js';
import { renderFinanceReport } from './finance-report-renderer.js';

type ReportDefinitionKey = FinanceReportDefinitionKey | ServiceReportDefinitionKey;
type AnyReportDefinition = FinanceReportDefinition | ServiceReportDefinition;
type AnyReportExport = FinanceReportExport | ServiceReportExport;
interface AnyReportExportPage {
  items: AnyReportExport[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
interface ReportExportRequest {
  dateFrom?: string;
  dateTo?: string;
  definitionKey: ReportDefinitionKey;
  format: ReportExportFormat;
}
type ReportScope = 'finance' | 'service';

interface DefinitionRow {
  available_formats: ReportExportFormat[];
  definition_key: ReportDefinitionKey;
  description: string;
  id: string;
  implementation_key: string;
  name: string;
}

interface ExportRow extends DefinitionRow {
  attempt_count: number;
  byte_size: string | null;
  checksum_sha256: string | null;
  completed_at: Date | string | null;
  correlation_id: string;
  error_code: string | null;
  export_format: ReportExportFormat;
  file_name: string | null;
  filters: { dateFrom?: string; dateTo?: string };
  id: string;
  media_type: string | null;
  queue_job_id: string | null;
  requested_at: Date | string;
  requested_by: string;
  request_hash: string;
  row_count: number | null;
  status: ReportExportStatus;
  storage_key: string | null;
}

export interface FinanceReportExportContent {
  buffer: Buffer;
  fileName: string;
  mediaType: string;
}

@Injectable()
export class FinanceReportExportsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FinanceReportsService) private readonly reports: FinanceReportsService,
    @Inject(ServiceReportsService) private readonly serviceReports: ServiceReportsService,
    @Inject(JobQueueService) private readonly jobs: JobQueueService,
    @Inject(ObjectStorageService) private readonly storage: ObjectStorageService,
    @Inject(StructuredLogger) private readonly logger: StructuredLogger,
  ) {}

  async definitions(): Promise<FinanceReportDefinition[]> {
    const result = await this.database.getPool().query<DefinitionRow>(
      `SELECT id, definition_key, name, description, implementation_key, available_formats
       FROM reporting.report_definitions
       WHERE is_active = true AND definition_key LIKE 'finance.%'
       ORDER BY name, definition_key`,
    );
    return result.rows.map(mapDefinition) as FinanceReportDefinition[];
  }

  async serviceDefinitions(): Promise<ServiceReportDefinition[]> {
    const result = await this.database.getPool().query<DefinitionRow>(
      `SELECT id, definition_key, name, description, implementation_key, available_formats
       FROM reporting.report_definitions
       WHERE is_active = true AND definition_key LIKE 'service.%'
       ORDER BY name, definition_key`,
    );
    return result.rows.map(mapDefinition) as ServiceReportDefinition[];
  }

  async list(
    query: FinanceReportExportPageQueryDto,
    auth: AuthenticationContext,
  ): Promise<FinanceReportExportPage> {
    return this.listForScope(query, auth, 'finance') as Promise<FinanceReportExportPage>;
  }

  async serviceList(
    query: FinanceReportExportPageQueryDto,
    auth: AuthenticationContext,
  ): Promise<ServiceReportExportPage> {
    return this.listForScope(query, auth, 'service') as Promise<ServiceReportExportPage>;
  }

  private async listForScope(
    query: FinanceReportExportPageQueryDto,
    auth: AuthenticationContext,
    scope: ReportScope,
  ): Promise<AnyReportExportPage> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;
    const [count, rows] = await Promise.all([
      this.database.getPool().query<{ total: string }>(
        `SELECT count(*)::text AS total
           FROM reporting.export_jobs export
           JOIN reporting.report_definitions definition
             ON definition.id = export.report_definition_id
           WHERE export.requested_by = $1 AND definition.definition_key LIKE $2`,
        [auth.accountId, `${scope}.%`],
      ),
      this.database.getPool().query<ExportRow>(
        `${exportSelect()}
         WHERE export.requested_by = $1 AND definition.definition_key LIKE $2
         ORDER BY export.requested_at DESC, export.id DESC
         LIMIT $3 OFFSET $4`,
        [auth.accountId, `${scope}.%`, pageSize, offset],
      ),
    ]);
    const total = Number(count.rows[0]?.total ?? 0);
    return {
      items: rows.rows.map(mapExport),
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }

  async create(
    input: CreateFinanceReportExportDto,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<FinanceReportExport> {
    return this.createForScope(
      input,
      key,
      auth,
      metadata,
      'finance',
    ) as Promise<FinanceReportExport>;
  }

  async serviceCreate(
    input: ReportExportRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<ServiceReportExport> {
    return this.createForScope(
      input,
      key,
      auth,
      metadata,
      'service',
    ) as Promise<ServiceReportExport>;
  }

  private async createForScope(
    input: ReportExportRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    scope: ReportScope,
  ): Promise<AnyReportExport> {
    const idempotencyKey = validIdempotencyKey(key);
    const definition = await this.definition(input.definitionKey, scope);
    if (!definition.available_formats.includes(input.format)) {
      throw new ApiErrorException(
        'REPORT_EXPORT_FORMAT_NOT_AVAILABLE',
        'Choose one of the available file formats for this report.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const filters = reportFilters(input, definition.definition_key);
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          definitionKey: definition.definition_key,
          filters,
          format: input.format,
        }),
      )
      .digest('hex');
    const id = randomUUID();
    const client = await this.database.getPool().connect();
    let exportId: string = id;
    let shouldDispatch = true;
    try {
      await client.query('BEGIN');
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO reporting.export_jobs (
           id, report_definition_id, requested_by, export_format, filters,
           request_idempotency_key, request_hash, correlation_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (requested_by, request_idempotency_key) DO NOTHING
         RETURNING id`,
        [
          id,
          definition.id,
          auth.accountId,
          input.format,
          filters,
          idempotencyKey,
          requestHash,
          metadata.correlationId,
        ],
      );
      if (!inserted.rowCount) {
        const existing = await client.query<Pick<ExportRow, 'id' | 'request_hash' | 'status'>>(
          `SELECT id, request_hash, status
           FROM reporting.export_jobs
           WHERE requested_by = $1 AND request_idempotency_key = $2
           FOR UPDATE`,
          [auth.accountId, idempotencyKey],
        );
        const replay = existing.rows[0];
        if (!replay) throw new Error('Report export idempotency lookup failed');
        if (replay.request_hash !== requestHash) {
          throw new ApiErrorException(
            'IDEMPOTENCY_KEY_REUSED',
            'This request key was already used for a different report.',
            HttpStatus.CONFLICT,
          );
        }
        exportId = replay.id;
        shouldDispatch = replay.status !== 'completed';
      } else {
        await this.audit.append(
          {
            action: 'report.export.requested',
            actorAccountId: auth.accountId,
            after: {
              definitionKey: definition.definition_key,
              filters,
              format: input.format,
              status: 'queued',
            },
            correlationId: metadata.correlationId,
            ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
            targetId: id,
            targetType: 'report_export',
            ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
          },
          client,
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    if (shouldDispatch) await this.dispatch(exportId);
    return mapExport(await this.ownedExportRow(exportId, auth.accountId, scope));
  }

  async retry(
    id: string,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<FinanceReportExport> {
    return this.retryForScope(id, auth, metadata, 'finance') as Promise<FinanceReportExport>;
  }

  async serviceRetry(
    id: string,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<ServiceReportExport> {
    return this.retryForScope(id, auth, metadata, 'service') as Promise<ServiceReportExport>;
  }

  private async retryForScope(
    id: string,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    scope: ReportScope,
  ): Promise<AnyReportExport> {
    const row = await this.ownedExportRow(id, auth.accountId, scope);
    if (row.status !== 'failed') {
      throw new ApiErrorException(
        'REPORT_EXPORT_NOT_FAILED',
        'Only an unsuccessful export can be tried again.',
        HttpStatus.CONFLICT,
      );
    }
    await this.database.getPool().query(
      `UPDATE reporting.export_jobs
         SET status = 'queued', error_code = NULL, updated_at = now()
         WHERE id = $1 AND requested_by = $2`,
      [id, auth.accountId],
    );
    const retried = row.queue_job_id ? await this.jobs.retryFailed(row.queue_job_id) : false;
    if (!retried) {
      if (row.queue_job_id) await this.jobs.remove(row.queue_job_id).catch(() => false);
      await this.database.getPool().query(
        `UPDATE reporting.export_jobs
           SET queue_job_id = NULL, status = 'queued', error_code = NULL, updated_at = now()
           WHERE id = $1 AND requested_by = $2`,
        [id, auth.accountId],
      );
      await this.dispatch(id);
    }
    await this.audit.append({
      action: 'report.export.retried',
      actorAccountId: auth.accountId,
      correlationId: metadata.correlationId,
      ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
      targetId: id,
      targetType: 'report_export',
      ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
    });
    return mapExport(await this.ownedExportRow(id, auth.accountId, scope));
  }

  async content(
    id: string,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<FinanceReportExportContent> {
    return this.contentForScope(id, auth, metadata, 'finance');
  }

  serviceContent(
    id: string,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<FinanceReportExportContent> {
    return this.contentForScope(id, auth, metadata, 'service');
  }

  private async contentForScope(
    id: string,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    scope: ReportScope,
  ): Promise<FinanceReportExportContent> {
    const row = await this.ownedExportRow(id, auth.accountId, scope);
    if (
      row.status !== 'completed' ||
      !row.storage_key ||
      !row.file_name ||
      !row.media_type ||
      !row.checksum_sha256 ||
      row.byte_size === null
    ) {
      throw new ApiErrorException(
        'REPORT_EXPORT_NOT_READY',
        'This export is not ready to download.',
        HttpStatus.CONFLICT,
      );
    }
    let buffer: Buffer;
    try {
      buffer = await this.storage.getObject(row.storage_key);
    } catch {
      throw new ApiErrorException(
        'REPORT_EXPORT_FILE_UNAVAILABLE',
        'The export file could not be retrieved.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const checksum = createHash('sha256').update(buffer).digest('hex');
    if (buffer.length !== Number(row.byte_size) || checksum !== row.checksum_sha256) {
      this.logger.event('error', 'report.export.integrity_failed', { exportId: id });
      throw new ApiErrorException(
        'REPORT_EXPORT_INTEGRITY_FAILED',
        'The export file did not pass its integrity check.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    await this.audit.append({
      action: 'report.export.downloaded',
      actorAccountId: auth.accountId,
      correlationId: metadata.correlationId,
      ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
      targetId: id,
      targetType: 'report_export',
      ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
    });
    return { buffer, fileName: row.file_name, mediaType: row.media_type };
  }

  async dispatchPending(limit = 25): Promise<number> {
    const result = await this.database.getPool().query<{ id: string }>(
      `SELECT id FROM reporting.export_jobs
       WHERE status = 'queued'
       ORDER BY requested_at, id
       LIMIT $1`,
      [limit],
    );
    let dispatched = 0;
    for (const row of result.rows) {
      if (await this.dispatch(row.id)) dispatched += 1;
    }
    return dispatched;
  }

  async generate(context: BackgroundJobContext): Promise<{ exportId: string; rowCount: number }> {
    const exportId = context.payload['exportId'];
    if (typeof exportId !== 'string' || !uuidPattern.test(exportId)) {
      throw new UnrecoverableError('The report export job has no valid export identifier');
    }
    const lock = await this.database.getPool().connect();
    try {
      await lock.query('SELECT pg_advisory_lock(hashtext($1))', [`report-export:${exportId}`]);
      return await this.generateLocked(exportId, context);
    } finally {
      await lock
        .query('SELECT pg_advisory_unlock(hashtext($1))', [`report-export:${exportId}`])
        .catch(() => undefined);
      lock.release();
    }
  }

  private async generateLocked(
    exportId: string,
    context: BackgroundJobContext,
  ): Promise<{ exportId: string; rowCount: number }> {
    const existing = await this.exportRow(exportId);
    if (!existing) throw new UnrecoverableError('The requested report export does not exist');
    if (existing.status === 'completed') {
      return { exportId, rowCount: existing.row_count ?? 0 };
    }
    await this.database.getPool().query(
      `UPDATE reporting.export_jobs
       SET status = 'processing', attempt_count = attempt_count + 1,
           started_at = COALESCE(started_at, now()), error_code = NULL, updated_at = now()
       WHERE id = $1 AND status <> 'completed'`,
      [exportId],
    );
    try {
      const data = existing.definition_key.startsWith('service.')
        ? await this.serviceReports.exportData(
            existing.definition_key as ServiceReportDefinitionKey,
            existing.filters,
          )
        : await this.reports.exportData(
            existing.definition_key as FinanceReportDefinitionKey,
            existing.filters,
          );
      const rendered = await renderFinanceReport(existing.export_format, data);
      const checksum = createHash('sha256').update(rendered.buffer).digest('hex');
      const fileName = exportFileName(
        existing.definition_key,
        existing.requested_at,
        rendered.extension,
      );
      const storageKey = `report-exports/${existing.requested_by}/${exportId}/${fileName}`;
      await this.storage.putObject({
        body: rendered.buffer,
        checksumSha256: checksum,
        key: storageKey,
        mediaType: rendered.mediaType,
      });
      const client = await this.database.getPool().connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE reporting.export_jobs
           SET status = 'completed', file_name = $2, media_type = $3, storage_key = $4,
               checksum_sha256 = $5, byte_size = $6, row_count = $7, error_code = NULL,
               completed_at = now(), updated_at = now()
           WHERE id = $1`,
          [
            exportId,
            fileName,
            rendered.mediaType,
            storageKey,
            checksum,
            rendered.buffer.length,
            data.rows.length,
          ],
        );
        await this.audit.append(
          {
            action: 'report.export.completed',
            actorAccountId: existing.requested_by,
            after: {
              byteSize: rendered.buffer.length,
              fileName,
              rowCount: data.rows.length,
              status: 'completed',
            },
            correlationId: existing.correlation_id,
            targetId: exportId,
            targetType: 'report_export',
          },
          client,
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      return { exportId, rowCount: data.rows.length };
    } catch (error) {
      await this.database.getPool().query(
        `UPDATE reporting.export_jobs
         SET status = $2, error_code = $3, updated_at = now()
         WHERE id = $1 AND status <> 'completed'`,
        [exportId, context.retryAllowed ? 'queued' : 'failed', exportErrorCode(error)],
      );
      throw error;
    }
  }

  private async dispatch(id: string): Promise<boolean> {
    const row = await this.exportRow(id);
    if (!row || row.status === 'completed' || row.status === 'processing') return false;
    try {
      const queued = await this.jobs.enqueue({
        correlationId: row.correlation_id,
        idempotencyKey: `finance-report-export:${row.id}`,
        name: 'report.generate',
        payload: { exportId: row.id },
      });
      await this.database
        .getPool()
        .query(
          `UPDATE reporting.export_jobs SET queue_job_id = $2, updated_at = now() WHERE id = $1`,
          [row.id, queued.jobId],
        );
      return true;
    } catch (error) {
      this.logger.event('error', 'report.export.dispatch_failed', {
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
        exportId: id,
      });
      return false;
    }
  }

  private async definition(key: ReportDefinitionKey, scope: ReportScope): Promise<DefinitionRow> {
    const result = await this.database.getPool().query<DefinitionRow>(
      `SELECT id, definition_key, name, description, implementation_key, available_formats
       FROM reporting.report_definitions
       WHERE definition_key = $1 AND definition_key LIKE $2 AND is_active = true`,
      [key, `${scope}.%`],
    );
    const definition = result.rows[0];
    if (!definition) {
      throw new ApiErrorException(
        'REPORT_NOT_AVAILABLE',
        'This report is not available.',
        HttpStatus.NOT_FOUND,
      );
    }
    return definition;
  }

  private async exportRow(id: string): Promise<ExportRow | undefined> {
    const result = await this.database
      .getPool()
      .query<ExportRow>(`${exportSelect()} WHERE export.id = $1`, [id]);
    return result.rows[0];
  }

  private async ownedExportRow(
    id: string,
    accountId: string,
    scope?: ReportScope,
  ): Promise<ExportRow> {
    const result = await this.database.getPool().query<ExportRow>(
      `${exportSelect()} WHERE export.id = $1 AND export.requested_by = $2
          AND ($3::text IS NULL OR definition.definition_key LIKE $3)`,
      [id, accountId, scope ? `${scope}.%` : null],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiErrorException(
        'REPORT_EXPORT_NOT_FOUND',
        'This report export could not be found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return row;
  }
}

function exportSelect(): string {
  return `SELECT export.id, export.requested_by, export.export_format, export.filters,
                 export.request_hash, export.correlation_id, export.queue_job_id, export.status,
                 export.attempt_count, export.file_name, export.media_type, export.storage_key,
                 export.checksum_sha256, export.byte_size::text, export.row_count, export.error_code,
                 export.requested_at, export.completed_at,
                 definition.definition_key, definition.name, definition.description,
                 definition.implementation_key, definition.available_formats
          FROM reporting.export_jobs export
          JOIN reporting.report_definitions definition ON definition.id = export.report_definition_id`;
}

function mapDefinition(row: DefinitionRow): AnyReportDefinition {
  const mapped = {
    description: row.description,
    formats: row.available_formats,
    key: row.definition_key,
    name: row.name,
    requiresDateRange: dateRangeReportKeys.has(row.definition_key),
  };
  return row.definition_key.startsWith('service.')
    ? (mapped as ServiceReportDefinition)
    : (mapped as FinanceReportDefinition);
}

function mapExport(row: ExportRow): AnyReportExport {
  return {
    attemptCount: row.attempt_count,
    ...(row.completed_at ? { completedAt: asIso(row.completed_at) } : {}),
    createdAt: asIso(row.requested_at),
    definitionKey: row.definition_key,
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.file_name ? { fileName: row.file_name } : {}),
    format: row.export_format,
    id: row.id,
    name: row.name,
    ...(row.row_count === null ? {} : { rowCount: row.row_count }),
    ...(row.byte_size === null ? {} : { sizeBytes: Number(row.byte_size) }),
    status: row.status,
  };
}

function reportFilters(
  input: ReportExportRequest,
  definitionKey: ReportDefinitionKey,
): Record<string, string> {
  const requiresDateRange = dateRangeReportKeys.has(definitionKey);
  if (!requiresDateRange) {
    if (input.dateFrom || input.dateTo) {
      throw new ApiErrorException(
        'REPORT_FILTER_NOT_APPLICABLE',
        'This report uses the current business date and does not need a date range.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return {};
  }
  if (!input.dateFrom || !input.dateTo) {
    throw new ApiErrorException(
      'FINANCE_REPORT_DATE_RANGE_REQUIRED',
      'Choose a start and end date for this report.',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (input.dateFrom > input.dateTo) {
    throw new ApiErrorException(
      'FINANCE_REPORT_DATE_RANGE_INVALID',
      'The start date cannot be after the end date.',
      HttpStatus.BAD_REQUEST,
    );
  }
  return { dateFrom: input.dateFrom, dateTo: input.dateTo };
}

function validIdempotencyKey(value: string | undefined): string {
  if (!value || value.length > 255 || value.trim() !== value) {
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_REQUIRED',
      'A valid request key is required.',
      HttpStatus.BAD_REQUEST,
    );
  }
  return value;
}

function exportFileName(
  definitionKey: ReportDefinitionKey,
  requestedAt: Date | string,
  extension: ReportExportFormat,
): string {
  const report = definitionKey.replace(/^[^.]+\./u, '');
  return `${report}-${asIso(requestedAt).slice(0, 10)}.${extension}`;
}

function exportErrorCode(error: unknown): string {
  if (error instanceof ApiErrorException) {
    const response = error.getResponse();
    if (
      response &&
      typeof response === 'object' &&
      'code' in response &&
      typeof response.code === 'string'
    ) {
      return response.code;
    }
  }
  return error instanceof Error
    ? `REPORT_EXPORT_${error.constructor.name.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`
    : 'REPORT_EXPORT_FAILED';
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const dateRangeReportKeys = new Set<ReportDefinitionKey>([
  'finance.customer-turnover',
  'finance.supplier-turnover',
  'finance.sales-journal',
  'finance.purchase-journal',
  'finance.vat-review',
  'service.request-register',
  'service.technician-performance',
  'service.cost-summary',
]);
