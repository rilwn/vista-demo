import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  PosCashierReportRow,
  PosCategoryReportRow,
  PosLocationReportRow,
  PosPaymentReportRow,
  PosProductReportRow,
  PosReportDefinitionKey,
  PosReportFilters,
  PosReportOverview,
  PosReportReferenceData,
  PosShiftReportRow,
} from '@vista/contracts';

import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';
import type { FinanceReportExportData } from '../finance/finance-reports.service.js';

interface TotalRow {
  gross_returns_bgn: string;
  gross_sales_bgn: string;
  item_quantity_returned: string;
  item_quantity_sold: string;
  net_returns_bgn: string;
  net_sales_bgn: string;
  return_count: string;
  sale_count: string;
  vat_returns_bgn: string;
  vat_sales_bgn: string;
}

interface CashierRow {
  gross_returns_bgn: string;
  gross_sales_bgn: string;
  name: string;
  net_revenue_bgn: string;
  operator_code: string;
  operator_id: string;
  return_count: string;
  sale_count: string;
}

interface ProductRow {
  category_name: string;
  gross_returns_bgn: string;
  gross_sales_bgn: string;
  net_revenue_bgn: string;
  product_code: string;
  product_id: string;
  product_name: string;
  quantity_returned: string;
  quantity_sold: string;
}

interface CategoryRow {
  category_id: string;
  category_name: string;
  gross_returns_bgn: string;
  gross_sales_bgn: string;
  net_revenue_bgn: string;
  quantity_returned: string;
  quantity_sold: string;
}

interface PaymentRow {
  collected_bgn: string;
  method: PosPaymentReportRow['method'];
  net_bgn: string;
  refunded_bgn: string;
}

interface LocationRow {
  business_location_id: string;
  gross_returns_bgn: string;
  gross_sales_bgn: string;
  location_name: string;
  net_revenue_bgn: string;
  return_count: string;
  sale_count: string;
}

interface ShiftReportRow {
  cash_register_code: string;
  cash_register_id: string;
  cash_register_name: string;
  cash_refunds_bgn: string;
  cash_sales_bgn: string;
  closed_at: Date | string | null;
  closing_cash_bgn: string | null;
  difference_bgn: string | null;
  expected_cash_bgn: string;
  fiscal_mode: PosShiftReportRow['fiscalMode'];
  gross_returns_bgn: string;
  gross_sales_bgn: string;
  id: string;
  location_name: string;
  net_revenue_bgn: string;
  opened_at: Date | string;
  opening_cash_bgn: string;
  operator_code: string;
  operator_id: string;
  operator_name: string;
  return_count: string;
  sale_count: string;
  shift_number: string;
  status: PosShiftReportRow['status'];
}

interface PosExportFilters {
  asOf?: string;
  businessLocationId?: string;
  cashRegisterId?: string;
  dateFrom?: string;
  dateTo?: string;
  operatorId?: string;
  shiftId?: string;
}

