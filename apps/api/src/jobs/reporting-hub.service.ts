import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { Permission } from '@vista/auth';
import {
  reportingScopes,
  dashboardCardKeys,
  type ReportingScope,
  type LibraryDefinition,
  type LibraryView,
  type LibraryViewPage,
  type ReportSchedule,
  type ReportScheduleInput,
  type ReportDashboardPreferences,
  type ReportDashboardScope,
  type ReportSchedulePage,
  type ReportRunPage,
} from '@vista/contracts';
import type { AppEnvironment } from '@vista/config';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../audit/audit.service.js';
import type {
  AuthenticationContext,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import {
  FinanceReportExportsService,
  reportFilters,
  validateReportColumns,
} from './finance-report-exports.service.js';
import { erpReportDefinitions } from './erp-report-definitions.js';
import { canReport, reportAccess } from './reporting-access.js';
import type { FinanceReportExportPageQueryDto } from './finance-report-exports.dto.js';

interface ScheduleRow {
  id: string;
  owner_account_id: string;
  view_id: string;
  name: string;
  scope: ReportingScope;
  configuration: LibraryView['configuration'];
  cadence: ReportScheduleInput['cadence'];
  period: ReportScheduleInput['period'];
  first_run_local: string;
  timezone: string;
  next_run_at: Date;
  occurrence: number;
  enabled: boolean;
  version: number;
  error_code: string | null;
  request_hash: string;
}
const scheduleSelect = `SELECT *, to_char(first_run_local,'YYYY-MM-DD"T"HH24:MI') AS first_run_local FROM reporting.report_schedules`;

@Injectable()
export class ReportingHubService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(FinanceReportExportsService) private readonly exports: FinanceReportExportsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment,
  ) {}
  context() {
    return { timezone: this.env.BUSINESS_TIMEZONE };
  }

  async definitions(auth: AuthenticationContext): Promise<LibraryDefinition[]> {
    const loaders = {
      finance: () => this.exports.definitions(),
      service: () => this.exports.serviceDefinitions(),
      crm: () => this.exports.crmDefinitions(),
      pos: () => this.exports.posDefinitions(),
    };
    const result: LibraryDefinition[] = [];
    for (const scope of reportingScopes.filter((s) => canReport(auth, s))) {
      const definitions =
        scope in loaders
          ? await loaders[scope as keyof typeof loaders]()
          : erpReportDefinitions().filter((d) => d.key.startsWith(scope + '.'));
      result.push(
        ...definitions.map((d) => ({
          ...d,
          columns: d.columns ?? [],
          scope,
          canCreate: canReport(auth, scope, true),
        })),
      );
    }
    const active = await this.db
      .getPool()
      .query<{ definition_key: string }>(
        'SELECT definition_key FROM reporting.report_definitions WHERE is_active',
      );
    return result.filter((d) => active.rows.some((a) => a.definition_key === d.key));
  }
  async views(
    query: FinanceReportExportPageQueryDto,
    auth: AuthenticationContext,
  ): Promise<LibraryViewPage> {
    const scopes = reportingScopes.filter((s) => canReport(auth, s));
    const where = `FROM reporting.library_views v JOIN reporting.report_definitions d ON d.definition_key=v.configuration->>'definitionKey' AND d.is_active WHERE owner_account_id=$1 AND scope=ANY($2::text[])`;
    const rows = await this.db
      .getPool()
      .query<LibraryView>(
        `SELECT v.id,v.name,v.scope,v.configuration ${where} ORDER BY v.created_at DESC,v.id LIMIT $3 OFFSET $4`,
        [auth.accountId, scopes, query.pageSize, (query.page - 1) * query.pageSize],
      );
    const count = await this.db
      .getPool()
      .query<{ total: number }>(`SELECT count(*)::int total ${where}`, [auth.accountId, scopes]);
    const total = count.rows[0]!.total;
    return {
      items: rows.rows.map((r) => ({ ...r, canCreate: canReport(auth, r.scope, true) })),
      page: query.page,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }
  async view(
    scope: ReportingScope,
    id: string,
    auth: AuthenticationContext,
    create = false,
  ): Promise<LibraryView> {
    reportAccess(auth, scope, create);
    const row = (
      await this.db
        .getPool()
        .query<LibraryView>(
          'SELECT id,name,scope,configuration FROM reporting.library_views WHERE owner_account_id=$1 AND scope=$2 AND id=$3',
          [auth.accountId, scope, id],
        )
    ).rows[0];
    if (!row)
      throw new ApiErrorException('REPORT_NOT_FOUND', 'This saved report is not available.', 404);
    const definition = (await this.definitions(auth)).find(
      (d) => d.key === row.configuration.definitionKey && d.scope === scope,
    );
    if (!definition)
      throw new ApiErrorException('REPORT_NOT_FOUND', 'This report is no longer available.', 404);
    return { ...row, canCreate: canReport(auth, scope, true) };
  }
  async exportView(
    scope: ReportingScope,
    id: string,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ) {
    const view = await this.view(scope, id, auth, true);
    return this.exports.createForScope(view.configuration, key, auth, metadata, scope);
  }
  async schedules(
    query: FinanceReportExportPageQueryDto,
    auth: AuthenticationContext,
  ): Promise<ReportSchedulePage> {
    const scopes = reportingScopes.filter((s) => canReport(auth, s));
    const params = [auth.accountId, scopes];
    const rows = await this.db
      .getPool()
      .query<ScheduleRow>(
        `${scheduleSelect} WHERE owner_account_id=$1 AND scope=ANY($2::text[]) ORDER BY created_at DESC,id LIMIT $3 OFFSET $4`,
        [...params, query.pageSize, (query.page - 1) * query.pageSize],
      );
    const count = await this.db
      .getPool()
      .query<{ total: number }>(
        'SELECT count(*)::int total FROM reporting.report_schedules WHERE owner_account_id=$1 AND scope=ANY($2::text[])',
        params,
      );
    const total = count.rows[0]!.total;
    return {
      items: rows.rows.map(mapSchedule),
      page: query.page,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }
  async createSchedule(
    input: ReportScheduleInput,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<ReportSchedule> {
    const view = await this.view(input.scope, input.viewId, auth, true);
    const configuration = view.configuration;
    const definition = (await this.definitions(auth)).find(
      (d) => d.key === configuration.definitionKey,
    )!;
    if (
      (!definition.requiresDateRange && input.period !== 'current') ||
      (definition.requiresDateRange && input.period === 'current')
    )
      throw new ApiErrorException(
        'REPORT_PERIOD_INVALID',
        'Choose a period that applies to this report.',
        400,
      );
    reportFilters(configuration, configuration.definitionKey);
    if (configuration.columns)
      validateReportColumns(configuration.definitionKey, configuration.columns);
    const name = input.name.trim();
    const hash = createHash('sha256')
      .update(
        JSON.stringify({ ...input, name, configuration, timezone: this.env.BUSINESS_TIMEZONE }),
      )
      .digest('hex');
    return this.transaction(async (client) => {
      const previous = (
        await client.query<ScheduleRow>(`${scheduleSelect} WHERE id=$1`, [input.id])
      ).rows[0];
      if (previous) {
        if (previous.owner_account_id !== auth.accountId || previous.request_hash !== hash)
          throw new ApiErrorException(
            'REPORT_SCHEDULE_CONFLICT',
            'This save conflicts with an earlier request. Reload and try again.',
            409,
          );
        return mapSchedule(previous);
      }
      const time = await client
        .query<{ valid: boolean }>(
          `SELECT ($1::timestamp AT TIME ZONE $2) BETWEEN now()-interval '1 day' AND now()+interval '5 years' AS valid`,
          [input.firstRunLocal, this.env.BUSINESS_TIMEZONE],
        )
        .catch(() => {
          throw new ApiErrorException(
            'REPORT_SCHEDULE_TIME_INVALID',
            'Enter a valid first run date and time.',
            400,
          );
        });
      if (!time.rows[0]?.valid)
        throw new ApiErrorException(
          'REPORT_SCHEDULE_TIME_INVALID',
          'Choose a first run between yesterday and five years from today.',
          400,
        );
      await client.query(
        `INSERT INTO reporting.report_schedules(id,owner_account_id,view_id,scope,name,configuration,cadence,period,first_run_local,timezone,next_run_at,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamp,$10,$9::timestamp AT TIME ZONE $10,$11) ON CONFLICT(id) DO NOTHING`,
        [
          input.id,
          auth.accountId,
          input.viewId,
          input.scope,
          name,
          configuration,
          input.cadence,
          input.period,
          input.firstRunLocal,
          this.env.BUSINESS_TIMEZONE,
          hash,
        ],
      );
      const stored = (
        await client.query<ScheduleRow>(`${scheduleSelect} WHERE id=$1 FOR UPDATE`, [input.id])
      ).rows[0]!;
      if (stored.owner_account_id !== auth.accountId || stored.request_hash !== hash)
        throw new ApiErrorException(
          'REPORT_SCHEDULE_CONFLICT',
          'This save conflicts with an earlier request.',
          409,
        );
      // The account/id advisory lock serializes creation and ensures a single audit event.
      await this.audit.append(
        {
          ...metadata,
          actorAccountId: auth.accountId,
          action: 'report.schedule.created',
          targetType: 'report_schedule',
          targetId: input.id,
          after: {
            name,
            scope: input.scope,
            cadence: input.cadence,
            period: input.period,
            firstRunLocal: input.firstRunLocal,
          },
        },
        client,
      );
      return mapSchedule(stored);
    }, input.id);
  }
  async state(
    id: string,
    input: { enabled: boolean; version: number },
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ) {
    return this.transaction(async (client) => {
      const row = await this.ownedSchedule(client, id, auth, true);
      if (row.enabled === input.enabled && !row.error_code) return mapSchedule(row);
      if (row.version !== input.version)
        throw new ApiErrorException(
          'REPORT_SCHEDULE_CONFLICT',
          'This schedule changed in another window. Refresh before saving.',
          409,
        );
      await client.query(
        'UPDATE reporting.report_schedules SET enabled=$2,version=version+1,error_code=NULL WHERE id=$1',
        [id, input.enabled],
      );
      await this.audit.append(
        {
          ...metadata,
          actorAccountId: auth.accountId,
          action: input.enabled ? 'report.schedule.resumed' : 'report.schedule.paused',
          targetType: 'report_schedule',
          targetId: id,
          after: { enabled: input.enabled },
        },
        client,
      );
      return mapSchedule({
        ...row,
        enabled: input.enabled,
        version: row.version + 1,
        error_code: null,
      });
    });
  }
  async runs(
    id: string,
    query: FinanceReportExportPageQueryDto,
    auth: AuthenticationContext,
  ): Promise<ReportRunPage> {
    const client = await this.db.getPool().connect();
    try {
      const row = await this.ownedSchedule(client, id, auth);
      const runs = await client.query<{ id: string; scheduled_for: Date; export_id: string }>(
        'SELECT id,scheduled_for,export_id FROM reporting.report_schedule_runs WHERE schedule_id=$1 ORDER BY scheduled_for DESC,id LIMIT $2 OFFSET $3',
        [id, query.pageSize, (query.page - 1) * query.pageSize],
      );
      const count = await client.query<{ total: number }>(
        'SELECT count(*)::int total FROM reporting.report_schedule_runs WHERE schedule_id=$1',
        [id],
      );
      const items = await Promise.all(
        runs.rows.map(async (r) => ({
          id: r.id,
          scheduledFor: r.scheduled_for.toISOString(),
          export: await this.exports.getForScope(r.export_id, auth, row.scope),
        })),
      );
      const total = count.rows[0]!.total;
      return { items, page: query.page, total, totalPages: Math.ceil(total / query.pageSize) };
    } finally {
      client.release();
    }
  }
  async preferences(
    scope: string,
    auth: AuthenticationContext,
  ): Promise<ReportDashboardPreferences> {
    this.dashboardAccess(scope, auth);
    return (
      (
        await this.db
          .getPool()
          .query<ReportDashboardPreferences>(
            'SELECT hidden_cards AS "hiddenCards",version FROM reporting.dashboard_preferences WHERE owner_account_id=$1 AND scope=$2',
            [auth.accountId, scope],
          )
      ).rows[0] ?? { hiddenCards: [], version: 0 }
    );
  }
  async savePreferences(
    scope: string,
    input: ReportDashboardPreferences,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ) {
    this.dashboardAccess(scope, auth);
    const allowed: readonly string[] = dashboardCardKeys[scope as ReportDashboardScope];
    if (input.hiddenCards.some((k) => !allowed.includes(k)))
      throw new ApiErrorException(
        'DASHBOARD_CARD_INVALID',
        'Choose one of the available cards.',
        400,
      );
    const hiddenCards = allowed.filter((k) => input.hiddenCards.includes(k));
    return this.transaction(async (client) => {
      await client.query(
        'INSERT INTO reporting.dashboard_preferences(owner_account_id,scope) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [auth.accountId, scope],
      );
      const before = (
        await client.query<ReportDashboardPreferences>(
          'SELECT hidden_cards AS "hiddenCards",version FROM reporting.dashboard_preferences WHERE owner_account_id=$1 AND scope=$2 FOR UPDATE',
          [auth.accountId, scope],
        )
      ).rows[0]!;
      if (JSON.stringify(before.hiddenCards) === JSON.stringify(hiddenCards)) return before;
      if (before.version !== input.version)
        throw new ApiErrorException(
          'DASHBOARD_CONFLICT',
          'Your layout changed in another window. Reload before saving.',
          409,
        );
      const after = { hiddenCards, version: before.version + 1 };
      await client.query(
        'UPDATE reporting.dashboard_preferences SET hidden_cards=$3,version=$4 WHERE owner_account_id=$1 AND scope=$2',
        [auth.accountId, scope, JSON.stringify(hiddenCards), after.version],
      );
      await this.audit.append(
        {
          ...metadata,
          actorAccountId: auth.accountId,
          action: 'dashboard.preferences.updated',
          targetType: 'dashboard_preferences',
          targetId: auth.accountId,
          before: { scope, ...before },
          after: { scope, ...after },
        },
        client,
      );
      return after;
    });
  }
  private dashboardAccess(scope: string, auth: AuthenticationContext) {
    if (!Object.hasOwn(dashboardCardKeys, scope))
      throw new ApiErrorException('DASHBOARD_NOT_FOUND', 'This dashboard is not available.', 404);
    reportAccess(auth, scope);
  }
  private async ownedSchedule(
    client: PoolClient,
    id: string,
    auth: AuthenticationContext,
    lock = false,
  ) {
    const row = (
      await client.query<ScheduleRow>(
        `${scheduleSelect} WHERE id=$1 AND owner_account_id=$2${lock ? ' FOR UPDATE' : ''}`,
        [id, auth.accountId],
      )
    ).rows[0];
    if (!row)
      throw new ApiErrorException(
        'REPORT_SCHEDULE_NOT_FOUND',
        'This schedule is not available.',
        404,
      );
    reportAccess(auth, row.scope, lock);
    return row;
  }
  private async transaction<T>(run: (client: PoolClient) => Promise<T>, lock?: string): Promise<T> {
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      if (lock)
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          'report-schedule:' + lock,
        ]);
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async dispatchDue(limit = 25): Promise<number> {
    let processed = 0;
    for (let i = 0; i < limit; i++) {
      const didRun = await this.transaction(async (client) => {
        const row = (
          await client.query<ScheduleRow>(
            `${scheduleSelect} WHERE enabled AND next_run_at<=now() ORDER BY next_run_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,
          )
        ).rows[0];
        if (!row) return false;
        const permissions = await client.query<Permission>(
          `SELECT DISTINCT p.module,p.action FROM identity.user_accounts a JOIN identity.employees e ON e.id=a.employee_id AND e.active JOIN iam.account_roles ar ON ar.account_id=a.id JOIN iam.role_permissions rp ON rp.role_id=ar.role_id JOIN iam.permissions p ON p.id=rp.permission_id WHERE a.id=$1 AND a.status='active' AND (a.locked_until IS NULL OR a.locked_until<=now())`,
          [row.owner_account_id],
        );
        const auth: AuthenticationContext = {
          accountId: row.owner_account_id,
          permissions: permissions.rows,
          displayName: '',
          email: '',
          employeeId: '',
          sessionId: '',
          isAdministrative: false,
          twoFactorVerified: false,
        };
        const active = (
          await client.query(
            'SELECT id FROM reporting.report_definitions WHERE definition_key=$1 AND is_active',
            [row.configuration.definitionKey],
          )
        ).rowCount;
        if (!canReport(auth, row.scope, true) || !active) {
          await client.query(
            "UPDATE reporting.report_schedules SET enabled=false,error_code='REPORT_ACCESS_CHANGED',version=version+1 WHERE id=$1",
            [row.id],
          );
          await this.audit.append(
            {
              actorAccountId: row.owner_account_id,
              correlationId: randomUUID(),
              action: 'report.schedule.blocked',
              targetType: 'report_schedule',
              targetId: row.id,
              after: { errorCode: 'REPORT_ACCESS_CHANGED' },
            },
            client,
          );
          return true;
        }
        const config = { ...row.configuration };
        if (row.period !== 'saved_dates' && row.period !== 'current') {
          const dates = (
            await client.query<{ dateFrom: string; dateTo: string }>(
              `SELECT (CASE $3 WHEN 'previous_month' THEN date_trunc('month',$1::timestamptz AT TIME ZONE $2)::date-interval '1 month' WHEN 'previous_7_days' THEN ($1::timestamptz AT TIME ZONE $2)::date-7 ELSE ($1::timestamptz AT TIME ZONE $2)::date-1 END)::date::text AS "dateFrom", (CASE $3 WHEN 'previous_month' THEN date_trunc('month',$1::timestamptz AT TIME ZONE $2)::date-1 ELSE ($1::timestamptz AT TIME ZONE $2)::date-1 END)::text AS "dateTo"`,
              [row.next_run_at, row.timezone, row.period],
            )
          ).rows[0]!;
          Object.assign(config, dates);
        }
        const runId = randomUUID();
        await client.query('SAVEPOINT report_schedule_export');
        let output;
        try {
          output = await this.exports.createForScope(
            config,
            `schedule:${row.id}:${row.next_run_at.toISOString()}`,
            auth,
            { correlationId: runId },
            row.scope,
            client,
          );
        } catch (error) {
          await client.query('ROLLBACK TO SAVEPOINT report_schedule_export');
          if (!(error instanceof ApiErrorException) || error.getStatus() >= 500) throw error;
          await client.query(
            "UPDATE reporting.report_schedules SET enabled=false,error_code='REPORT_CONFIGURATION_CHANGED',version=version+1 WHERE id=$1",
            [row.id],
          );
          await this.audit.append(
            {
              actorAccountId: row.owner_account_id,
              correlationId: runId,
              action: 'report.schedule.blocked',
              targetType: 'report_schedule',
              targetId: row.id,
              after: { errorCode: 'REPORT_CONFIGURATION_CHANGED' },
            },
            client,
          );
          return true;
        }
        await client.query(
          'INSERT INTO reporting.report_schedule_runs(id,schedule_id,scheduled_for,export_id) VALUES($1,$2,$3,$4)',
          [runId, row.id, row.next_run_at, output.id],
        );
        await client.query(
          `UPDATE reporting.report_schedules SET occurrence=occurrence+1,next_run_at=(first_run_local+(occurrence+1)*CASE cadence WHEN 'daily' THEN interval '1 day' WHEN 'weekly' THEN interval '7 days' ELSE interval '1 month' END) AT TIME ZONE timezone WHERE id=$1`,
          [row.id],
        );
        await this.audit.append(
          {
            actorAccountId: row.owner_account_id,
            correlationId: runId,
            action: 'report.schedule.run_created',
            targetType: 'report_schedule',
            targetId: row.id,
            after: { exportId: output.id, scheduledFor: row.next_run_at.toISOString() },
          },
          client,
        );
        return true;
      });
      if (!didRun) break;
      processed++;
    }
    return processed;
  }
}
function mapSchedule(r: ScheduleRow): ReportSchedule {
  return {
    id: r.id,
    viewId: r.view_id,
    scope: r.scope,
    name: r.name,
    cadence: r.cadence,
    period: r.period,
    firstRunLocal: r.first_run_local,
    enabled: r.enabled,
    version: r.version,
    nextRunAt: r.next_run_at.toISOString(),
    timezone: r.timezone,
    ...(r.error_code ? { errorCode: r.error_code } : {}),
  };
}
