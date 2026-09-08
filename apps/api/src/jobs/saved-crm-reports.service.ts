import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { SavedCrmReport } from '@vista/contracts';
import { AuditService } from '../audit/audit.service.js';
import type {
  AuthenticationContext,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { DatabaseService } from '../database/database.service.js';
import { crmReportColumns } from '../crm/crm-analytics.service.js';
import {
  FinanceReportExportsService,
  reportFilters,
  validateReportColumns,
} from './finance-report-exports.service.js';
import type { FinanceReportExportPageQueryDto } from './finance-report-exports.dto.js';
import type { SavedCrmReportDto, SavedCrmReportPageDto } from './saved-crm-reports.dto.js';

interface SavedRow {
  id: string;
  name: string;
  configuration: Omit<SavedCrmReport, 'id' | 'name'>;
  request_hash: string;
}

@Injectable()
export class SavedCrmReportsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FinanceReportExportsService) private readonly exports: FinanceReportExportsService,
  ) {}

  async list(
    query: FinanceReportExportPageQueryDto,
    auth: AuthenticationContext,
  ): Promise<SavedCrmReportPageDto> {
    const rows = await this.database.getPool().query<SavedRow>(
      `SELECT id, name, configuration FROM reporting.saved_crm_reports
       WHERE owner_account_id = $1 ORDER BY created_at DESC, id
       LIMIT $2 OFFSET $3`,
      [auth.accountId, query.pageSize, (query.page - 1) * query.pageSize],
    );
    const count = await this.database
      .getPool()
      .query<{ total: number }>(
        'SELECT count(*)::integer AS total FROM reporting.saved_crm_reports WHERE owner_account_id = $1',
        [auth.accountId],
      );
    const total = count.rows[0]?.total ?? 0;
    return {
      items: rows.rows.map(mapSaved),
      page: query.page,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async save(
    input: SavedCrmReportDto,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<SavedCrmReport> {
    const available = await this.exports.crmDefinitions();
    const definition = available.find((definition) => definition.key === input.definitionKey);
    if (!definition) {
      throw new ApiErrorException('REPORT_NOT_FOUND', 'This report is not available.', 404);
    }
    if (!definition.formats.includes(input.format)) {
      throw new ApiErrorException(
        'REPORT_EXPORT_FORMAT_NOT_AVAILABLE',
        'Choose one of the available file formats for this report.',
        400,
      );
    }
    const configuration: SavedRow['configuration'] = {
      ...reportFilters(input, input.definitionKey),
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      columns: validateReportColumns(
        input.definitionKey,
        input.columns ?? crmReportColumns(input.definitionKey).map((column) => column.key),
      ),
      definitionKey: input.definitionKey,
      format: input.format,
    };
    const name = input.name.trim();
    const hash = createHash('sha256').update(JSON.stringify({ name, configuration })).digest('hex');
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO reporting.saved_crm_reports (id, owner_account_id, name, configuration, request_hash)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
        [input.id, auth.accountId, name, configuration, hash],
      );
      if (!inserted.rowCount) {
        const existing = await client.query<SavedRow>(
          'SELECT id, name, configuration, request_hash FROM reporting.saved_crm_reports WHERE id = $1 AND owner_account_id = $2',
          [input.id, auth.accountId],
        );
        if (existing.rows[0]?.request_hash !== hash) {
          throw new ApiErrorException(
            'REPORT_SAVE_CONFLICT',
            'This save conflicts with an earlier request. Save a new copy.',
            409,
          );
        }
      } else {
        await this.audit.append(
          {
            ...metadata,
            action: 'report.view.created',
            actorAccountId: auth.accountId,
            after: { name, configuration },
            targetId: input.id,
            targetType: 'report_view',
          },
          client,
        );
      }
      await client.query('COMMIT');
      return { id: input.id, name, ...configuration };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function mapSaved(row: SavedRow): SavedCrmReport {
  return { ...row.configuration, id: row.id, name: row.name };
}
