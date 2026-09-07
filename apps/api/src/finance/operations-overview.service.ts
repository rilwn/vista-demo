import { Inject, Injectable } from '@nestjs/common';
import { hasPermission } from '@vista/auth';
import type { AppEnvironment } from '@vista/config';
import type { OperationsOverview } from '@vista/contracts';
import type { AuthenticationContext } from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';
import type { OperationsOverviewQueryDto } from './operations-overview.dto.js';

@Injectable()
export class OperationsOverviewService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {}

  async overview(
    query: OperationsOverviewQueryDto,
    auth: AuthenticationContext,
  ): Promise<OperationsOverview> {
    if (query.dateFrom > query.dateTo) {
      throw new ApiErrorException(
        'REPORT_DATE_RANGE_INVALID',
        'The start date cannot be after the end date.',
        400,
      );
    }
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const date = await client.query<{ today: string }>(
        'SELECT (now() AT TIME ZONE $1)::date::text AS today',
        [this.environment.BUSINESS_TIMEZONE],
      );
      const asOf = date.rows[0]!.today;
      const result: OperationsOverview = {
        asOf,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        warrantyDays: query.warrantyDays,
      };
      if (hasPermission(auth.permissions, { module: 'erp.finance', action: 'view' })) {
        const revenue = await client.query<{ value: string }>(
          `SELECT coalesce(sum(CASE WHEN document_type = 'credit_note' THEN -bgn_net_total ELSE bgn_net_total END),0)::text AS value
           FROM finance.financial_documents
           WHERE status <> 'cancelled' AND document_type IN ('invoice','credit_note','debit_note')
           AND issue_date BETWEEN $1::date AND $2::date`,
          [query.dateFrom, query.dateTo],
        );
        result.recordedRevenueBgn = revenue.rows[0]!.value;
        const overdue = await client.query<{ value: string }>(
          `SELECT coalesce(sum(round(outstanding_total * exchange_rate,4)),0)::text AS value
           FROM finance.customer_documents WHERE review_state = 'pending_finance_review'
           AND outstanding_total > 0 AND due_date < $1::date`,
          [asOf],
        );
        result.overdueReceivablesBgn = overdue.rows[0]!.value;
      }
      // Global Service metrics follow the existing supervisor-only Service reports policy.
      if (hasPermission(auth.permissions, { module: 'erp.service', action: 'approve' })) {
        const service = await client.query<{ value: number }>(
          "SELECT count(*)::integer AS value FROM service.requests WHERE status IN ('new','scheduled','in_progress')",
        );
        result.activeServiceRequests = service.rows[0]!.value;
      }
      if (
        hasPermission(auth.permissions, { module: 'crm', action: 'view' }) ||
        hasPermission(auth.permissions, { module: 'erp.service', action: 'approve' })
      ) {
        const warranty = await client.query<{ value: number }>(
          `SELECT count(*)::integer AS value FROM master_data.customer_equipment
           WHERE active AND warranty_end_date BETWEEN $1::date AND $1::date + $2::integer`,
          [asOf, query.warrantyDays],
        );
        result.expiringWarranties = warranty.rows[0]!.value;
      }
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
