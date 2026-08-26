import { Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  ServiceReportDefinitionKey,
  ServiceReportOverview,
  ServiceRequestStatus,
  ServiceType,
} from '@vista/contracts';

import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';
import type { FinanceReportExportData } from '../finance/finance-reports.service.js';

interface OverviewTotalRow {
  cancelled_requests: string;
  completed_requests: string;
  labor_minutes: string;
  open_requests: string;
  total_cost_bgn: string;
  total_requests: string;
}

interface StatusRow {
  count: string;
  status: ServiceRequestStatus;
}

interface TypeRow {
  completed_count: string;
  request_count: string;
  service_type: ServiceType;
  total_cost_bgn: string;
}

interface TechnicianRow {
  assigned_count: string;
  completed_count: string;
  display_name: string;
  labor_minutes: string;
  total_cost_bgn: string;
}

@Injectable()
export class ServiceReportsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {}

  async overview(dateFrom: string, dateTo: string): Promise<ServiceReportOverview> {
    requirePeriod(dateFrom, dateTo);
    const parameters = [dateFrom, dateTo, this.environment.BUSINESS_TIMEZONE];
    const period = servicePeriod('request');
    const [totals, statuses, types, technicians] = await Promise.all([
      this.database.getPool().query<OverviewTotalRow>(
        `SELECT
           count(*)::text AS total_requests,
           count(*) FILTER (WHERE request.status = 'completed')::text AS completed_requests,
           count(*) FILTER (WHERE request.status = 'cancelled')::text AS cancelled_requests,
           count(*) FILTER (WHERE request.status IN ('new','scheduled','in_progress'))::text
             AS open_requests,
           coalesce(sum(work_order.labor_minutes), 0)::text AS labor_minutes,
           coalesce(sum(work_order.total_cost_bgn), 0)::text AS total_cost_bgn
         FROM service.requests request
         LEFT JOIN service.work_orders work_order ON work_order.service_request_id = request.id
         WHERE ${period}`,
        parameters,
      ),
      this.database.getPool().query<StatusRow>(
        `SELECT request.status, count(*)::text AS count
         FROM service.requests request
         WHERE ${period}
         GROUP BY request.status
         ORDER BY CASE request.status
           WHEN 'new' THEN 1 WHEN 'scheduled' THEN 2 WHEN 'in_progress' THEN 3
           WHEN 'completed' THEN 4 ELSE 5 END`,
        parameters,
      ),
      this.database.getPool().query<TypeRow>(
        `SELECT request.service_type,
                count(*)::text AS request_count,
                count(*) FILTER (WHERE request.status = 'completed')::text AS completed_count,
                coalesce(sum(work_order.total_cost_bgn), 0)::text AS total_cost_bgn
         FROM service.requests request
         LEFT JOIN service.work_orders work_order ON work_order.service_request_id = request.id
         WHERE ${period}
         GROUP BY request.service_type
         ORDER BY request.service_type`,
        parameters,
      ),
      this.database.getPool().query<TechnicianRow>(technicianReportQuery(), parameters),
    ]);
    const total = totals.rows[0];
    return {
      dateFrom,
      dateTo,
      generatedAt: new Date().toISOString(),
      statusTotals: statuses.rows.map((row) => ({ count: Number(row.count), status: row.status })),
      technicians: technicians.rows.map(mapTechnician),
      totals: {
        cancelledRequests: Number(total?.cancelled_requests ?? '0'),
        completedRequests: Number(total?.completed_requests ?? '0'),
        laborMinutes: Number(total?.labor_minutes ?? '0'),
        openRequests: Number(total?.open_requests ?? '0'),
        totalCostBgn: total?.total_cost_bgn ?? '0.0000',
        totalRequests: Number(total?.total_requests ?? '0'),
      },
      typeTotals: types.rows.map((row) => ({
        completedCount: Number(row.completed_count),
        requestCount: Number(row.request_count),
        serviceType: row.service_type,
        totalCostBgn: row.total_cost_bgn,
      })),
    };
  }

  async exportData(
    definitionKey: ServiceReportDefinitionKey,
    filters: { dateFrom?: string; dateTo?: string },
  ): Promise<FinanceReportExportData> {
    const { dateFrom, dateTo } = requiredPeriod(filters);
    const generatedAt = new Date().toISOString();
    const parameters = [dateFrom, dateTo, this.environment.BUSINESS_TIMEZONE];

    if (definitionKey === 'service.request-register') {
      const result = await this.database.getPool().query<{
        created_on: string;
        customer_name: string;
        device_name: string;
        labor_cost_bgn: string;
        parts_cost_bgn: string;
        priority: string;
        request_number: string;
        serial_number: string;
        service_type: ServiceType;
        source_channel: string;
        status: ServiceRequestStatus;
        technician_name: string;
        total_cost_bgn: string;
        transport_cost_bgn: string;
      }>(
        `SELECT request.request_number,
                (request.created_at AT TIME ZONE $3)::date::text AS created_on,
                partner.display_name AS customer_name,
                equipment.device_name, equipment.serial_number,
                request.source_channel, request.service_type, request.priority, request.status,
                coalesce(employee.display_name, 'Unassigned') AS technician_name,
                coalesce(work_order.labor_cost_bgn, 0)::text AS labor_cost_bgn,
                coalesce(work_order.parts_cost_bgn, 0)::text AS parts_cost_bgn,
                coalesce(work_order.transport_cost_bgn, 0)::text AS transport_cost_bgn,
                coalesce(work_order.total_cost_bgn, 0)::text AS total_cost_bgn
         FROM service.requests request
         JOIN master_data.partners partner ON partner.id = request.customer_partner_id
         JOIN master_data.customer_equipment equipment ON equipment.id = request.customer_equipment_id
         LEFT JOIN service.work_orders work_order ON work_order.service_request_id = request.id
         LEFT JOIN identity.user_accounts account
           ON account.id = work_order.assigned_technician_account_id
         LEFT JOIN identity.employees employee ON employee.id = account.employee_id
         WHERE ${servicePeriod('request')}
         ORDER BY request.created_at DESC, request.request_number`,
        parameters,
      );
      return {
        columns: [...requestColumns],
        criteria: periodCriteria(dateFrom, dateTo),
        generatedAt,
        rows: result.rows.map((row) => ({
          createdOn: row.created_on,
          customerName: row.customer_name,
          device: `${row.device_name} · ${row.serial_number}`,
          laborCostBgn: row.labor_cost_bgn,
          partsCostBgn: row.parts_cost_bgn,
          priority: label(row.priority),
          requestNumber: row.request_number,
          serviceType: serviceTypeLabel(row.service_type),
          source: label(row.source_channel),
          status: label(row.status),
          technicianName: row.technician_name,
          totalCostBgn: row.total_cost_bgn,
          transportCostBgn: row.transport_cost_bgn,
        })),
        title: 'Service request register',
      };
    }

    if (definitionKey === 'service.technician-performance') {
      const result = await this.database
        .getPool()
        .query<TechnicianRow>(technicianReportQuery(), parameters);
      return {
        columns: [...technicianColumns],
        criteria: periodCriteria(dateFrom, dateTo),
        generatedAt,
        rows: result.rows.map((row) => ({
          assignedCount: Number(row.assigned_count),
          completedCount: Number(row.completed_count),
          displayName: row.display_name,
          laborMinutes: Number(row.labor_minutes),
          totalCostBgn: row.total_cost_bgn,
        })),
        title: 'Technician performance',
      };
    }

    const result = await this.database.getPool().query<{
      completed_count: string;
      labor_cost_bgn: string;
      parts_cost_bgn: string;
      request_count: string;
      service_type: ServiceType;
      total_cost_bgn: string;
      transport_cost_bgn: string;
    }>(
      `SELECT request.service_type,
              count(*)::text AS request_count,
              count(*) FILTER (WHERE request.status = 'completed')::text AS completed_count,
              coalesce(sum(work_order.labor_cost_bgn), 0)::text AS labor_cost_bgn,
              coalesce(sum(work_order.parts_cost_bgn), 0)::text AS parts_cost_bgn,
              coalesce(sum(work_order.transport_cost_bgn), 0)::text AS transport_cost_bgn,
              coalesce(sum(work_order.total_cost_bgn), 0)::text AS total_cost_bgn
       FROM service.requests request
       LEFT JOIN service.work_orders work_order ON work_order.service_request_id = request.id
       WHERE ${servicePeriod('request')}
       GROUP BY request.service_type
       ORDER BY request.service_type`,
      parameters,
    );
    return {
      columns: [...costColumns],
      criteria: [...periodCriteria(dateFrom, dateTo), 'Currency: BGN'],
      generatedAt,
      rows: result.rows.map((row) => ({
        completedCount: Number(row.completed_count),
        laborCostBgn: row.labor_cost_bgn,
        partsCostBgn: row.parts_cost_bgn,
        requestCount: Number(row.request_count),
        serviceType: serviceTypeLabel(row.service_type),
        totalCostBgn: row.total_cost_bgn,
        transportCostBgn: row.transport_cost_bgn,
      })),
      title: 'Service cost summary',
    };
  }
}

