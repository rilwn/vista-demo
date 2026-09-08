import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  CrmAnalyticsCustomerMetrics,
  CrmAnalyticsDefinition,
  CrmAnalyticsEmployeeMetric,
  CrmAnalyticsOverview,
  CrmAnalyticsPipelineStage,
  CrmAnalyticsPipelineStageMetric,
  CrmAnalyticsPreference,
  CrmAnalyticsRevenueDimension,
  CrmAnalyticsRevenueMetric,
  CrmReportDefinitionKey,
} from '@vista/contracts';

import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';
import type { FinanceReportExportData } from '../finance/finance-reports.service.js';

interface CustomerMetricRow {
  current_active_customers: string;
  current_average_transaction_value_bgn: string;
  current_churn_percent: string;
  current_net_revenue_bgn: string;
  current_observed_lifetime_value_bgn: string;
  current_purchase_frequency: string;
  current_retention_percent: string;
  previous_active_customers: string;
  previous_average_transaction_value_bgn: string;
  previous_churn_percent: string;
  previous_observed_lifetime_value_bgn: string;
  previous_purchase_frequency: string;
  previous_retention_percent: string;
}

interface PipelineRow {
  current_count: string;
  entered_count: string;
  estimated_revenue_bgn: string;
  lost_count: string;
  open_pipeline_value_bgn: string;
  stage: CrmAnalyticsPipelineStage;
  total_opportunities: string;
  won_count: string;
}

interface EmployeeRow {
  display_name: string;
  requests_processed: string;
  sales_completed: string;
  tickets_resolved: string;
}

interface PreferenceRow {
  document_count: string;
  kind: CrmAnalyticsPreference['kind'];
  label: string;
  net_revenue_bgn: string;
  quantity: string;
}

interface RevenueRow {
  dimension: CrmAnalyticsRevenueDimension;
  document_count: string;
  key: string;
  label: string;
  net_revenue_bgn: string;
}

interface AnalyticsPeriod {
  dateFrom: string;
  dateTo: string;
  prePreviousDateFrom: string;
  prePreviousDateTo: string;
  previousDateFrom: string;
  previousDateTo: string;
}