@Injectable()
export class PosReportsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {}

  async referenceData(): Promise<PosReportReferenceData> {
    const [locations, registers, operators] = await Promise.all([
      this.database.getPool().query<{ id: string; name: string }>(
        `SELECT DISTINCT location.id, location.name
         FROM organization.business_locations location
         JOIN organization.cash_registers register
           ON register.business_location_id = location.id AND register.active
         JOIN pos.terminal_configurations configuration
           ON configuration.cash_register_id = register.id AND configuration.active
         WHERE location.active
         ORDER BY location.name, location.id`,
      ),
      this.database.getPool().query<{
        business_location_id: string;
        code: string;
        id: string;
        name: string;
      }>(
        `SELECT register.id, register.code, register.name, register.business_location_id
         FROM organization.cash_registers register
         JOIN pos.terminal_configurations configuration
           ON configuration.cash_register_id = register.id AND configuration.active
         JOIN organization.business_locations location
           ON location.id = register.business_location_id AND location.active
         WHERE register.active
         ORDER BY location.name, register.name, register.id`,
      ),
      this.database.getPool().query<{
        business_location_id: string;
        code: string;
        id: string;
        name: string;
      }>(
        `SELECT DISTINCT operator.id, operator.code, operator.business_location_id,
           employee.display_name AS name
         FROM organization.operators operator
         JOIN identity.user_accounts account ON account.id = operator.account_id
         JOIN identity.employees employee ON employee.id = account.employee_id
         JOIN organization.cash_register_operators assignment
           ON assignment.operator_id = operator.id AND assignment.active
         JOIN pos.terminal_configurations configuration
           ON configuration.cash_register_id = assignment.cash_register_id
          AND configuration.active
         WHERE operator.active AND account.status = 'active'
         ORDER BY employee.display_name, operator.code, operator.id`,
      ),
    ]);
    return {
      businessTimezone: this.environment.BUSINESS_TIMEZONE,
      locations: locations.rows,
      operators: operators.rows.map((row) => ({
        businessLocationId: row.business_location_id,
        code: row.code,
        id: row.id,
        name: row.name,
      })),
      registers: registers.rows.map((row) => ({
        businessLocationId: row.business_location_id,
        code: row.code,
        id: row.id,
        name: row.name,
      })),
    };
  }

  async overview(filters: PosReportFilters): Promise<PosReportOverview> {
    requirePeriod(filters.dateFrom, filters.dateTo);
    const parameters = reportParameters(filters, this.environment.BUSINESS_TIMEZONE);
    const [totals, cashiers, products, categories, payments, locations, shifts] = await Promise.all(
      [
        this.database.getPool().query<TotalRow>(totalsSql, parameters),
        this.database.getPool().query<CashierRow>(cashiersSql, parameters),
        this.database.getPool().query<ProductRow>(productsSql, parameters),
        this.database.getPool().query<CategoryRow>(categoriesSql, parameters),
        this.database.getPool().query<PaymentRow>(paymentsSql, parameters),
        this.database.getPool().query<LocationRow>(locationsSql, parameters),
        this.database.getPool().query<ShiftReportRow>(shiftsSql, parameters),
      ],
    );
    const total = required(totals.rows[0], 'POS report totals could not be calculated');
    const saleCount = Number(total.sale_count);
    const mappedLocations = mapLocations(locations.rows);
    return {
      cashiers: cashiers.rows.map(mapCashier),
      categories: categories.rows.map(mapCategory),
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      generatedAt: new Date().toISOString(),
      locations: mappedLocations,
      payments: payments.rows.map(mapPayment),
      products: products.rows.map(mapProduct),
      shifts: shifts.rows.map(mapShift),
      timezone: this.environment.BUSINESS_TIMEZONE,
      totals: {
        averageSaleBgn: saleCount
          ? (Number(total.gross_sales_bgn) / saleCount).toFixed(4)
          : '0.0000',
        grossReturnsBgn: total.gross_returns_bgn,
        grossSalesBgn: total.gross_sales_bgn,
        itemQuantityReturned: total.item_quantity_returned,
        itemQuantitySold: total.item_quantity_sold,
        netRevenueBgn: subtract(total.gross_sales_bgn, total.gross_returns_bgn),
        netSalesBgn: subtract(total.net_sales_bgn, total.net_returns_bgn),
        returnCount: Number(total.return_count),
        saleCount,
        vatSalesBgn: subtract(total.vat_sales_bgn, total.vat_returns_bgn),
      },
    };
  }

  async exportData(
    definitionKey: PosReportDefinitionKey,
    filters: PosExportFilters,
  ): Promise<FinanceReportExportData> {
    if (definitionKey === 'pos.x-report' || definitionKey === 'pos.z-report') {
      const shiftId = filters.shiftId;
      if (!shiftId)
        throw new ApiErrorException(
          'POS_REPORT_SHIFT_REQUIRED',
          'Choose a cashier shift for this report.',
          HttpStatus.BAD_REQUEST,
        );
      const shift = await this.shiftSnapshot(shiftId, filters.asOf);
      if (definitionKey === 'pos.x-report' && shift.status !== 'open')
        throw new ApiErrorException(
          'POS_X_REPORT_REQUIRES_OPEN_SHIFT',
          'Choose an open shift for an X report.',
          HttpStatus.CONFLICT,
        );
      if (definitionKey === 'pos.z-report' && shift.status !== 'closed')
        throw new ApiErrorException(
          'POS_Z_REPORT_REQUIRES_CLOSED_SHIFT',
          'Choose a closed shift for a Z report.',
          HttpStatus.CONFLICT,
        );
      return {
        columns: [...shiftColumns],
        criteria: [
          `Shift: ${shift.shiftNumber}`,
          `Register: ${shift.cashRegisterName}`,
          `Cashier: ${shift.operatorName}`,
          ...(filters.asOf ? [`Snapshot time: ${filters.asOf}`] : []),
          `Times use ${this.environment.BUSINESS_TIMEZONE}`,
          'Currency: BGN',
          fiscalCriterion(shift.fiscalMode),
        ],
        generatedAt: new Date().toISOString(),
        rows: [shiftExportRow(shift)],
        title: definitionKey === 'pos.x-report' ? 'POS X report' : 'POS Z report',
      };
    }

    const period = requiredPeriod(filters);
    const reportFilters: PosReportFilters = {
      dateFrom: period.dateFrom,
      dateTo: period.dateTo,
      ...(filters.businessLocationId ? { businessLocationId: filters.businessLocationId } : {}),
      ...(filters.cashRegisterId ? { cashRegisterId: filters.cashRegisterId } : {}),
      ...(filters.operatorId ? { operatorId: filters.operatorId } : {}),
    };
    const report = await this.overview(reportFilters);
    const criteria = await this.criteria(reportFilters);
    const generatedAt = new Date().toISOString();
    if (definitionKey === 'pos.shift-register')
      return reportData('POS shift register', shiftColumns, report.shifts.map(shiftExportRow));
    if (definitionKey === 'pos.cashier-performance')
      return reportData(
        'POS cashier report',
        cashierColumns,
        report.cashiers.map((row) => ({
          cashier: row.name,
          grossReturnsBgn: row.grossReturnsBgn,
          grossSalesBgn: row.grossSalesBgn,
          netRevenueBgn: row.netRevenueBgn,
          operatorCode: row.operatorCode,
          returnCount: row.returnCount,
          saleCount: row.saleCount,
        })),
      );
    if (definitionKey === 'pos.product-sales')
      return reportData(
        'POS product sales',
        productColumns,
        report.products.map((row) => ({
          category: row.categoryName,
          grossReturnsBgn: row.grossReturnsBgn,
          grossSalesBgn: row.grossSalesBgn,
          netRevenueBgn: row.netRevenueBgn,
          productCode: row.productCode,
          productName: row.productName,
          quantityReturned: row.quantityReturned,
          quantitySold: row.quantitySold,
        })),
      );
    if (definitionKey === 'pos.category-sales')
      return reportData(
        'POS category sales',
        categoryColumns,
        report.categories.map((row) => ({
          category: row.categoryName,
          grossReturnsBgn: row.grossReturnsBgn,
          grossSalesBgn: row.grossSalesBgn,
          netRevenueBgn: row.netRevenueBgn,
          quantityReturned: row.quantityReturned,
          quantitySold: row.quantitySold,
        })),
      );
    if (definitionKey === 'pos.payment-methods')
      return reportData(
        'POS payment methods',
        paymentColumns,
        report.payments.map((row) => ({
          collectedBgn: row.collectedBgn,
          method: paymentLabel(row.method),
          netBgn: row.netBgn,
          refundedBgn: row.refundedBgn,
        })),
      );
    const comparison = definitionKey === 'pos.location-comparison';
    return reportData(
      comparison ? 'POS location comparison' : 'POS location sales',
      comparison ? locationComparisonColumns : locationColumns,
      report.locations.map((row) => ({
        averageSaleBgn: row.averageSaleBgn,
        grossReturnsBgn: row.grossReturnsBgn,
        grossSalesBgn: row.grossSalesBgn,
        location: row.locationName,
        netRevenueBgn: row.netRevenueBgn,
        returnCount: row.returnCount,
        revenueSharePercent: row.revenueSharePercent,
        saleCount: row.saleCount,
      })),
    );

    function reportData(
      title: string,
      columns: ReadonlyArray<FinanceReportExportData['columns'][number]>,
      rows: FinanceReportExportData['rows'],
    ): FinanceReportExportData {
      return { columns: [...columns], criteria, generatedAt, rows, title };
    }
  }

  private async shiftSnapshot(id: string, asOf?: string): Promise<PosShiftReportRow> {
    const result = await this.database
      .getPool()
      .query<ShiftReportRow>(shiftSnapshotSql, [id, asOf ?? null]);
    const row = result.rows[0];
    if (!row)
      throw new ApiErrorException(
        'POS_SHIFT_REPORT_NOT_FOUND',
        'The selected cashier shift could not be found.',
        HttpStatus.NOT_FOUND,
      );
    return mapShift(row);
  }

  private async criteria(filters: PosReportFilters): Promise<string[]> {
    const references = await this.referenceData();
    const location = references.locations.find((item) => item.id === filters.businessLocationId);
    const register = references.registers.find((item) => item.id === filters.cashRegisterId);
    const operator = references.operators.find((item) => item.id === filters.operatorId);
    return [
      `Period: ${filters.dateFrom} to ${filters.dateTo}`,
      `Dates use ${this.environment.BUSINESS_TIMEZONE}`,
      'Currency: BGN',
      ...(location ? [`Location: ${location.name}`] : []),
      ...(register ? [`Register: ${register.name}`] : []),
      ...(operator ? [`Cashier: ${operator.name}`] : []),
    ];
  }
}