function servicePeriod(alias: string): string {
  return `(${alias}.created_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date`;
}

function technicianReportQuery(): string {
  return `SELECT employee.display_name,
                 count(*)::text AS assigned_count,
                 count(*) FILTER (WHERE request.status = 'completed')::text AS completed_count,
                 coalesce(sum(work_order.labor_minutes), 0)::text AS labor_minutes,
                 coalesce(sum(work_order.total_cost_bgn), 0)::text AS total_cost_bgn
          FROM service.work_orders work_order
          JOIN service.requests request ON request.id = work_order.service_request_id
          JOIN identity.user_accounts account
            ON account.id = work_order.assigned_technician_account_id
          JOIN identity.employees employee ON employee.id = account.employee_id
          WHERE ${servicePeriod('request')}
          GROUP BY account.id, employee.display_name
          ORDER BY count(*) FILTER (WHERE request.status = 'completed') DESC,
                   employee.display_name`;
}

function mapTechnician(row: TechnicianRow) {
  return {
    assignedCount: Number(row.assigned_count),
    completedCount: Number(row.completed_count),
    displayName: row.display_name,
    laborMinutes: Number(row.labor_minutes),
    totalCostBgn: row.total_cost_bgn,
  };
}

function requiredPeriod(filters: { dateFrom?: string; dateTo?: string }) {
  if (!filters.dateFrom || !filters.dateTo) {
    throw new ApiErrorException(
      'SERVICE_REPORT_DATE_RANGE_REQUIRED',
      'Choose a start and end date for this report.',
      400,
    );
  }
  requirePeriod(filters.dateFrom, filters.dateTo);
  return { dateFrom: filters.dateFrom, dateTo: filters.dateTo };
}