@Injectable()
export class CrmAnalyticsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {}

  async overview(dateFrom: string, dateTo: string): Promise<CrmAnalyticsOverview> {
    const period = analyticsPeriod(dateFrom, dateTo);
    const [customer, pipelineRows, employeeRows, preferenceRows, revenueRows] = await Promise.all([
      this.customerMetrics(period),
      this.pipelineRows(period),
      this.employeeRows(period),
      this.preferenceRows(period),
      this.revenueRows(period),
    ]);
    const pipeline = mapPipeline(pipelineRows);
    const employees = employeeRows.map(mapEmployee);
    const revenue = mapRevenue(revenueRows);
    return {
      customerMetrics: mapCustomerMetrics(customer, 'current'),
      dateFrom,
      dateTo,
      definitions: analyticsDefinitions,
      employees: employees.slice(0, 10),
      generatedAt: new Date().toISOString(),
      pipeline,
      preferences: preferenceRows.slice(0, 10).map(mapPreference),
      previousCustomerMetrics: mapCustomerMetrics(customer, 'previous'),
      previousDateFrom: period.previousDateFrom,
      previousDateTo: period.previousDateTo,
      revenue: topRevenueByDimension(revenue, 8),
      totalNetRevenueBgn: customer.current_net_revenue_bgn,
      timezone: this.environment.BUSINESS_TIMEZONE,
    };
  }

  async exportData(
    definitionKey: CrmReportDefinitionKey,
    filters: { dateFrom?: string; dateTo?: string },
  ): Promise<FinanceReportExportData> {
    const period = requiredPeriod(filters);
    const generatedAt = new Date().toISOString();
    const criteria = [
      `Period: ${period.dateFrom} to ${period.dateTo}`,
      `Dates use ${this.environment.BUSINESS_TIMEZONE}`,
      'Currency: BGN',
    ];

    if (definitionKey === 'crm.customer-value') {
      const row = await this.customerMetrics(period);
      const current = mapCustomerMetrics(row, 'current');
      const previous = mapCustomerMetrics(row, 'previous');
      return {
        columns: [...customerValueColumns],
        criteria: [
          ...criteria,
          `Comparison period: ${period.previousDateFrom} to ${period.previousDateTo}`,
        ],
        generatedAt,
        rows: [
          customerMetricsExportRow('Selected period', current),
          customerMetricsExportRow('Previous equal period', previous),
        ],
        title: 'Customer value and retention',
      };
    }

    if (definitionKey === 'crm.pipeline-performance') {
      const rows = mapPipeline(await this.pipelineRows(period));
      return {
        columns: [...pipelineColumns],
        criteria: [
          ...criteria,
          'Cohort: opportunities created during the selected period',
          'Stage state: last audited stage reached by the end of the period',
        ],
        generatedAt,
        rows: rows.stages.map((stage) => ({
          conversionPercent: stage.conversionFromPreviousPercent ?? '',
          currentCount: stage.currentCount,
          enteredCount: stage.enteredCount,
          stage: stageLabel(stage.stage),
        })),
        title: 'Pipeline conversion',
      };
    }

    if (definitionKey === 'crm.employee-performance') {
      return {
        columns: [...employeeColumns],
        criteria: [
          ...criteria,
          'Completed work: completed Service requests, resolved tickets, and shipped Sales orders',
        ],
        generatedAt,
        rows: (await this.employeeRows(period)).map((row) => {
          const employee = mapEmployee(row);
          return {
            displayName: employee.displayName,
            requestsProcessed: employee.requestsProcessed,
            salesCompleted: employee.salesCompleted,
            ticketsResolved: employee.ticketsResolved,
            totalCompleted: employee.totalCompleted,
          };
        }),
        title: 'Employee performance',
      };
    }

    return {
      columns: [...revenueColumns],
      criteria: [
        ...criteria,
        'Documents: non-cancelled invoices and debit notes less credit notes; proformas excluded',
        'Values exclude VAT and use the exchange-rate snapshot stored on each document',
      ],
      generatedAt,
      rows: mapRevenue(await this.revenueRows(period)).map((row) => ({
        dimension: dimensionLabel(row.dimension),
        documentCount: row.documentCount,
        label: row.label,
        netRevenueBgn: row.netRevenueBgn,
        sharePercent: row.sharePercent,
      })),
      title: 'CRM revenue breakdown',
    };
  }

  private async customerMetrics(period: AnalyticsPeriod): Promise<CustomerMetricRow> {
    const result = await this.database
      .getPool()
      .query<CustomerMetricRow>(customerMetricsQuery, [
        period.dateFrom,
        period.dateTo,
        period.previousDateFrom,
        period.previousDateTo,
        period.prePreviousDateFrom,
        period.prePreviousDateTo,
      ]);
    return result.rows[0] ?? emptyCustomerMetricRow;
  }

  private async pipelineRows(period: AnalyticsPeriod): Promise<PipelineRow[]> {
    const result = await this.database
      .getPool()
      .query<PipelineRow>(pipelineQuery, [
        period.dateFrom,
        period.dateTo,
        this.environment.BUSINESS_TIMEZONE,
      ]);
    return result.rows;
  }

  private async employeeRows(period: AnalyticsPeriod): Promise<EmployeeRow[]> {
    const result = await this.database
      .getPool()
      .query<EmployeeRow>(employeeQuery, [
        period.dateFrom,
        period.dateTo,
        this.environment.BUSINESS_TIMEZONE,
      ]);
    return result.rows;
  }

  private async preferenceRows(period: AnalyticsPeriod): Promise<PreferenceRow[]> {
    const result = await this.database
      .getPool()
      .query<PreferenceRow>(preferenceQuery, [period.dateFrom, period.dateTo]);
    return result.rows;
  }

  private async revenueRows(period: AnalyticsPeriod): Promise<RevenueRow[]> {
    const result = await this.database
      .getPool()
      .query<RevenueRow>(revenueQuery, [period.dateFrom, period.dateTo]);
    return result.rows;
  }
}

function mapCustomerMetrics(
  row: CustomerMetricRow,
  period: 'current' | 'previous',
): CrmAnalyticsCustomerMetrics {
  return {
    activeCustomers: Number(row[`${period}_active_customers`]),
    averageTransactionValueBgn: row[`${period}_average_transaction_value_bgn`],
    churnPercent: row[`${period}_churn_percent`],
    observedLifetimeValueBgn: row[`${period}_observed_lifetime_value_bgn`],
    purchaseFrequency: row[`${period}_purchase_frequency`],
    retentionPercent: row[`${period}_retention_percent`],
  };
}