const transactionPeriod = (alias: string) => `
  (${alias}.completed_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date
  AND ($4::uuid IS NULL OR register.business_location_id = $4)
  AND ($5::uuid IS NULL OR register.id = $5)
  AND ($6::uuid IS NULL OR shift.operator_id = $6)`;

const totalsSql = `
  WITH sale_values AS (
    SELECT count(*)::text AS sale_count,
      COALESCE(sum(sale.net_total), 0)::text AS net_sales_bgn,
      COALESCE(sum(sale.vat_total), 0)::text AS vat_sales_bgn,
      COALESCE(sum(sale.gross_total), 0)::text AS gross_sales_bgn
    FROM pos.sales sale
    JOIN pos.shifts shift ON shift.id = sale.shift_id
    JOIN organization.cash_registers register ON register.id = shift.cash_register_id
    WHERE ${transactionPeriod('sale')}
  ), sale_items AS (
    SELECT COALESCE(sum(line.quantity), 0)::text AS item_quantity_sold
    FROM pos.sale_lines line
    JOIN pos.sales sale ON sale.id = line.sale_id
    JOIN pos.shifts shift ON shift.id = sale.shift_id
    JOIN organization.cash_registers register ON register.id = shift.cash_register_id
    WHERE ${transactionPeriod('sale')}
  ), return_values AS (
    SELECT count(*)::text AS return_count,
      COALESCE(sum(pos_return.net_total), 0)::text AS net_returns_bgn,
      COALESCE(sum(pos_return.vat_total), 0)::text AS vat_returns_bgn,
      COALESCE(sum(pos_return.gross_total), 0)::text AS gross_returns_bgn
    FROM pos.returns pos_return
    JOIN pos.shifts shift ON shift.id = pos_return.shift_id
    JOIN organization.cash_registers register ON register.id = shift.cash_register_id
    WHERE ${transactionPeriod('pos_return')}
  ), return_items AS (
    SELECT COALESCE(sum(line.quantity), 0)::text AS item_quantity_returned
    FROM pos.return_lines line
    JOIN pos.returns pos_return ON pos_return.id = line.return_id
    JOIN pos.shifts shift ON shift.id = pos_return.shift_id
    JOIN organization.cash_registers register ON register.id = shift.cash_register_id
    WHERE ${transactionPeriod('pos_return')}
  )
  SELECT sale_values.*, sale_items.*, return_values.*, return_items.*
  FROM sale_values CROSS JOIN sale_items CROSS JOIN return_values CROSS JOIN return_items`;

