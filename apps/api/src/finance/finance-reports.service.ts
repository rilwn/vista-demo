import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  FinanceAgingBucket,
  FinanceAgingReport,
  FinanceTurnoverReport,
} from '@vista/contracts';

import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import type { AppEnvironment } from '@vista/config';
import { DatabaseService } from '../database/database.service.js';
import type { FinanceAgingQueryDto, FinanceTurnoverQueryDto } from './finance-reports.dto.js';

interface AgingRow {
  days_overdue: number;
  document_date: string;
  due_date: string;
  id: string;
  number: string;
  original_bgn_total: string;
  outstanding_bgn_total: string;
  partner_id: string;
  partner_name: string;
  payment_status: FinanceAgingReport['items'][number]['paymentStatus'];
  source_number: string;
  total_count: string;
}

interface AgingTotalsRow {
  current_total: string;
  days_0_30_total: string;
  days_31_60_total: string;
  days_61_90_total: string;
  over_90_total: string;
  total: string;
}

interface TurnoverRow {
  allocated_bgn_total: string;
  document_count: string;
  gross_bgn_total: string;
  outstanding_bgn_total: string;
  partner_id: string;
  partner_name: string;
  total_count: string;
}

interface TurnoverTotalsRow {
  allocated_bgn_total: string;
  document_count: string;
  gross_bgn_total: string;
  outstanding_bgn_total: string;
}

@Injectable()
export class FinanceReportsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {}

  async aging(query: FinanceAgingQueryDto): Promise<FinanceAgingReport> {
    const asOf = await this.businessDate();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const offset = (page - 1) * pageSize;
    const source = agingSource(query.kind);
    const pool = this.database.getPool();
    const [rows, totals] = await Promise.all([
      pool.query<AgingRow>(
        `SELECT source.*, count(*) OVER ()::text AS total_count
         FROM (${source}) source
         ORDER BY source.due_date, source.partner_name, source.id
         LIMIT $2 OFFSET $3`,
        [asOf, pageSize, offset],
      ),
      pool.query<AgingTotalsRow>(
        `SELECT
           COALESCE(sum(outstanding_bgn_total) FILTER (WHERE days_overdue = 0), 0)::text AS current_total,
           COALESCE(sum(outstanding_bgn_total) FILTER (WHERE days_overdue BETWEEN 1 AND 30), 0)::text AS days_0_30_total,
           COALESCE(sum(outstanding_bgn_total) FILTER (WHERE days_overdue BETWEEN 31 AND 60), 0)::text AS days_31_60_total,
           COALESCE(sum(outstanding_bgn_total) FILTER (WHERE days_overdue BETWEEN 61 AND 90), 0)::text AS days_61_90_total,
           COALESCE(sum(outstanding_bgn_total) FILTER (WHERE days_overdue > 90), 0)::text AS over_90_total,
           COALESCE(sum(outstanding_bgn_total), 0)::text AS total
         FROM (${source}) source`,
        [asOf],
      ),
    ]);
    const totalItems = Number(rows.rows[0]?.total_count ?? '0');
    const summary = required(totals.rows[0], 'Finance aging totals could not be calculated');
    return {
      asOf,
      items: rows.rows.map((row) => ({
        bucket: agingBucket(row.days_overdue),
        daysOverdue: row.days_overdue,
        documentDate: row.document_date,
        dueDate: row.due_date,
        id: row.id,
        number: row.number,
        originalBgnTotal: row.original_bgn_total,
        outstandingBgnTotal: row.outstanding_bgn_total,
        partnerId: row.partner_id,
        partnerName: row.partner_name,
        paymentStatus: row.payment_status,
        sourceNumber: row.source_number,
      })),
      kind: query.kind,
      page,
      pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / pageSize),
      totals: {
        current: summary.current_total,
        days0To30: summary.days_0_30_total,
        days31To60: summary.days_31_60_total,
        days61To90: summary.days_61_90_total,
        over90: summary.over_90_total,
        total: summary.total,
      },
    };
  }

  async turnover(query: FinanceTurnoverQueryDto): Promise<FinanceTurnoverReport> {
    const businessDate = await this.businessDate();
    const dateFrom = query.dateFrom ?? `${businessDate.slice(0, 8)}01`;
    const dateTo = query.dateTo ?? businessDate;
    if (dateFrom > dateTo) {
      throw new ApiErrorException(
        'FINANCE_REPORT_DATE_RANGE_INVALID',
        'The start date cannot be after the end date.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const offset = (page - 1) * pageSize;
    const source = turnoverSource(query.kind);
    const pool = this.database.getPool();
    const [rows, totals] = await Promise.all([
      pool.query<TurnoverRow>(
        `SELECT source.*, count(*) OVER ()::text AS total_count
         FROM (${source}) source
         ORDER BY source.gross_bgn_total DESC, source.partner_name, source.partner_id
         LIMIT $3 OFFSET $4`,
        [dateFrom, dateTo, pageSize, offset],
      ),
      pool.query<TurnoverTotalsRow>(
        `SELECT
           COALESCE(sum(source.allocated_bgn_total), 0)::text AS allocated_bgn_total,
           COALESCE(sum(source.document_count), 0)::text AS document_count,
           COALESCE(sum(source.gross_bgn_total), 0)::text AS gross_bgn_total,
           COALESCE(sum(source.outstanding_bgn_total), 0)::text AS outstanding_bgn_total
         FROM (${source}) source`,
        [dateFrom, dateTo],
      ),
    ]);
    const totalItems = Number(rows.rows[0]?.total_count ?? '0');
    const summary = required(totals.rows[0], 'Finance turnover totals could not be calculated');
    return {
      dateFrom,
      dateTo,
      items: rows.rows.map((row) => ({
        allocatedBgnTotal: row.allocated_bgn_total,
        documentCount: Number(row.document_count),
        grossBgnTotal: row.gross_bgn_total,
        outstandingBgnTotal: row.outstanding_bgn_total,
        partnerId: row.partner_id,
        partnerName: row.partner_name,
      })),
      kind: query.kind,
      page,
      pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / pageSize),
      totals: {
        allocatedBgnTotal: summary.allocated_bgn_total,
        documentCount: Number(summary.document_count),
        grossBgnTotal: summary.gross_bgn_total,
        outstandingBgnTotal: summary.outstanding_bgn_total,
      },
    };
  }

  private async businessDate(): Promise<string> {
    const result = await this.database
      .getPool()
      .query<{ date: string }>(`SELECT (now() AT TIME ZONE $1)::date::text AS date`, [
        this.environment.BUSINESS_TIMEZONE,
      ]);
    return required(result.rows[0], 'Business date calculation failed').date;
  }
}