function mapPipeline(rows: PipelineRow[]): CrmAnalyticsOverview['pipeline'] {
  const first = rows[0];
  let previousEntered: number | undefined;
  const stages: CrmAnalyticsPipelineStageMetric[] = rows.map((row) => {
    const enteredCount = Number(row.entered_count);
    const metric: CrmAnalyticsPipelineStageMetric = {
      currentCount: Number(row.current_count),
      enteredCount,
      stage: row.stage,
      ...(previousEntered === undefined || row.stage === 'lost'
        ? {}
        : { conversionFromPreviousPercent: percent(enteredCount, previousEntered) }),
    };
    if (row.stage !== 'lost') previousEntered = enteredCount;
    return metric;
  });
  const wonCount = Number(first?.won_count ?? 0);
  const lostCount = Number(first?.lost_count ?? 0);
  return {
    createdOpportunities: Number(first?.total_opportunities ?? 0),
    estimatedRevenueBgn: first?.estimated_revenue_bgn ?? '0.00',
    lostCount,
    openPipelineValueBgn: first?.open_pipeline_value_bgn ?? '0.00',
    stages,
    winRatePercent: percent(wonCount, wonCount + lostCount),
    wonCount,
  };
}

function mapEmployee(row: EmployeeRow): CrmAnalyticsEmployeeMetric {
  const requestsProcessed = Number(row.requests_processed);
  const salesCompleted = Number(row.sales_completed);
  const ticketsResolved = Number(row.tickets_resolved);
  return {
    displayName: row.display_name,
    requestsProcessed,
    salesCompleted,
    ticketsResolved,
    totalCompleted: requestsProcessed + salesCompleted + ticketsResolved,
  };
}

function mapPreference(row: PreferenceRow): CrmAnalyticsPreference {
  return {
    documentCount: Number(row.document_count),
    kind: row.kind,
    label: row.label,
    netRevenueBgn: row.net_revenue_bgn,
    quantity: row.quantity,
  };
}

function mapRevenue(rows: RevenueRow[]): CrmAnalyticsRevenueMetric[] {
  const totals = new Map<CrmAnalyticsRevenueDimension, number>();
  for (const row of rows) {
    totals.set(row.dimension, (totals.get(row.dimension) ?? 0) + Number(row.net_revenue_bgn));
  }
  return rows.map((row) => ({
    dimension: row.dimension,
    documentCount: Number(row.document_count),
    key: row.key,
    label: row.label,
    netRevenueBgn: row.net_revenue_bgn,
    sharePercent: percent(Number(row.net_revenue_bgn), totals.get(row.dimension) ?? 0),
  }));
}

function topRevenueByDimension(
  rows: CrmAnalyticsRevenueMetric[],
  limit: number,
): CrmAnalyticsRevenueMetric[] {
  const counts = new Map<CrmAnalyticsRevenueDimension, number>();
  return rows.filter((row) => {
    const count = counts.get(row.dimension) ?? 0;
    if (count >= limit) return false;
    counts.set(row.dimension, count + 1);
    return true;
  });
}

function customerMetricsExportRow(
  period: string,
  metrics: CrmAnalyticsCustomerMetrics,
): Record<string, number | string> {
  return {
    activeCustomers: metrics.activeCustomers,
    averageTransactionValueBgn: metrics.averageTransactionValueBgn,
    churnPercent: metrics.churnPercent,
    observedLifetimeValueBgn: metrics.observedLifetimeValueBgn,
    period,
    purchaseFrequency: metrics.purchaseFrequency,
    retentionPercent: metrics.retentionPercent,
  };
}

function requiredPeriod(filters: { dateFrom?: string; dateTo?: string }): AnalyticsPeriod {
  if (!filters.dateFrom || !filters.dateTo) {
    throw new ApiErrorException(
      'CRM_ANALYTICS_DATE_RANGE_REQUIRED',
      'Choose a start and end date for this analysis.',
      HttpStatus.BAD_REQUEST,
    );
  }
  return analyticsPeriod(filters.dateFrom, filters.dateTo);
}