const cashiersSql = `
  WITH activity AS (
    SELECT shift.operator_id, 1 AS sale_count, 0 AS return_count,
      sale.gross_total AS gross_sales_bgn, 0::numeric AS gross_returns_bgn
    FROM pos.sales sale
    JOIN pos.shifts shift ON shift.id = sale.shift_id
    JOIN organization.cash_registers register ON register.id = shift.cash_register_id
    WHERE ${transactionPeriod('sale')}
    UNION ALL
    SELECT shift.operator_id, 0, 1, 0::numeric, pos_return.gross_total
    FROM pos.returns pos_return
    JOIN pos.shifts shift ON shift.id = pos_return.shift_id
    JOIN organization.cash_registers register ON register.id = shift.cash_register_id
    WHERE ${transactionPeriod('pos_return')}
  )
  SELECT operator.id AS operator_id, operator.code AS operator_code,
    employee.display_name AS name, sum(activity.sale_count)::text AS sale_count,
    sum(activity.return_count)::text AS return_count,
    sum(activity.gross_sales_bgn)::text AS gross_sales_bgn,
    sum(activity.gross_returns_bgn)::text AS gross_returns_bgn,
    (sum(activity.gross_sales_bgn) - sum(activity.gross_returns_bgn))::text
      AS net_revenue_bgn
  FROM activity
  JOIN organization.operators operator ON operator.id = activity.operator_id
  JOIN identity.user_accounts account ON account.id = operator.account_id
  JOIN identity.employees employee ON employee.id = account.employee_id
  GROUP BY operator.id, operator.code, employee.display_name
  ORDER BY net_revenue_bgn DESC, employee.display_name, operator.id`;

const productsSql = `
  WITH activity AS (
    SELECT line.product_id, line.product_code, line.product_name, line.category_name,
      line.quantity AS quantity_sold, 0::numeric AS quantity_returned,
      line.gross_total AS gross_sales_bgn, 0::numeric AS gross_returns_bgn
    FROM pos.sale_lines line
    JOIN pos.sales sale ON sale.id = line.sale_id
    JOIN pos.shifts shift ON shift.id = sale.shift_id
    JOIN organization.cash_registers register ON register.id = shift.cash_register_id
    WHERE ${transactionPeriod('sale')}
    UNION ALL
    SELECT line.product_id, line.product_code, line.product_name, line.category_name,
      0::numeric, line.quantity, 0::numeric, line.gross_total
    FROM pos.return_lines line
    JOIN pos.returns pos_return ON pos_return.id = line.return_id
    JOIN pos.shifts shift ON shift.id = pos_return.shift_id
    JOIN organization.cash_registers register ON register.id = shift.cash_register_id
    WHERE ${transactionPeriod('pos_return')}
  )
  SELECT product_id, product_code, product_name, category_name,
    sum(quantity_sold)::text AS quantity_sold,
    sum(quantity_returned)::text AS quantity_returned,
    sum(gross_sales_bgn)::text AS gross_sales_bgn,
    sum(gross_returns_bgn)::text AS gross_returns_bgn,
    (sum(gross_sales_bgn) - sum(gross_returns_bgn))::text AS net_revenue_bgn
  FROM activity
  GROUP BY product_id, product_code, product_name, category_name
  ORDER BY net_revenue_bgn DESC, product_name, product_id`;