function requirePeriod(dateFrom: string, dateTo: string): void {
  if (dateFrom > dateTo) {
    throw new ApiErrorException(
      'SERVICE_REPORT_DATE_RANGE_INVALID',
      'The start date cannot be after the end date.',
      400,
    );
  }
}

function periodCriteria(dateFrom: string, dateTo: string): string[] {
  return [`Period: ${dateFrom} to ${dateTo}`, 'Dates use the configured business timezone'];
}

function serviceTypeLabel(value: ServiceType): string {
  return {
    out_of_warranty: 'Out of warranty',
    subscription: 'Service subscription',
    warranty: 'Warranty',
  }[value];
}

function label(value: string): string {
  return value
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

const requestColumns = [
  { key: 'requestNumber', label: 'Request', type: 'text' },
  { key: 'createdOn', label: 'Created', type: 'date' },
  { key: 'customerName', label: 'Customer', type: 'text' },
  { key: 'device', label: 'Device and serial', type: 'text' },
  { key: 'source', label: 'Source', type: 'text' },
  { key: 'serviceType', label: 'Service type', type: 'text' },
  { key: 'priority', label: 'Priority', type: 'text' },
  { key: 'status', label: 'Status', type: 'text' },
  { key: 'technicianName', label: 'Technician', type: 'text' },
  { key: 'laborCostBgn', label: 'Labour BGN', type: 'money' },
  { key: 'partsCostBgn', label: 'Parts BGN', type: 'money' },
  { key: 'transportCostBgn', label: 'Transport BGN', type: 'money' },
  { key: 'totalCostBgn', label: 'Total BGN', type: 'money' },
] as const;

const technicianColumns = [
  { key: 'displayName', label: 'Technician', type: 'text' },
  { key: 'assignedCount', label: 'Assigned visits', type: 'number' },
  { key: 'completedCount', label: 'Completed visits', type: 'number' },
  { key: 'laborMinutes', label: 'Recorded minutes', type: 'number' },
  { key: 'totalCostBgn', label: 'Service value BGN', type: 'money' },
] as const;

const costColumns = [
  { key: 'serviceType', label: 'Service type', type: 'text' },
  { key: 'requestCount', label: 'Requests', type: 'number' },
  { key: 'completedCount', label: 'Completed', type: 'number' },
  { key: 'laborCostBgn', label: 'Labour BGN', type: 'money' },
  { key: 'partsCostBgn', label: 'Parts BGN', type: 'money' },
  { key: 'transportCostBgn', label: 'Transport BGN', type: 'money' },
  { key: 'totalCostBgn', label: 'Total BGN', type: 'money' },
] as const;