function analyticsPeriod(dateFrom: string, dateTo: string): AnalyticsPeriod {
  const from = parseDate(dateFrom);
  const to = parseDate(dateTo);
  if (from.getTime() > to.getTime()) {
    throw new ApiErrorException(
      'CRM_ANALYTICS_DATE_RANGE_INVALID',
      'The start date cannot be after the end date.',
      HttpStatus.BAD_REQUEST,
    );
  }
  const days = Math.round((to.getTime() - from.getTime()) / dayMs) + 1;
  const previousTo = new Date(from.getTime() - dayMs);
  const previousFrom = new Date(previousTo.getTime() - (days - 1) * dayMs);
  const prePreviousTo = new Date(previousFrom.getTime() - dayMs);
  const prePreviousFrom = new Date(prePreviousTo.getTime() - (days - 1) * dayMs);
  return {
    dateFrom,
    dateTo,
    prePreviousDateFrom: isoDate(prePreviousFrom),
    prePreviousDateTo: isoDate(prePreviousTo),
    previousDateFrom: isoDate(previousFrom),
    previousDateTo: isoDate(previousTo),
  };
}

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) invalidDate();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || isoDate(date) !== value) invalidDate();
  return date;
}

function invalidDate(): never {
  throw new ApiErrorException(
    'CRM_ANALYTICS_DATE_INVALID',
    'Enter a valid reporting date.',
    HttpStatus.BAD_REQUEST,
  );
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function percent(numerator: number, denominator: number): string {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return '0.00';
  }
  return ((numerator / denominator) * 100).toFixed(2);
}

function stageLabel(value: CrmAnalyticsPipelineStage): string {
  return {
    lost: 'Lost',
    negotiation: 'Negotiation',
    new: 'New',
    qualified: 'Qualified',
    quotation_sent: 'Quotation sent',
    won: 'Won',
  }[value];
}

function dimensionLabel(value: CrmAnalyticsRevenueDimension): string {
  return {
    customer: 'Customer',
    employee: 'Responsible employee',
    product: 'Product',
    region: 'Region',
    service: 'Service',
  }[value];
}

const dayMs = 86_400_000;

const emptyCustomerMetricRow: CustomerMetricRow = {
  current_active_customers: '0',
  current_average_transaction_value_bgn: '0.00',
  current_churn_percent: '0.00',
  current_net_revenue_bgn: '0.00',
  current_observed_lifetime_value_bgn: '0.00',
  current_purchase_frequency: '0.00',
  current_retention_percent: '0.00',
  previous_active_customers: '0',
  previous_average_transaction_value_bgn: '0.00',
  previous_churn_percent: '0.00',
  previous_observed_lifetime_value_bgn: '0.00',
  previous_purchase_frequency: '0.00',
  previous_retention_percent: '0.00',
};

const analyticsDefinitions: CrmAnalyticsDefinition[] = [
  {
    dataSources: ['finance.financial_documents'],
    dateWindow: 'Invoice issue dates in the selected period.',
    formula:
      'Active customers are distinct invoiced customers. Purchase frequency is invoice count divided by active customers. Average transaction value is the average stored BGN gross invoice total.',
    key: 'customer-activity',
    label: 'Customer activity',
    statusFilters: ['Non-cancelled invoices only.'],
  },
  {
    dataSources: ['finance.financial_documents'],
    dateWindow: 'Selected issue-date period compared with the immediately preceding equal period.',
    formula:
      'Customers with a non-cancelled invoice in both periods divided by customers with an invoice in the previous period.',
    key: 'customer-retention',
    label: 'Customer retention and churn',
    statusFilters: [
      'Non-cancelled invoices; proformas and correction notes excluded from activity.',
    ],
  },
  {
    dataSources: ['finance.financial_documents'],
    dateWindow: 'All non-cancelled financial documents up to the selected end date.',
    formula:
      'Net recorded BGN value excluding VAT per customer averaged across customers; credit notes reduce value.',
    key: 'observed-clv',
    label: 'Observed customer lifetime value',
    statusFilters: ['Invoices and debit notes less credit notes; proformas excluded.'],
  },
  {
    dataSources: [
      'finance.financial_documents',
      'finance.financial_document_lines',
      'master_data.products',
      'service.work_orders',
    ],
    dateWindow: 'Financial-document issue dates in the selected period.',
    formula:
      'Products and Service types are ranked by document count, quantity, and stored net BGN value excluding VAT.',
    key: 'customer-preferences',
    label: 'Preferred products and services',
    statusFilters: [
      'Non-cancelled invoices and debit notes less credit notes; proformas excluded.',
    ],
  },
  {
    dataSources: ['crm.opportunities', 'crm.opportunity_history'],
    dateWindow: 'Opportunities created in the selected period, observed through the period end.',
    formula: 'Distinct opportunities entering a stage divided by entries into the previous stage.',
    key: 'pipeline-conversion',
    label: 'Pipeline conversion',
    statusFilters: ['Audited stage history only.'],
  },
  {
    dataSources: [
      'finance.financial_documents',
      'finance.financial_document_lines',
      'sales',
      'service',
      'master_data',
    ],
    dateWindow: 'Financial-document issue dates in the selected period.',
    formula:
      'Stored net BGN value excluding VAT for invoices and debit notes less credit notes, grouped by each dimension.',
    key: 'recorded-revenue',
    label: 'Recorded revenue',
    statusFilters: ['Non-cancelled documents; proformas excluded.'],
  },
  {
    dataSources: ['service.requests', 'crm.tickets', 'sales.shipments', 'identity.employees'],
    dateWindow: 'Completion, resolution, or shipment dates in the selected period.',
    formula:
      'Count of completed records attributed to the responsible employee stored on each record.',
    key: 'employee-performance',
    label: 'Employee performance',
    statusFilters: ['Completed Service, resolved/closed tickets, and shipped Sales orders.'],
  },
];