const categoriesSql = `
  WITH activity AS (
    SELECT line.category_id, line.category_name, line.quantity AS quantity_sold,
      0::numeric AS quantity_returned, line.gross_total AS gross_sales_bgn,
      0::numeric AS gross_returns_bgn
    FROM pos.sale_lines line
    JOIN pos.sales sale ON sale.id = line.sale_id
    JOIN pos.shifts shift ON shift.id = sale.shift_id
    JOIN organization.cash_registers register ON register.id = shift.cash_register_id
    WHERE ${transactionPeriod('sale')}
    UNION ALL
    SELECT line.category_id, line.category_name, 0::numeric, line.quantity,
      0::numeric, line.gross_total
    FROM pos.return_lines line
    JOIN pos.returns pos_return ON pos_return.id = line.return_id
    JOIN pos.shifts shift ON shift.id = pos_return.shift_id
    JOIN organization.cash_registers register ON register.id = shift.cash_register_id
    WHERE ${transactionPeriod('pos_return')}
  )
  SELECT category_id, category_name, sum(quantity_sold)::text AS quantity_sold,
    sum(quantity_returned)::text AS quantity_returned,
    sum(gross_sales_bgn)::text AS gross_sales_bgn,
    sum(gross_returns_bgn)::text AS gross_returns_bgn,
    (sum(gross_sales_bgn) - sum(gross_returns_bgn))::text AS net_revenue_bgn
  FROM activity
  GROUP BY category_id, category_name
  ORDER BY net_revenue_bgn DESC, category_name, category_id`;

const paymentsSql = `
  WITH activity AS (
    SELECT payment.payment_method AS method, payment.amount AS collected_bgn,
      0::numeric AS refunded_bgn
    FROM pos.payments payment
    JOIN pos.sales sale ON sale.id = payment.sale_id
    JOIN pos.shifts shift ON shift.id = sale.shift_id
    JOIN organization.cash_registers register ON register.id = shift.cash_register_id
    WHERE ${transactionPeriod('sale')}
    UNION ALL
    SELECT refund.refund_method, 0::numeric, refund.amount
    FROM pos.return_refunds refund
    JOIN pos.returns pos_return ON pos_return.id = refund.return_id
    JOIN pos.shifts shift ON shift.id = pos_return.shift_id
    JOIN organization.cash_registers register ON register.id = shift.cash_register_id
    WHERE ${transactionPeriod('pos_return')}
  )
  SELECT method, sum(collected_bgn)::text AS collected_bgn,
    sum(refunded_bgn)::text AS refunded_bgn,
    (sum(collected_bgn) - sum(refunded_bgn))::text AS net_bgn
  FROM activity GROUP BY method ORDER BY method`;

const locationsSql = `
  WITH activity AS (
    SELECT register.business_location_id, 1 AS sale_count, 0 AS return_count,
      sale.gross_total AS gross_sales_bgn, 0::numeric AS gross_returns_bgn
    FROM pos.sales sale
    JOIN pos.shifts shift ON shift.id = sale.shift_id
    JOIN organization.cash_registers register ON register.id = shift.cash_register_id
    WHERE ${transactionPeriod('sale')}
    UNION ALL
    SELECT register.business_location_id, 0, 1, 0::numeric, pos_return.gross_total
    FROM pos.returns pos_return
    JOIN pos.shifts shift ON shift.id = pos_return.shift_id
    JOIN organization.cash_registers register ON register.id = shift.cash_register_id
    WHERE ${transactionPeriod('pos_return')}
  )
  SELECT location.id AS business_location_id, location.name AS location_name,
    sum(activity.sale_count)::text AS sale_count,
    sum(activity.return_count)::text AS return_count,
    sum(activity.gross_sales_bgn)::text AS gross_sales_bgn,
    sum(activity.gross_returns_bgn)::text AS gross_returns_bgn,
    (sum(activity.gross_sales_bgn) - sum(activity.gross_returns_bgn))::text
      AS net_revenue_bgn
  FROM activity
  JOIN organization.business_locations location
    ON location.id = activity.business_location_id
  GROUP BY location.id, location.name
  ORDER BY net_revenue_bgn DESC, location.name, location.id`;

const shiftSelect = `shift.id, shift.shift_number, shift.status, shift.opened_at,
  shift.closed_at, shift.opening_cash_bgn::text, shift.closing_cash_bgn::text,
  register.id AS cash_register_id, register.code AS cash_register_code,
  register.name AS cash_register_name, location.name AS location_name,
  operator.id AS operator_id, operator.code AS operator_code,
  employee.display_name AS operator_name,
  configuration.fiscal_mode,
  COALESCE(sales.sale_count, 0)::text AS sale_count,
  COALESCE(returns.return_count, 0)::text AS return_count,
  COALESCE(sales.gross_sales_bgn, 0)::text AS gross_sales_bgn,
  COALESCE(returns.gross_returns_bgn, 0)::text AS gross_returns_bgn,
  (COALESCE(sales.gross_sales_bgn, 0) - COALESCE(returns.gross_returns_bgn, 0))::text
    AS net_revenue_bgn,
  COALESCE(sales.cash_sales_bgn, 0)::text AS cash_sales_bgn,
  COALESCE(returns.cash_refunds_bgn, 0)::text AS cash_refunds_bgn,
  (shift.opening_cash_bgn + COALESCE(sales.cash_sales_bgn, 0)
    - COALESCE(returns.cash_refunds_bgn, 0))::text AS expected_cash_bgn,
  CASE WHEN shift.closing_cash_bgn IS NULL THEN NULL ELSE
    (shift.closing_cash_bgn - shift.opening_cash_bgn
      - COALESCE(sales.cash_sales_bgn, 0) + COALESCE(returns.cash_refunds_bgn, 0))::text
  END AS difference_bgn`;

