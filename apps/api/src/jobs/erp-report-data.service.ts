import { Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type { ErpReportDefinitionKey, ErpReportPreview } from '@vista/contracts';
import { DatabaseService } from '../database/database.service.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import type { FinanceReportExportData } from '../finance/finance-reports.service.js';
import { erpReportSpec, erpReportColumns, erpReportSql } from './erp-report-definitions.js';

@Injectable()
export class ErpReportDataService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {}
  async read(
    key: ErpReportDefinitionKey,
    filters: { dateFrom?: string; dateTo?: string; search?: string },
    page = 1,
    pageSize = 25,
  ): Promise<ErpReportPreview> {
    const client = await this.database.getPool().connect();
    const parameters = [
      filters.dateFrom ?? null,
      filters.dateTo ?? null,
      this.environment.BUSINESS_TIMEZONE,
      filters.search?.trim() || null,
    ];
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const sql = erpReportSql(key);
      const count = await client.query<{ total: number }>(
        `SELECT count(*)::integer AS total FROM (${sql}) report`,
        parameters,
      );
      const total = count.rows[0]!.total;
      if (pageSize > 100 && total > 100000)
        throw new ApiErrorException(
          'REPORT_TOO_LARGE',
          'Narrow the dates or search to export fewer than 100,001 rows.',
          400,
        );
      const result = await client.query<Record<string, string>>(
        `SELECT * FROM (${sql}) report ORDER BY "_id" LIMIT $5 OFFSET $6`,
        [...parameters, pageSize, (page - 1) * pageSize],
      );
      const timestamp = await client.query<{ generated: string }>(
        'SELECT now()::text AS generated',
      );
      await client.query('COMMIT');
      return {
        columns: erpReportColumns(key),
        rows: result.rows.map((row) =>
          Object.fromEntries(Object.entries(row).filter(([key]) => key !== '_id')),
        ),
        total,
        page,
        totalPages: Math.ceil(total / pageSize),
        generatedAt: new Date(timestamp.rows[0]!.generated).toISOString(),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async exportData(
    key: ErpReportDefinitionKey,
    filters: { dateFrom?: string; dateTo?: string; search?: string },
  ): Promise<FinanceReportExportData> {
    const data = await this.read(key, filters, 1, 100001);
    return {
      columns: data.columns,
      rows: data.rows,
      generatedAt: data.generatedAt,
      title: erpReportSpec(key).name,
      criteria: [
        erpReportSpec(key).description,
        filters.dateFrom
          ? `Period: ${filters.dateFrom} to ${filters.dateTo}`
          : 'Current records at export time',
        `Timezone: ${this.environment.BUSINESS_TIMEZONE}`,
        ...(filters.search ? [`Search: ${filters.search}`] : []),
      ],
    };
  }
}