const customerMetricsQuery = `
WITH invoice_activity AS (
  SELECT customer_partner_id, issue_date, bgn_gross_total
  FROM finance.financial_documents
  WHERE status <> 'cancelled' AND document_type = 'invoice'
), document_value AS (
  SELECT customer_partner_id, issue_date,
         CASE WHEN document_type = 'credit_note' THEN -bgn_net_total ELSE bgn_net_total END AS value_bgn
  FROM finance.financial_documents
  WHERE status <> 'cancelled' AND document_type IN ('invoice', 'credit_note', 'debit_note')
), current_customers AS (
  SELECT DISTINCT customer_partner_id FROM invoice_activity WHERE issue_date BETWEEN $1::date AND $2::date
), previous_customers AS (
  SELECT DISTINCT customer_partner_id FROM invoice_activity WHERE issue_date BETWEEN $3::date AND $4::date
), pre_previous_customers AS (
  SELECT DISTINCT customer_partner_id FROM invoice_activity WHERE issue_date BETWEEN $5::date AND $6::date
), current_invoice_metrics AS (
  SELECT count(*)::numeric AS invoice_count, count(DISTINCT customer_partner_id)::numeric AS customers,
         coalesce(avg(bgn_gross_total), 0) AS average_value
  FROM invoice_activity WHERE issue_date BETWEEN $1::date AND $2::date
), previous_invoice_metrics AS (
  SELECT count(*)::numeric AS invoice_count, count(DISTINCT customer_partner_id)::numeric AS customers,
         coalesce(avg(bgn_gross_total), 0) AS average_value
  FROM invoice_activity WHERE issue_date BETWEEN $3::date AND $4::date
), current_lifetime AS (
  SELECT coalesce(avg(customer_value), 0) AS average_value FROM (
    SELECT customer_partner_id, sum(value_bgn) AS customer_value
    FROM document_value WHERE issue_date <= $2::date GROUP BY customer_partner_id
  ) value
), previous_lifetime AS (
  SELECT coalesce(avg(customer_value), 0) AS average_value FROM (
    SELECT customer_partner_id, sum(value_bgn) AS customer_value
    FROM document_value WHERE issue_date <= $4::date GROUP BY customer_partner_id
  ) value
), current_revenue AS (
  SELECT coalesce(sum(value_bgn), 0) AS value FROM document_value WHERE issue_date BETWEEN $1::date AND $2::date
)
SELECT
  current_invoice_metrics.customers::text AS current_active_customers,
  round(current_invoice_metrics.average_value, 2)::text AS current_average_transaction_value_bgn,
  round(CASE WHEN (SELECT count(*) FROM previous_customers) = 0 THEN 0 ELSE
    ((SELECT count(*) FROM previous_customers previous_customer WHERE NOT EXISTS (
      SELECT 1 FROM current_customers current_customer
      WHERE current_customer.customer_partner_id = previous_customer.customer_partner_id
    ))::numeric / (SELECT count(*) FROM previous_customers)::numeric) * 100 END, 2)::text AS current_churn_percent,
  round(current_revenue.value, 2)::text AS current_net_revenue_bgn,
  round(current_lifetime.average_value, 2)::text AS current_observed_lifetime_value_bgn,
  round(CASE WHEN current_invoice_metrics.customers = 0 THEN 0 ELSE
    current_invoice_metrics.invoice_count / current_invoice_metrics.customers END, 2)::text AS current_purchase_frequency,
  round(CASE WHEN (SELECT count(*) FROM previous_customers) = 0 THEN 0 ELSE
    ((SELECT count(*) FROM previous_customers previous_customer WHERE EXISTS (
      SELECT 1 FROM current_customers current_customer
      WHERE current_customer.customer_partner_id = previous_customer.customer_partner_id
    ))::numeric / (SELECT count(*) FROM previous_customers)::numeric) * 100 END, 2)::text AS current_retention_percent,
  previous_invoice_metrics.customers::text AS previous_active_customers,
  round(previous_invoice_metrics.average_value, 2)::text AS previous_average_transaction_value_bgn,
  round(CASE WHEN (SELECT count(*) FROM pre_previous_customers) = 0 THEN 0 ELSE
    ((SELECT count(*) FROM pre_previous_customers prior_customer WHERE NOT EXISTS (
      SELECT 1 FROM previous_customers previous_customer
      WHERE previous_customer.customer_partner_id = prior_customer.customer_partner_id
    ))::numeric / (SELECT count(*) FROM pre_previous_customers)::numeric) * 100 END, 2)::text AS previous_churn_percent,
  round(previous_lifetime.average_value, 2)::text AS previous_observed_lifetime_value_bgn,
  round(CASE WHEN previous_invoice_metrics.customers = 0 THEN 0 ELSE
    previous_invoice_metrics.invoice_count / previous_invoice_metrics.customers END, 2)::text AS previous_purchase_frequency,
  round(CASE WHEN (SELECT count(*) FROM pre_previous_customers) = 0 THEN 0 ELSE
    ((SELECT count(*) FROM pre_previous_customers prior_customer WHERE EXISTS (
      SELECT 1 FROM previous_customers previous_customer
      WHERE previous_customer.customer_partner_id = prior_customer.customer_partner_id
    ))::numeric / (SELECT count(*) FROM pre_previous_customers)::numeric) * 100 END, 2)::text AS previous_retention_percent
FROM current_invoice_metrics, previous_invoice_metrics, current_lifetime, previous_lifetime, current_revenue`;

