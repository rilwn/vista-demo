import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  FinanceAgingBucket,
  FinanceAgingReport,
  FinanceJournalReport,
  FinanceVatReviewReport,
  FinanceReportDefinitionKey,
  FinanceTurnoverReport,
  VatTreatment,
} from '@vista/contracts';

import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import type { AppEnvironment } from '@vista/config';
import { DatabaseService } from '../database/database.service.js';
import type {
  FinanceAgingQueryDto,
  FinanceJournalQueryDto,
  FinanceTurnoverQueryDto,
  FinanceVatQueryDto,
} from './finance-reports.dto.js';

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

interface JournalRow {
  currency_code: string;
  document_date: string;
  document_type: FinanceJournalReport['items'][number]['documentType'];
  exchange_rate: string | null;
  gross_bgn_total: string;
  id: string;
  net_bgn_total: string;
  number: string;
  partner_name: string;
  partner_vat_number: string | null;
  source_number: string | null;
  status: FinanceJournalReport['items'][number]['status'];
  tax_breakdown_complete: boolean;
  tax_event_date: string | null;
  total_count: string;
  vat_bgn_total: string;
}

interface JournalTotalsRow {
  document_count: string;
  gross_bgn_total: string;
  incomplete_tax_documents: string;
  net_bgn_total: string;
  vat_bgn_total: string;
}

interface VatReviewRow {
  direction: FinanceVatReviewReport['items'][number]['direction'];
  document_count: string;
  net_bgn_total: string;
  vat_bgn_total: string;
  vat_rate: string;
  vat_treatment: VatTreatment;
}

export interface FinanceReportExportColumn {
  key: string;
  label: string;
  type: 'date' | 'money' | 'number' | 'text';
}

export interface FinanceReportExportData {
  columns: FinanceReportExportColumn[];
  criteria: string[];
  generatedAt: string;
  rows: Record<string, number | string>[];
  title: string;
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