const shiftsSql = `
  SELECT ${shiftSelect}
  FROM pos.shifts shift
  JOIN organization.cash_registers register ON register.id = shift.cash_register_id
  JOIN organization.business_locations location ON location.id = register.business_location_id
  JOIN organization.operators operator ON operator.id = shift.operator_id
  JOIN identity.user_accounts account ON account.id = operator.account_id
  JOIN identity.employees employee ON employee.id = account.employee_id
  JOIN pos.terminal_configurations configuration
    ON configuration.cash_register_id = register.id
  LEFT JOIN LATERAL (${shiftSalesAggregate('NULL')}) sales ON true
  LEFT JOIN LATERAL (${shiftReturnsAggregate('NULL')}) returns ON true
  WHERE (shift.opened_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date
    AND ($4::uuid IS NULL OR register.business_location_id = $4)
    AND ($5::uuid IS NULL OR register.id = $5)
    AND ($6::uuid IS NULL OR shift.operator_id = $6)
  ORDER BY shift.opened_at DESC, shift.id DESC`;

const shiftSnapshotSql = `
  SELECT ${shiftSelect}
  FROM pos.shifts shift
  JOIN organization.cash_registers register ON register.id = shift.cash_register_id
  JOIN organization.business_locations location ON location.id = register.business_location_id
  JOIN organization.operators operator ON operator.id = shift.operator_id
  JOIN identity.user_accounts account ON account.id = operator.account_id
  JOIN identity.employees employee ON employee.id = account.employee_id
  JOIN pos.terminal_configurations configuration
    ON configuration.cash_register_id = register.id
  LEFT JOIN LATERAL (${shiftSalesAggregate('$2')}) sales ON true
  LEFT JOIN LATERAL (${shiftReturnsAggregate('$2')}) returns ON true
  WHERE shift.id = $1`;

function shiftSalesAggregate(asOfParameter: string): string {
  const cutoff =
    asOfParameter === 'NULL'
      ? ''
      : `AND (${asOfParameter}::timestamptz IS NULL
          OR sale.completed_at <= ${asOfParameter}::timestamptz)`;
  return `SELECT count(*) AS sale_count, COALESCE(sum(sale.gross_total), 0) AS gross_sales_bgn,
    COALESCE(sum(payment.cash_amount), 0) AS cash_sales_bgn
    FROM pos.sales sale
    LEFT JOIN LATERAL (
      SELECT sum(pos_payment.amount) AS cash_amount FROM pos.payments pos_payment
      WHERE pos_payment.sale_id = sale.id AND pos_payment.payment_method = 'cash'
    ) payment ON true
    WHERE sale.shift_id = shift.id ${cutoff}`;
}

function shiftReturnsAggregate(asOfParameter: string): string {
  const cutoff =
    asOfParameter === 'NULL'
      ? ''
      : `AND (${asOfParameter}::timestamptz IS NULL
          OR pos_return.completed_at <= ${asOfParameter}::timestamptz)`;
  return `SELECT count(*) AS return_count,
    COALESCE(sum(pos_return.gross_total), 0) AS gross_returns_bgn,
    COALESCE(sum(refund.cash_amount), 0) AS cash_refunds_bgn
    FROM pos.returns pos_return
    LEFT JOIN LATERAL (
      SELECT sum(pos_refund.amount) AS cash_amount FROM pos.return_refunds pos_refund
      WHERE pos_refund.return_id = pos_return.id AND pos_refund.refund_method = 'cash'
    ) refund ON true
    WHERE pos_return.shift_id = shift.id ${cutoff}`;
}

function reportParameters(filters: PosReportFilters, timezone: string) {
  return [
    filters.dateFrom,
    filters.dateTo,
    timezone,
    filters.businessLocationId ?? null,
    filters.cashRegisterId ?? null,
    filters.operatorId ?? null,
  ];
}

function requirePeriod(dateFrom: string, dateTo: string): void {
  if (dateFrom > dateTo)
    throw new ApiErrorException(
      'POS_REPORT_DATE_RANGE_INVALID',
      'The start date cannot be after the end date.',
      HttpStatus.BAD_REQUEST,
    );
}