const pipelineQuery = `
WITH stages(stage, ordinal) AS (
  VALUES ('new'::text, 1), ('qualified', 2), ('quotation_sent', 3),
         ('negotiation', 4), ('won', 5), ('lost', 6)
), cohort AS (
  SELECT opportunity.*
  FROM crm.opportunities opportunity
  WHERE (opportunity.created_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date
), history AS (
  SELECT history.opportunity_id, history.next_stage, history.changed_at
  FROM crm.opportunity_history history
  JOIN cohort ON cohort.id = history.opportunity_id
  WHERE (history.changed_at AT TIME ZONE $3)::date <= $2::date
), latest AS (
  SELECT DISTINCT ON (opportunity_id) opportunity_id, next_stage
  FROM history ORDER BY opportunity_id, changed_at DESC
), totals AS (
  SELECT count(*)::text AS total_opportunities,
         coalesce(sum(estimated_revenue_bgn), 0)::text AS estimated_revenue_bgn,
         coalesce(sum(estimated_revenue_bgn) FILTER (
           WHERE coalesce(latest.next_stage, cohort.stage) NOT IN ('won', 'lost')
         ), 0)::text AS open_pipeline_value_bgn,
         count(*) FILTER (WHERE coalesce(latest.next_stage, cohort.stage) = 'won')::text AS won_count,
         count(*) FILTER (WHERE coalesce(latest.next_stage, cohort.stage) = 'lost')::text AS lost_count
  FROM cohort LEFT JOIN latest ON latest.opportunity_id = cohort.id
)
SELECT stages.stage,
       CASE WHEN stages.stage = 'new' THEN (SELECT count(*) FROM cohort)::text
         ELSE (SELECT count(DISTINCT history.opportunity_id) FROM history
               WHERE history.next_stage = stages.stage)::text END AS entered_count,
       (SELECT count(*) FROM cohort LEFT JOIN latest ON latest.opportunity_id = cohort.id
        WHERE coalesce(latest.next_stage, cohort.stage) = stages.stage)::text AS current_count,
       totals.total_opportunities, totals.estimated_revenue_bgn,
       totals.open_pipeline_value_bgn, totals.won_count, totals.lost_count
FROM stages CROSS JOIN totals ORDER BY stages.ordinal`;