  async journal(query: FinanceJournalQueryDto): Promise<FinanceJournalReport> {
    const { dateFrom, dateTo } = await this.reportPeriod(query.dateFrom, query.dateTo);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const offset = (page - 1) * pageSize;
    const source = journalSource(query.kind);
    const [rows, totals] = await Promise.all([
      this.database.getPool().query<JournalRow>(
        `SELECT source.*, count(*) OVER ()::text AS total_count
         FROM (${source}) source
         ORDER BY source.document_date DESC, source.number, source.id
         LIMIT $3 OFFSET $4`,
        [dateFrom, dateTo, pageSize, offset],
      ),
      this.database.getPool().query<JournalTotalsRow>(
        `SELECT count(*)::text AS document_count,
                COALESCE(sum(source.net_bgn_total), 0)::text AS net_bgn_total,
                COALESCE(sum(source.vat_bgn_total), 0)::text AS vat_bgn_total,
                COALESCE(sum(source.gross_bgn_total), 0)::text AS gross_bgn_total,
                count(*) FILTER (WHERE NOT source.tax_breakdown_complete)::text
                  AS incomplete_tax_documents
         FROM (${source}) source`,
        [dateFrom, dateTo],
      ),
    ]);
    const summary = required(totals.rows[0], 'Finance journal totals could not be calculated');
    const totalItems = Number(rows.rows[0]?.total_count ?? '0');
    return {
      dateFrom,
      dateTo,
      items: rows.rows.map(mapJournalRow),
      kind: query.kind,
      page,
      pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / pageSize),
      totals: {
        documentCount: Number(summary.document_count),
        grossBgnTotal: summary.gross_bgn_total,
        incompleteTaxDocuments: Number(summary.incomplete_tax_documents),
        netBgnTotal: summary.net_bgn_total,
        vatBgnTotal: summary.vat_bgn_total,
      },
    };
  }

  async vatReview(query: FinanceVatQueryDto): Promise<FinanceVatReviewReport> {
    const { dateFrom, dateTo } = await this.reportPeriod(query.dateFrom, query.dateTo);
    const [items, incomplete] = await Promise.all([
      this.database.getPool().query<VatReviewRow>(vatReviewSource(), [dateFrom, dateTo]),
      this.database
        .getPool()
        .query<{ count: string; numbers: string[] }>(incompletePurchaseTaxSource(), [
          dateFrom,
          dateTo,
        ]),
    ]);
    const outputVat = sumDecimalStrings(
      items.rows.filter((row) => row.direction === 'output').map((row) => row.vat_bgn_total),
    );
    const inputVat = sumDecimalStrings(
      items.rows.filter((row) => row.direction === 'input').map((row) => row.vat_bgn_total),
    );
    return {
      dateFrom,
      dateTo,
      incompletePurchaseDocumentNumbers: incomplete.rows[0]?.numbers ?? [],
      incompletePurchaseDocuments: Number(incomplete.rows[0]?.count ?? '0'),
      items: items.rows.map((row) => ({
        direction: row.direction,
        documentCount: Number(row.document_count),
        netBgnTotal: row.net_bgn_total,
        vatBgnTotal: row.vat_bgn_total,
        vatRate: row.vat_rate,
        vatTreatment: row.vat_treatment,
      })),
      recordedDifferenceBgn: subtractDecimalStrings(outputVat, inputVat),
      recordedInputVatBgn: inputVat,
      recordedOutputVatBgn: outputVat,
    };
  }

  async exportData(
    definitionKey: FinanceReportDefinitionKey,
    filters: { dateFrom?: string; dateTo?: string },
  ): Promise<FinanceReportExportData> {
    const businessDate = await this.businessDate();
    const generatedAt = new Date().toISOString();
    if (
      definitionKey === 'finance.receivables-aging' ||
      definitionKey === 'finance.supplier-payables-aging'
    ) {
      const kind = definitionKey === 'finance.receivables-aging' ? 'receivable' : 'payable';
      const result = await this.database.getPool().query<AgingRow>(
        `SELECT source.*, '0'::text AS total_count
         FROM (${agingSource(kind)}) source
         ORDER BY source.due_date, source.partner_name, source.id`,
        [businessDate],
      );
      return {
        columns: agingExportColumns,
        criteria: [`As of ${businessDate}`, 'Currency: BGN'],
        generatedAt,
        rows: result.rows.map((row) => ({
          aging: agingBucketLabel(agingBucket(row.days_overdue)),
          daysOverdue: row.days_overdue,
          documentDate: row.document_date,
          dueDate: row.due_date,
          number: row.number,
          originalBgnTotal: row.original_bgn_total,
          outstandingBgnTotal: row.outstanding_bgn_total,
          partnerName: row.partner_name,
          paymentStatus: paymentStatusLabel(row.payment_status),
          sourceNumber: row.source_number,
        })),
        title: kind === 'receivable' ? 'Customer receivables' : 'Supplier payables',
      };
    }

    if (definitionKey === 'finance.sales-journal' || definitionKey === 'finance.purchase-journal') {
      const { dateFrom, dateTo } = requiredExportPeriod(filters);
      const kind = definitionKey === 'finance.sales-journal' ? 'sales' : 'purchase';
      const result = await this.database.getPool().query<JournalRow>(
        `SELECT source.*, '0'::text AS total_count
         FROM (${journalSource(kind)}) source
         ORDER BY source.document_date DESC, source.number, source.id`,
        [dateFrom, dateTo],
      );
      return {
        columns: journalExportColumns,
        criteria: [
          `Period: ${dateFrom} to ${dateTo}`,
          'Currency: BGN',
          kind === 'sales'
            ? 'Preparation report: official issuance is not enabled'
            : 'Rows without a tax snapshot are identified for Finance review',
        ],
        generatedAt,
        rows: result.rows.map((row) => ({
          currencyCode: row.currency_code,
          documentDate: row.document_date,
          documentType: journalDocumentTypeLabel(row.document_type),
          grossBgnTotal: row.gross_bgn_total,
          netBgnTotal: row.net_bgn_total,
          number: row.number,
          partnerName: row.partner_name,
          partnerVatNumber: row.partner_vat_number ?? '',
          sourceNumber: row.source_number ?? '',
          status: journalStatusLabel(row.status),
          taxBreakdown: row.tax_breakdown_complete ? 'Complete' : 'Needs review',
          taxEventDate: row.tax_event_date ?? '',
          vatBgnTotal: row.vat_bgn_total,
        })),
        title: kind === 'sales' ? 'Sales journal review' : 'Purchase journal review',
      };
    }

    if (definitionKey === 'finance.vat-review') {
      const { dateFrom, dateTo } = requiredExportPeriod(filters);
      const report = await this.vatReview({ dateFrom, dateTo });
      return {
        columns: vatReviewExportColumns,
        criteria: [
          `Period: ${dateFrom} to ${dateTo}`,
          'Currency: BGN',
          `Purchase documents awaiting tax breakdown: ${report.incompletePurchaseDocuments}`,
          'Preparation report: deductibility and filing remain subject to Finance approval',
        ],
        generatedAt,
        rows: report.items.map((row) => ({
          direction: row.direction === 'output' ? 'Output VAT' : 'Recorded input VAT',
          documentCount: row.documentCount,
          netBgnTotal: row.netBgnTotal,
          vatBgnTotal: row.vatBgnTotal,
          vatRate: row.vatRate,
          vatTreatment: vatTreatmentLabel(row.vatTreatment),
        })),
        title: 'VAT review',
      };
    }

    const dateFrom = filters.dateFrom;
    const dateTo = filters.dateTo;
    if (!dateFrom || !dateTo || !isCalendarDate(dateFrom) || !isCalendarDate(dateTo)) {
      throw new ApiErrorException(
        'FINANCE_REPORT_DATE_RANGE_REQUIRED',
        'Choose a valid start and end date for this report.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (dateFrom > dateTo) {
      throw new ApiErrorException(
        'FINANCE_REPORT_DATE_RANGE_INVALID',
        'The start date cannot be after the end date.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const kind = definitionKey === 'finance.customer-turnover' ? 'customer' : 'supplier';
    const result = await this.database.getPool().query<TurnoverRow>(
      `SELECT source.*, '0'::text AS total_count
       FROM (${turnoverSource(kind)}) source
       ORDER BY source.gross_bgn_total DESC, source.partner_name, source.partner_id`,
      [dateFrom, dateTo],
    );
    return {
      columns: turnoverExportColumns,
      criteria: [`Period: ${dateFrom} to ${dateTo}`, 'Currency: BGN'],
      generatedAt,
      rows: result.rows.map((row) => ({
        allocatedBgnTotal: row.allocated_bgn_total,
        documentCount: Number(row.document_count),
        grossBgnTotal: row.gross_bgn_total,
        outstandingBgnTotal: row.outstanding_bgn_total,
        partnerName: row.partner_name,
      })),
      title: kind === 'customer' ? 'Customer turnover' : 'Supplier turnover',
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

  private async reportPeriod(dateFrom?: string, dateTo?: string) {
    const businessDate = await this.businessDate();
    return validateReportPeriod(
      dateFrom ?? `${businessDate.slice(0, 8)}01`,
      dateTo ?? businessDate,
    );
  }
}

const agingExportColumns: FinanceReportExportColumn[] = [
  { key: 'number', label: 'Document', type: 'text' },
  { key: 'sourceNumber', label: 'Source document', type: 'text' },
  { key: 'partnerName', label: 'Partner', type: 'text' },
  { key: 'documentDate', label: 'Document date', type: 'date' },
  { key: 'dueDate', label: 'Due date', type: 'date' },
  { key: 'daysOverdue', label: 'Days overdue', type: 'number' },
  { key: 'aging', label: 'Aging', type: 'text' },
  { key: 'paymentStatus', label: 'Payment status', type: 'text' },
  { key: 'originalBgnTotal', label: 'Original BGN', type: 'money' },
  { key: 'outstandingBgnTotal', label: 'Outstanding BGN', type: 'money' },
];

const turnoverExportColumns: FinanceReportExportColumn[] = [
  { key: 'partnerName', label: 'Partner', type: 'text' },
  { key: 'documentCount', label: 'Documents', type: 'number' },
  { key: 'grossBgnTotal', label: 'Gross BGN', type: 'money' },
  { key: 'allocatedBgnTotal', label: 'Allocated BGN', type: 'money' },
  { key: 'outstandingBgnTotal', label: 'Outstanding BGN', type: 'money' },
];

const journalExportColumns: FinanceReportExportColumn[] = [
  { key: 'number', label: 'Document', type: 'text' },
  { key: 'sourceNumber', label: 'Source', type: 'text' },
  { key: 'documentType', label: 'Type', type: 'text' },
  { key: 'status', label: 'Status', type: 'text' },
  { key: 'partnerName', label: 'Partner', type: 'text' },
  { key: 'partnerVatNumber', label: 'VAT number', type: 'text' },
  { key: 'documentDate', label: 'Document date', type: 'date' },
  { key: 'taxEventDate', label: 'Tax-event date', type: 'date' },
  { key: 'currencyCode', label: 'Currency', type: 'text' },
  { key: 'netBgnTotal', label: 'Net BGN', type: 'money' },
  { key: 'vatBgnTotal', label: 'VAT BGN', type: 'money' },
  { key: 'grossBgnTotal', label: 'Gross BGN', type: 'money' },
  { key: 'taxBreakdown', label: 'Tax breakdown', type: 'text' },
];

const vatReviewExportColumns: FinanceReportExportColumn[] = [
  { key: 'direction', label: 'Direction', type: 'text' },
  { key: 'vatTreatment', label: 'VAT treatment', type: 'text' },
  { key: 'vatRate', label: 'Rate %', type: 'number' },
  { key: 'documentCount', label: 'Documents', type: 'number' },
  { key: 'netBgnTotal', label: 'Tax base BGN', type: 'money' },
  { key: 'vatBgnTotal', label: 'VAT BGN', type: 'money' },
];

function journalSource(kind: FinanceJournalReport['kind']): string {
  if (kind === 'sales') {
    return `SELECT document.id,
                   coalesce(document.official_number, document.draft_number) AS number,
                   source.invoice_number AS source_number,
                   document.document_type,
                   document.status,
                   document.customer_name AS partner_name,
                   document.customer_vat_number AS partner_vat_number,
                   document.issue_date::text AS document_date,
                   document.tax_event_date::text AS tax_event_date,
                   document.currency_code,
                   document.exchange_rate::text,
                   CASE
                     WHEN document.status = 'cancelled' OR document.document_type = 'proforma' THEN 0
                     WHEN document.document_type = 'credit_note' THEN -document.bgn_net_total
                     ELSE document.bgn_net_total
                   END AS net_bgn_total,
                   CASE
                     WHEN document.status = 'cancelled' OR document.document_type = 'proforma' THEN 0
                     WHEN document.document_type = 'credit_note' THEN -document.bgn_vat_total
                     ELSE document.bgn_vat_total
                   END AS vat_bgn_total,
                   CASE
                     WHEN document.status = 'cancelled' OR document.document_type = 'proforma' THEN 0
                     WHEN document.document_type = 'credit_note' THEN -document.bgn_gross_total
                     ELSE document.bgn_gross_total
                   END AS gross_bgn_total,
                   true AS tax_breakdown_complete
            FROM finance.financial_documents document
            LEFT JOIN sales.invoices source ON source.id = document.source_sales_invoice_id
            WHERE document.issue_date BETWEEN $1 AND $2`;
  }
  return `SELECT invoice.id,
                 invoice.supplier_invoice_number AS number,
                 NULL::varchar AS source_number,
                 'supplier_invoice'::varchar AS document_type,
                 'recorded'::varchar AS status,
                 supplier.display_name AS partner_name,
                 supplier.vat_number AS partner_vat_number,
                 invoice.invoice_date::text AS document_date,
                 invoice.invoice_date::text AS tax_event_date,
                 invoice.currency_code,
                 CASE WHEN invoice.currency_code = 'BGN' THEN '1.00000000' END AS exchange_rate,
                 CASE WHEN invoice.currency_code = 'BGN'
                        AND bool_and(line.vat_treatment IS NOT NULL)
                      THEN coalesce(sum(line.line_total), 0) ELSE 0 END AS net_bgn_total,
                 CASE WHEN invoice.currency_code = 'BGN'
                        AND bool_and(line.vat_treatment IS NOT NULL)
                      THEN coalesce(sum(line.vat_amount), 0) ELSE 0 END AS vat_bgn_total,
                 CASE WHEN invoice.currency_code = 'BGN'
                        AND bool_and(line.vat_treatment IS NOT NULL)
                      THEN coalesce(sum(line.gross_total), 0) ELSE 0 END AS gross_bgn_total,
                 (invoice.currency_code = 'BGN'
                   AND bool_and(line.vat_treatment IS NOT NULL)) AS tax_breakdown_complete
          FROM procurement.supplier_invoices invoice
          JOIN master_data.partners supplier ON supplier.id = invoice.supplier_partner_id
          JOIN procurement.supplier_invoice_lines line ON line.supplier_invoice_id = invoice.id
          WHERE invoice.invoice_date BETWEEN $1 AND $2
          GROUP BY invoice.id, supplier.display_name, supplier.vat_number`;
}

function vatReviewSource(): string {
  return `WITH purchase_completeness AS (
            SELECT invoice.id,
                   invoice.currency_code = 'BGN'
                     AND bool_and(line.vat_treatment IS NOT NULL) AS complete
            FROM procurement.supplier_invoices invoice
            JOIN procurement.supplier_invoice_lines line ON line.supplier_invoice_id = invoice.id
            WHERE invoice.invoice_date BETWEEN $1 AND $2
            GROUP BY invoice.id
          )
          SELECT 'output'::varchar AS direction,
                 summary.vat_treatment, summary.vat_rate::text,
                 count(DISTINCT document.id)::text AS document_count,
                 round(sum(
                   (CASE WHEN document.document_type = 'credit_note' THEN -1 ELSE 1 END)
                   * summary.net_total * document.exchange_rate
                 ), 4)::text AS net_bgn_total,
                 round(sum(
                   (CASE WHEN document.document_type = 'credit_note' THEN -1 ELSE 1 END)
                   * summary.vat_amount * document.exchange_rate
                 ), 4)::text AS vat_bgn_total
          FROM finance.financial_document_vat_summary summary
          JOIN finance.financial_documents document ON document.id = summary.financial_document_id
          WHERE document.status = 'draft'
            AND document.document_type IN ('invoice', 'credit_note', 'debit_note')
            AND document.tax_event_date BETWEEN $1 AND $2
          GROUP BY summary.vat_treatment, summary.vat_rate
          UNION ALL
          SELECT 'input'::varchar AS direction,
                 line.vat_treatment, line.vat_rate::text,
                 count(DISTINCT invoice.id)::text AS document_count,
                 round(sum(line.line_total), 4)::text AS net_bgn_total,
                 round(sum(line.vat_amount), 4)::text AS vat_bgn_total
          FROM procurement.supplier_invoice_lines line
          JOIN procurement.supplier_invoices invoice ON invoice.id = line.supplier_invoice_id
          JOIN purchase_completeness completeness
            ON completeness.id = invoice.id AND completeness.complete
          WHERE invoice.invoice_date BETWEEN $1 AND $2
          GROUP BY line.vat_treatment, line.vat_rate
          ORDER BY direction DESC, vat_rate DESC, vat_treatment`;
}

function incompletePurchaseTaxSource(): string {
  return `SELECT count(*)::text AS count,
                 coalesce(json_agg(incomplete.number ORDER BY incomplete.number), '[]'::json)
                   AS numbers
          FROM (
            SELECT invoice.id, invoice.supplier_invoice_number AS number
            FROM procurement.supplier_invoices invoice
            JOIN procurement.supplier_invoice_lines line ON line.supplier_invoice_id = invoice.id
            WHERE invoice.invoice_date BETWEEN $1 AND $2
            GROUP BY invoice.id, invoice.supplier_invoice_number
            HAVING invoice.currency_code <> 'BGN'
               OR NOT bool_and(line.vat_treatment IS NOT NULL)
          ) incomplete`;
}

function mapJournalRow(row: JournalRow): FinanceJournalReport['items'][number] {
  return {
    currencyCode: row.currency_code,
    documentDate: row.document_date,
    documentType: row.document_type,
    ...(row.exchange_rate ? { exchangeRate: row.exchange_rate } : {}),
    grossBgnTotal: row.gross_bgn_total,
    id: row.id,
    netBgnTotal: row.net_bgn_total,
    number: row.number,
    partnerName: row.partner_name,
    ...(row.partner_vat_number ? { partnerVatNumber: row.partner_vat_number } : {}),
    ...(row.source_number ? { sourceNumber: row.source_number } : {}),
    status: row.status,
    taxBreakdownComplete: row.tax_breakdown_complete,
    ...(row.tax_event_date ? { taxEventDate: row.tax_event_date } : {}),
    vatBgnTotal: row.vat_bgn_total,
  };
}

function journalDocumentTypeLabel(value: JournalRow['document_type']): string {
  return {
    credit_note: 'Credit note',
    debit_note: 'Debit note',
    invoice: 'Invoice',
    proforma: 'Proforma',
    supplier_invoice: 'Supplier invoice',
  }[value];
}

function journalStatusLabel(value: JournalRow['status']): string {
  return { cancelled: 'Cancelled', draft: 'Draft', recorded: 'Recorded' }[value];
}

function vatTreatmentLabel(value: VatTreatment): string {
  return {
    exempt: 'Exempt',
    ica: 'Intra-community acquisition',
    reduced_9: 'Reduced 9%',
    standard_20: 'Standard 20%',
    zero: 'Zero-rated',
  }[value];
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

function agingBucketLabel(bucket: FinanceAgingBucket): string {
  return {
    current: 'Not due',
    days_0_30: '0–30 days',
    days_31_60: '31–60 days',
    days_61_90: '61–90 days',
    over_90: 'Over 90 days',
  }[bucket];
}

function paymentStatusLabel(status: AgingRow['payment_status']): string {
  return {
    overdue: 'Overdue',
    paid: 'Paid',
    partially_paid: 'Partially paid',
    unpaid: 'Unpaid',
  }[status];
}

function validateReportPeriod(dateFrom: string, dateTo: string) {
  if (!isCalendarDate(dateFrom) || !isCalendarDate(dateTo)) {
    throw new ApiErrorException(
      'FINANCE_REPORT_DATE_RANGE_REQUIRED',
      'Choose a valid start and end date for this report.',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (dateFrom > dateTo) {
    throw new ApiErrorException(
      'FINANCE_REPORT_DATE_RANGE_INVALID',
      'The start date cannot be after the end date.',
      HttpStatus.BAD_REQUEST,
    );
  }
  return { dateFrom, dateTo };
}

function requiredExportPeriod(filters: { dateFrom?: string; dateTo?: string }) {
  if (!filters.dateFrom || !filters.dateTo) {
    throw new ApiErrorException(
      'FINANCE_REPORT_DATE_RANGE_REQUIRED',
      'Choose a valid start and end date for this report.',
      HttpStatus.BAD_REQUEST,
    );
  }
  return validateReportPeriod(filters.dateFrom, filters.dateTo);
}

function sumDecimalStrings(values: string[]): string {
  return fromDecimalUnits(values.reduce((total, value) => total + toDecimalUnits(value), 0n));
}

function subtractDecimalStrings(left: string, right: string): string {
  return fromDecimalUnits(toDecimalUnits(left) - toDecimalUnits(right));
}

function toDecimalUnits(value: string): bigint {
  const negative = value.startsWith('-');
  const normalized = negative ? value.slice(1) : value;
  const [whole = '0', fraction = ''] = normalized.split('.');
  const units = BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0').slice(0, 4));
  return negative ? -units : units;
}

function fromDecimalUnits(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 10_000n;
  const fraction = String(absolute % 10_000n).padStart(4, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function required<T>(value: T | undefined, message: string): T {
  if (!value) throw new Error(message);
  return value;
}