function requiredPeriod(filters: PosExportFilters): { dateFrom: string; dateTo: string } {
  if (!filters.dateFrom || !filters.dateTo)
    throw new ApiErrorException(
      'POS_REPORT_DATE_RANGE_REQUIRED',
      'Choose a start and end date for this report.',
      HttpStatus.BAD_REQUEST,
    );
  requirePeriod(filters.dateFrom, filters.dateTo);
  return { dateFrom: filters.dateFrom, dateTo: filters.dateTo };
}

function mapCashier(row: CashierRow): PosCashierReportRow {
  return {
    grossReturnsBgn: row.gross_returns_bgn,
    grossSalesBgn: row.gross_sales_bgn,
    name: row.name,
    netRevenueBgn: row.net_revenue_bgn,
    operatorCode: row.operator_code,
    operatorId: row.operator_id,
    returnCount: Number(row.return_count),
    saleCount: Number(row.sale_count),
  };
}

function mapProduct(row: ProductRow): PosProductReportRow {
  return {
    categoryName: row.category_name,
    grossReturnsBgn: row.gross_returns_bgn,
    grossSalesBgn: row.gross_sales_bgn,
    netRevenueBgn: row.net_revenue_bgn,
    productCode: row.product_code,
    productId: row.product_id,
    productName: row.product_name,
    quantityReturned: row.quantity_returned,
    quantitySold: row.quantity_sold,
  };
}

function mapCategory(row: CategoryRow): PosCategoryReportRow {
  return {
    categoryId: row.category_id,
    categoryName: row.category_name,
    grossReturnsBgn: row.gross_returns_bgn,
    grossSalesBgn: row.gross_sales_bgn,
    netRevenueBgn: row.net_revenue_bgn,
    quantityReturned: row.quantity_returned,
    quantitySold: row.quantity_sold,
  };
}

function mapPayment(row: PaymentRow): PosPaymentReportRow {
  return {
    collectedBgn: row.collected_bgn,
    method: row.method,
    netBgn: row.net_bgn,
    refundedBgn: row.refunded_bgn,
  };
}

function mapLocations(rows: LocationRow[]): PosLocationReportRow[] {
  const totalRevenue = rows.reduce((sum, row) => sum + Number(row.net_revenue_bgn), 0);
  return rows.map((row) => {
    const saleCount = Number(row.sale_count);
    return {
      averageSaleBgn: saleCount ? (Number(row.gross_sales_bgn) / saleCount).toFixed(4) : '0.0000',
      businessLocationId: row.business_location_id,
      grossReturnsBgn: row.gross_returns_bgn,
      grossSalesBgn: row.gross_sales_bgn,
      locationName: row.location_name,
      netRevenueBgn: row.net_revenue_bgn,
      revenueSharePercent:
        totalRevenue === 0 ? 0 : roundPercent((Number(row.net_revenue_bgn) / totalRevenue) * 100),
      returnCount: Number(row.return_count),
      saleCount,
    };
  });
}

function mapShift(row: ShiftReportRow): PosShiftReportRow {
  return {
    cashRegisterCode: row.cash_register_code,
    cashRegisterId: row.cash_register_id,
    cashRegisterName: row.cash_register_name,
    cashRefundsBgn: row.cash_refunds_bgn,
    cashSalesBgn: row.cash_sales_bgn,
    ...(row.closed_at ? { closedAt: iso(row.closed_at) } : {}),
    ...(row.closing_cash_bgn ? { closingCashBgn: row.closing_cash_bgn } : {}),
    ...(row.difference_bgn ? { differenceBgn: row.difference_bgn } : {}),
    expectedCashBgn: row.expected_cash_bgn,
    fiscalMode: row.fiscal_mode,
    grossReturnsBgn: row.gross_returns_bgn,
    grossSalesBgn: row.gross_sales_bgn,
    id: row.id,
    locationName: row.location_name,
    netRevenueBgn: row.net_revenue_bgn,
    openedAt: iso(row.opened_at),
    openingCashBgn: row.opening_cash_bgn,
    operatorCode: row.operator_code,
    operatorId: row.operator_id,
    operatorName: row.operator_name,
    reportType: row.status === 'open' ? 'x' : 'z',
    returnCount: Number(row.return_count),
    saleCount: Number(row.sale_count),
    shiftNumber: row.shift_number,
    status: row.status,
  };
}

function shiftExportRow(row: PosShiftReportRow): Record<string, number | string> {
  return {
    cashRefundsBgn: row.cashRefundsBgn,
    cashSalesBgn: row.cashSalesBgn,
    cashier: row.operatorName,
    closedAt: row.closedAt ?? '',
    closingCashBgn: row.closingCashBgn ?? '',
    differenceBgn: row.differenceBgn ?? '',
    expectedCashBgn: row.expectedCashBgn,
    grossReturnsBgn: row.grossReturnsBgn,
    grossSalesBgn: row.grossSalesBgn,
    location: row.locationName,
    netRevenueBgn: row.netRevenueBgn,
    openedAt: row.openedAt,
    openingCashBgn: row.openingCashBgn,
    register: row.cashRegisterName,
    reportType: row.reportType.toUpperCase(),
    returnCount: row.returnCount,
    saleCount: row.saleCount,
    shiftNumber: row.shiftNumber,
  };
}