const employeeQuery = `
WITH activity AS (
  SELECT request.updated_by AS account_id, 1 AS requests_processed, 0 AS tickets_resolved, 0 AS sales_completed
  FROM service.requests request
  WHERE request.status = 'completed' AND request.completed_at IS NOT NULL
    AND (request.completed_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date
  UNION ALL
  SELECT coalesce(ticket.assigned_to_account_id, ticket.updated_by), 0, 1, 0
  FROM crm.tickets ticket
  WHERE ticket.status IN ('resolved', 'closed') AND ticket.resolved_at IS NOT NULL
    AND (ticket.resolved_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date
  UNION ALL
  SELECT shipment.shipped_by, 0, 0, 1
  FROM sales.shipments shipment
  WHERE (shipment.shipped_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date
)
SELECT employee.display_name,
       sum(activity.requests_processed)::text AS requests_processed,
       sum(activity.tickets_resolved)::text AS tickets_resolved,
       sum(activity.sales_completed)::text AS sales_completed
FROM activity
JOIN identity.user_accounts account ON account.id = activity.account_id
JOIN identity.employees employee ON employee.id = account.employee_id
GROUP BY account.id, employee.display_name
ORDER BY sum(activity.requests_processed + activity.tickets_resolved + activity.sales_completed) DESC,
         employee.display_name`;

const preferenceQuery = `
WITH document AS (
  SELECT id, source_service_work_order_id, document_type, exchange_rate
  FROM finance.financial_documents
  WHERE status <> 'cancelled' AND document_type IN ('invoice', 'credit_note', 'debit_note')
    AND issue_date BETWEEN $1::date AND $2::date
), product_preference AS (
  SELECT 'product'::text AS kind, product.name AS label,
         count(DISTINCT document.id)::text AS document_count,
         sum(CASE WHEN document.document_type = 'credit_note' THEN -line.quantity ELSE line.quantity END)::text AS quantity,
         round(sum(CASE WHEN document.document_type = 'credit_note' THEN -1 ELSE 1 END
           * line.net_total * document.exchange_rate), 2)::text AS net_revenue_bgn
  FROM document
  JOIN finance.financial_document_lines line ON line.financial_document_id = document.id
  JOIN master_data.products product ON product.id = line.product_id
  GROUP BY product.id, product.name
), service_preference AS (
  SELECT 'service'::text AS kind,
         CASE request.service_type WHEN 'warranty' THEN 'Warranty Service'
           WHEN 'out_of_warranty' THEN 'Out-of-warranty Service'
           ELSE 'Service subscription' END AS label,
         count(DISTINCT document.id)::text AS document_count,
         count(DISTINCT document.id)::text AS quantity,
         round(sum(CASE WHEN document.document_type = 'credit_note' THEN -financial.bgn_net_total
           ELSE financial.bgn_net_total END), 2)::text AS net_revenue_bgn
  FROM document
  JOIN finance.financial_documents financial ON financial.id = document.id
  JOIN service.work_orders work_order ON work_order.id = document.source_service_work_order_id
  JOIN service.requests request ON request.id = work_order.service_request_id
  GROUP BY request.service_type
)
SELECT * FROM (
  SELECT * FROM product_preference
  UNION ALL
  SELECT * FROM service_preference
) preference
ORDER BY preference.document_count::numeric DESC, preference.net_revenue_bgn::numeric DESC,
         preference.label
LIMIT 10`;

