import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { SavedFinanceReport } from '@vista/contracts';
import { AuditService } from '../audit/audit.service.js';
import type {
  AuthenticationContext,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { DatabaseService } from '../database/database.service.js';
import { financeReportColumns } from '../finance/finance-reports.service.js';
import {
  FinanceReportExportsService,
  reportFilters,
  validateFinanceColumns,
} from './finance-report-exports.service.js';
import type { FinanceReportExportPageQueryDto } from './finance-report-exports.dto.js';
import type {
  SavedFinanceReportDto,
  SavedFinanceReportPageDto,
} from './saved-finance-reports.dto.js';

interface SavedRow {
  id: string;
  name: string;
  configuration: Omit<SavedFinanceReport, 'id' | 'name'>;
  request_hash: string;
}

@Injectable()
export class SavedFinanceReportsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FinanceReportExportsService) private readonly exports: FinanceReportExportsService,
  ) {}

  async list(
    query: FinanceReportExportPageQueryDto,
    auth: AuthenticationContext,
  ): Promise<SavedFinanceReportPageDto> {
    const rows = await this.database.getPool().query<SavedRow>(
      `SELECT id, name, configuration FROM reporting.saved_finance_reports
       WHERE owner_account_id = $1 ORDER BY created_at DESC, id
       LIMIT $2 OFFSET $3`,
      [auth.accountId, query.pageSize, (query.page - 1) * query.pageSize],
    );
    const count = await this.database
      .getPool()
      .query<{ total: number }>(
        'SELECT count(*)::integer AS total FROM reporting.saved_finance_reports WHERE owner_account_id = $1',
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
    input: SavedFinanceReportDto,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<SavedFinanceReport> {
    const available = await this.exports.definitions();
    if (!available.some((definition) => definition.key === input.definitionKey)) {
      throw new ApiErrorException('REPORT_NOT_FOUND', 'This report is not available.', 404);
    }
    const configuration: SavedRow['configuration'] = {
      ...reportFilters(input, input.definitionKey),
      columns: validateFinanceColumns(
        input.definitionKey,
        input.columns ?? financeReportColumns(input.definitionKey).map((column) => column.key),
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
        `INSERT INTO reporting.saved_finance_reports (id, owner_account_id, name, configuration, request_hash)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
        [input.id, auth.accountId, name, configuration, hash],
      );
      if (!inserted.rowCount) {
        const existing = await client.query<SavedRow>(
          'SELECT id, name, configuration, request_hash FROM reporting.saved_finance_reports WHERE id = $1 AND owner_account_id = $2',
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

function mapSaved(row: SavedRow): SavedFinanceReport {
  return { ...row.configuration, id: row.id, name: row.name };
}