function subtract(left: string, right: string): string {
  return (Number(left) - Number(right)).toFixed(4);
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function paymentLabel(method: PosPaymentReportRow['method']): string {
  return method === 'cash' ? 'Cash' : 'Bank card';
}

function fiscalCriterion(mode: PosShiftReportRow['fiscalMode']): string {
  if (mode === 'simulator')
    return 'Fiscal evidence: development simulator; not a certified H-18 device report';
  if (mode === 'hardware') return 'Fiscal evidence: configured hardware adapter';
  return 'Fiscal evidence: fiscal-device integration was unavailable for this shift';
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

const shiftColumns = [
  { key: 'shiftNumber', label: 'Shift', type: 'text' },
  { key: 'reportType', label: 'Report', type: 'text' },
  { key: 'location', label: 'Location', type: 'text' },
  { key: 'register', label: 'Register', type: 'text' },
  { key: 'cashier', label: 'Cashier', type: 'text' },
  { key: 'openedAt', label: 'Opened', type: 'text' },
  { key: 'closedAt', label: 'Closed', type: 'text' },
  { key: 'saleCount', label: 'Sales', type: 'number' },
  { key: 'returnCount', label: 'Returns', type: 'number' },
  { key: 'grossSalesBgn', label: 'Sales BGN', type: 'money' },
  { key: 'grossReturnsBgn', label: 'Returns BGN', type: 'money' },
  { key: 'netRevenueBgn', label: 'Net revenue BGN', type: 'money' },
  { key: 'openingCashBgn', label: 'Opening cash BGN', type: 'money' },
  { key: 'cashSalesBgn', label: 'Cash sales BGN', type: 'money' },
  { key: 'cashRefundsBgn', label: 'Cash refunds BGN', type: 'money' },
  { key: 'expectedCashBgn', label: 'Expected cash BGN', type: 'money' },
  { key: 'closingCashBgn', label: 'Counted cash BGN', type: 'money' },
  { key: 'differenceBgn', label: 'Difference BGN', type: 'money' },
] as const;

const cashierColumns = [
  { key: 'operatorCode', label: 'Cashier code', type: 'text' },
  { key: 'cashier', label: 'Cashier', type: 'text' },
  { key: 'saleCount', label: 'Sales', type: 'number' },
  { key: 'returnCount', label: 'Returns', type: 'number' },
  { key: 'grossSalesBgn', label: 'Sales BGN', type: 'money' },
  { key: 'grossReturnsBgn', label: 'Returns BGN', type: 'money' },
  { key: 'netRevenueBgn', label: 'Net revenue BGN', type: 'money' },
] as const;

const productColumns = [
  { key: 'productCode', label: 'Product code', type: 'text' },
  { key: 'productName', label: 'Product', type: 'text' },
  { key: 'category', label: 'Category', type: 'text' },
  { key: 'quantitySold', label: 'Quantity sold', type: 'number' },
  { key: 'quantityReturned', label: 'Quantity returned', type: 'number' },
  { key: 'grossSalesBgn', label: 'Sales BGN', type: 'money' },
  { key: 'grossReturnsBgn', label: 'Returns BGN', type: 'money' },
  { key: 'netRevenueBgn', label: 'Net revenue BGN', type: 'money' },
] as const;

const categoryColumns = [
  { key: 'category', label: 'Category', type: 'text' },
  { key: 'quantitySold', label: 'Quantity sold', type: 'number' },
  { key: 'quantityReturned', label: 'Quantity returned', type: 'number' },
  { key: 'grossSalesBgn', label: 'Sales BGN', type: 'money' },
  { key: 'grossReturnsBgn', label: 'Returns BGN', type: 'money' },
  { key: 'netRevenueBgn', label: 'Net revenue BGN', type: 'money' },
] as const;

const paymentColumns = [
  { key: 'method', label: 'Payment method', type: 'text' },
  { key: 'collectedBgn', label: 'Collected BGN', type: 'money' },
  { key: 'refundedBgn', label: 'Refunded BGN', type: 'money' },
  { key: 'netBgn', label: 'Net BGN', type: 'money' },
] as const;

const locationColumns = [
  { key: 'location', label: 'Location', type: 'text' },
  { key: 'saleCount', label: 'Sales', type: 'number' },
  { key: 'returnCount', label: 'Returns', type: 'number' },
  { key: 'grossSalesBgn', label: 'Sales BGN', type: 'money' },
  { key: 'grossReturnsBgn', label: 'Returns BGN', type: 'money' },
  { key: 'netRevenueBgn', label: 'Net revenue BGN', type: 'money' },
  { key: 'averageSaleBgn', label: 'Average sale BGN', type: 'money' },
] as const;

const locationComparisonColumns = [
  ...locationColumns,
  { key: 'revenueSharePercent', label: 'Revenue share %', type: 'number' },
] as const;