const revenueQuery = `
WITH document AS (
  SELECT financial.*, coalesce(address.city, 'Region not recorded') AS region_name,
         coalesce(quotation.created_by, work_order.assigned_technician_account_id, financial.created_by)
           AS responsible_account_id,
         CASE WHEN financial.document_type = 'credit_note' THEN -1 ELSE 1 END AS direction
  FROM finance.financial_documents financial
  LEFT JOIN LATERAL (
    SELECT partner_address.city FROM master_data.partner_addresses partner_address
    WHERE partner_address.partner_id = financial.customer_partner_id AND partner_address.active = true
    ORDER BY CASE partner_address.address_type WHEN 'registered' THEN 1 WHEN 'billing' THEN 2 ELSE 3 END,
             partner_address.created_at, partner_address.id LIMIT 1
  ) address ON true
  LEFT JOIN sales.invoices sales_invoice ON sales_invoice.id = financial.source_sales_invoice_id
  LEFT JOIN sales.orders sales_order ON sales_order.id = sales_invoice.order_id
  LEFT JOIN sales.quotations quotation ON quotation.id = sales_order.quotation_id
  LEFT JOIN service.work_orders work_order ON work_order.id = financial.source_service_work_order_id
  WHERE financial.status <> 'cancelled'
    AND financial.document_type IN ('invoice', 'credit_note', 'debit_note')
    AND financial.issue_date BETWEEN $1::date AND $2::date
), dimension_rows AS (
  SELECT 'product'::text AS dimension, product.id::text AS key, product.name AS label,
         count(DISTINCT document.id)::text AS document_count,
         round(sum(document.direction * line.net_total * document.exchange_rate), 2)::text AS net_revenue_bgn
  FROM document
  JOIN finance.financial_document_lines line ON line.financial_document_id = document.id
  JOIN master_data.products product ON product.id = line.product_id
  GROUP BY product.id, product.name
  UNION ALL
  SELECT 'service', request.service_type,
         CASE request.service_type WHEN 'warranty' THEN 'Warranty Service'
           WHEN 'out_of_warranty' THEN 'Out-of-warranty Service'
           ELSE 'Service subscription' END,
         count(DISTINCT document.id)::text,
         round(sum(document.direction * document.bgn_net_total), 2)::text
  FROM document
  JOIN service.work_orders work_order ON work_order.id = document.source_service_work_order_id
  JOIN service.requests request ON request.id = work_order.service_request_id
  GROUP BY request.service_type
  UNION ALL
  SELECT 'customer', document.customer_partner_id::text, document.customer_name,
         count(*)::text, round(sum(document.direction * document.bgn_net_total), 2)::text
  FROM document GROUP BY document.customer_partner_id, document.customer_name
  UNION ALL
  SELECT 'region', lower(document.region_name), document.region_name,
         count(*)::text, round(sum(document.direction * document.bgn_net_total), 2)::text
  FROM document GROUP BY document.region_name
  UNION ALL
  SELECT 'employee', account.id::text, employee.display_name,
         count(*)::text, round(sum(document.direction * document.bgn_net_total), 2)::text
  FROM document
  JOIN identity.user_accounts account ON account.id = document.responsible_account_id
  JOIN identity.employees employee ON employee.id = account.employee_id
  GROUP BY account.id, employee.display_name
)
SELECT dimension, key, label, document_count, net_revenue_bgn
FROM dimension_rows
ORDER BY dimension, net_revenue_bgn::numeric DESC, label`;

export function crmReportColumns(key: CrmReportDefinitionKey): FinanceReportExportData['columns'] {
  switch (key) {
    case 'crm.customer-value':
      return [...customerValueColumns];
    case 'crm.pipeline-performance':
      return [...pipelineColumns];
    case 'crm.employee-performance':
      return [...employeeColumns];
    case 'crm.revenue-breakdown':
      return [...revenueColumns];
    default:
      throw new ApiErrorException('REPORT_NOT_FOUND', 'This report is not available.', 404);
  }
}

const customerValueColumns = [
  { key: 'period', label: 'Window', type: 'text' },
  { key: 'activeCustomers', label: 'Active customers', type: 'number' },
  { key: 'purchaseFrequency', label: 'Purchase frequency', type: 'text' },
  { key: 'averageTransactionValueBgn', label: 'Average transaction BGN', type: 'money' },
  { key: 'retentionPercent', label: 'Retention %', type: 'text' },
  { key: 'churnPercent', label: 'Churn %', type: 'text' },
  { key: 'observedLifetimeValueBgn', label: 'Observed customer value BGN', type: 'money' },
] as const;

const pipelineColumns = [
  { key: 'stage', label: 'Stage', type: 'text' },
  { key: 'enteredCount', label: 'Entered', type: 'number' },
  { key: 'currentCount', label: 'Current', type: 'number' },
  { key: 'conversionPercent', label: 'Conversion from previous %', type: 'text' },
] as const;

const employeeColumns = [
  { key: 'displayName', label: 'Employee', type: 'text' },
  { key: 'requestsProcessed', label: 'Service requests completed', type: 'number' },
  { key: 'ticketsResolved', label: 'Tickets resolved', type: 'number' },
  { key: 'salesCompleted', label: 'Sales shipped', type: 'number' },
  { key: 'totalCompleted', label: 'Total completed', type: 'number' },
] as const;

const revenueColumns = [
  { key: 'dimension', label: 'Dimension', type: 'text' },
  { key: 'label', label: 'Name', type: 'text' },
  { key: 'documentCount', label: 'Documents', type: 'number' },
  { key: 'netRevenueBgn', label: 'Net recorded value BGN', type: 'money' },
  { key: 'sharePercent', label: 'Share %', type: 'text' },
] as const;