function agingSource(kind: FinanceAgingReport['kind']): string {
  if (kind === 'receivable') {
    return `SELECT document.id, document.document_number AS number,
                   invoice.invoice_number AS source_number,
                   document.customer_partner_id AS partner_id,
                   partner.display_name AS partner_name,
                   document.document_date::text, document.due_date::text,
                   document.payment_status,
                   document.bgn_total AS original_bgn_total,
                   round(document.outstanding_total * document.exchange_rate, 4) AS outstanding_bgn_total,
                   GREATEST($1::date - document.due_date, 0)::integer AS days_overdue
            FROM finance.customer_documents document
            JOIN sales.invoices invoice ON invoice.id = document.source_sales_invoice_id
            JOIN master_data.partners partner ON partner.id = document.customer_partner_id
            WHERE document.review_state = 'pending_finance_review'
              AND document.outstanding_total > 0`;
  }
  return `SELECT payable.id, payable.payable_number AS number,
                 invoice.supplier_invoice_number AS source_number,
                 payable.supplier_partner_id AS partner_id,
                 partner.display_name AS partner_name,
                 payable.document_date::text, payable.due_date::text,
                 payable.payment_status,
                 payable.bgn_total AS original_bgn_total,
                 round(payable.outstanding_total * payable.exchange_rate, 4) AS outstanding_bgn_total,
                 GREATEST($1::date - payable.due_date, 0)::integer AS days_overdue
          FROM finance.supplier_payables payable
          JOIN procurement.supplier_invoices invoice ON invoice.id = payable.source_supplier_invoice_id
          JOIN master_data.partners partner ON partner.id = payable.supplier_partner_id
          WHERE payable.outstanding_total > 0`;
}

function turnoverSource(kind: FinanceTurnoverReport['kind']): string {
  if (kind === 'customer') {
    return `SELECT document.customer_partner_id AS partner_id,
                   partner.display_name AS partner_name,
                   count(*)::integer AS document_count,
                   sum(document.bgn_total) AS gross_bgn_total,
                   sum(round(document.allocated_total * document.exchange_rate, 4)) AS allocated_bgn_total,
                   sum(round(document.outstanding_total * document.exchange_rate, 4)) AS outstanding_bgn_total
            FROM finance.customer_documents document
            JOIN master_data.partners partner ON partner.id = document.customer_partner_id
            WHERE document.review_state = 'pending_finance_review'
              AND document.document_date BETWEEN $1 AND $2
            GROUP BY document.customer_partner_id, partner.display_name`;
  }
  return `SELECT payable.supplier_partner_id AS partner_id,
                 partner.display_name AS partner_name,
                 count(*)::integer AS document_count,
                 sum(payable.bgn_total) AS gross_bgn_total,
                 sum(round(payable.allocated_total * payable.exchange_rate, 4)) AS allocated_bgn_total,
                 sum(round(payable.outstanding_total * payable.exchange_rate, 4)) AS outstanding_bgn_total
          FROM finance.supplier_payables payable
          JOIN master_data.partners partner ON partner.id = payable.supplier_partner_id
          WHERE payable.document_date BETWEEN $1 AND $2
          GROUP BY payable.supplier_partner_id, partner.display_name`;
}

export function agingBucket(daysOverdue: number): FinanceAgingBucket {
  if (daysOverdue === 0) return 'current';
  if (daysOverdue <= 30) return 'days_0_30';
  if (daysOverdue <= 60) return 'days_31_60';
  if (daysOverdue <= 90) return 'days_61_90';
  return 'over_90';
}

function required<T>(value: T | undefined, message: string): T {
  if (!value) throw new Error(message);
  return value;
}
