import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { assertKnownPermission, type Permission } from '@vista/auth';
import type { AppEnvironment } from '@vista/config';
import type {
  ApiPermission,
  AuditEventPage,
  AuditEventRecord,
  AuditIntegrityResult,
  CreateSecurityAccountRequest,
  CreateSecurityRoleRequest,
  ReplaceAccountRolesRequest,
  SecurityAccount,
  SecurityAccountPage,
  SecurityAccountStatus,
  SecurityRole,
  SecurityRoleBrief,
  SecuritySession,
} from '@vista/contracts';
import type { Pool, PoolClient } from 'pg';

import { AuditService } from '../audit/audit.service.js';
import type {
  AuthenticationContext,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';
import type {
  AuditEventListQueryDto,
  SecurityAccountListQueryDto,
  SecuritySessionListQueryDto,
} from './security-administration.dto.js';

interface AccountRow {
  account_id: string;
  active_session_count: string;
  created_at: Date | string;
  display_name: string;
  email: string;
  employee_id: string;
  employee_number: string;
  roles: SecurityRoleBrief[];
  status: SecurityAccountStatus;
  two_factor_enrolled: boolean;
  updated_at: Date | string;
  version: number;
}

interface RoleRow {
  code: string;
  description: string | null;
  id: string;
  is_administrative: boolean;
  is_system_role: boolean;
  name: string;
  permissions: ApiPermission[];
  version: number;
}

interface SessionRow {
  account_id: string;
  created_at: Date | string;
  display_name: string;
  email: string;
  expires_at: Date | string;
  id: string;
  ip_address: string | null;
  last_seen_at: Date | string;
  revoked_at: Date | string | null;
  two_factor_verified: boolean;
  user_agent: string | null;
}

interface AuditRow {
  action: string;
  actor_account_id: string | null;
  actor_display_name: string | null;
  after_data: Record<string, unknown> | null;
  before_data: Record<string, unknown> | null;
  correlation_id: string;
  event_hash: string;
  id: string;
  metadata: Record<string, unknown>;
  occurred_at: Date | string;
  previous_event_hash: string | null;
  source_ip: string | null;
  target_id: string | null;
  target_type: string;
  user_agent: string | null;
}

interface IdempotencyRow {
  request_hash: string;
  response_body: unknown;
  status: 'completed' | 'failed' | 'processing';
}

type Queryable = Pick<Pool | PoolClient, 'query'>;

const accountSelect = `
  SELECT
    account.id AS account_id,
    employee.id AS employee_id,
    employee.employee_number,
    employee.display_name,
    employee.email,
    account.status,
    account.version,
    account.created_at,
    account.updated_at,
    EXISTS (
      SELECT 1 FROM identity.authentication_factors factor
      WHERE factor.account_id = account.id AND factor.enabled = true
    ) AS two_factor_enrolled,
    (
      SELECT count(*)::text FROM identity.session_records session
      WHERE session.account_id = account.id
        AND session.revoked_at IS NULL AND session.expires_at > now()
    ) AS active_session_count,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', role.id,
        'code', role.code,
        'name', role.name,
        'isAdministrative', role.is_administrative
      ) ORDER BY role.name, role.id)
      FROM iam.account_roles account_role
      JOIN iam.roles role ON role.id = account_role.role_id
      WHERE account_role.account_id = account.id
    ), '[]'::jsonb) AS roles
  FROM identity.user_accounts account
  JOIN identity.employees employee ON employee.id = account.employee_id`;

@Injectable()
export class SecurityAdministrationService {
  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async listAccounts(query: SecurityAccountListQueryDto): Promise<SecurityAccountPage> {
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 25);
    const search = normalizeOptional(query.search);
    const pattern = search ? `%${escapeLike(search)}%` : null;
    const where = `
      WHERE ($1::text IS NULL OR account.status = $1)
        AND ($2::text IS NULL
          OR employee.display_name ILIKE $2 ESCAPE E'\\\\'
          OR employee.email ILIKE $2 ESCAPE E'\\\\'
          OR employee.employee_number ILIKE $2 ESCAPE E'\\\\')`;
    const parameters = [query.status ?? null, pattern];
    const [count, rows] = await Promise.all([
      this.database.getPool().query<{ total: string }>(
        `SELECT count(*)::text AS total
         FROM identity.user_accounts account
         JOIN identity.employees employee ON employee.id = account.employee_id
         ${where}`,
        parameters,
      ),
      this.database.getPool().query<AccountRow>(
        `${accountSelect}
         ${where}
         ORDER BY employee.display_name, account.id
         LIMIT $3 OFFSET $4`,
        [...parameters, pageSize, (page - 1) * pageSize],
      ),
    ]);
    const total = Number(count.rows[0]?.total ?? 0);
    return {
      items: rows.rows.map(mapAccount),
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }

  async createAccount(
    input: CreateSecurityAccountRequest,
    keyValue: string | undefined,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<SecurityAccount> {
    const normalized = {
      displayName: normalizeRequired(input.displayName, 'displayName'),
      email: input.email.trim().toLowerCase(),
      employeeNumber: input.employeeNumber.trim().toUpperCase(),
      initialPassword: input.initialPassword,
    };
    const result = await this.runIdempotent<SecurityAccount>(
      'security.account.create',
      keyValue,
      normalized,
      201,
      async (client) => {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext('vista.security.account.create'))",
        );
        const duplicate = await client.query(
          `SELECT 1 FROM identity.employees
           WHERE email = $1 OR employee_number = $2`,
          [normalized.email, normalized.employeeNumber],
        );
        if (duplicate.rowCount) {
          throw new ApiErrorException(
            'EMPLOYEE_ACCOUNT_ALREADY_EXISTS',
            'An employee already uses this email or employee number',
            HttpStatus.CONFLICT,
          );
        }
        const passwordHash = await this.passwords.hash(normalized.initialPassword);
        const employeeId = randomUUID();
        const accountId = randomUUID();
        await client.query(
          `INSERT INTO identity.employees (
             id, employee_number, display_name, email
           ) VALUES ($1, $2, $3, $4)`,
          [employeeId, normalized.employeeNumber, normalized.displayName, normalized.email],
        );
        await client.query(
          `INSERT INTO identity.user_accounts (
             id, employee_id, password_hash, password_expires_at
           ) VALUES ($1, $2, $3, $4)`,
          [accountId, employeeId, passwordHash, this.passwords.passwordExpiresAt() ?? null],
        );
        await this.audit.append(
          {
            action: 'identity.account.created',
            actorAccountId: actor.accountId,
            after: {
              accountId,
              displayName: normalized.displayName,
              email: normalized.email,
              employeeId,
              employeeNumber: normalized.employeeNumber,
              status: 'active',
            },
            correlationId: metadata.correlationId,
            targetId: accountId,
            targetType: 'user_account',
            ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
            ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
          },
          client,
        );
        return requiredAccount(await findAccount(client, accountId));
      },
    );
    return result.value;
  }

  async listRoles(): Promise<SecurityRole[]> {
    const result = await this.database.getPool().query<RoleRow>(roleSelect());
    return result.rows.map(mapRole);
  }

  async createRole(
    input: CreateSecurityRoleRequest,
    keyValue: string | undefined,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<SecurityRole> {
    if (input.isAdministrative) assertAdministrativeFactor(actor);
    const permissions = normalizePermissions(input.permissions);
    const normalized = {
      code: input.code.trim().toLowerCase(),
      description: normalizeOptional(input.description),
      isAdministrative: input.isAdministrative,
      name: normalizeRequired(input.name, 'name'),
      permissions,
    };
    const result = await this.runIdempotent<SecurityRole>(
      'security.role.create',
      keyValue,
      normalized,
      201,
      async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('vista.security.role.create'))");
        const duplicate = await client.query('SELECT 1 FROM iam.roles WHERE code = $1', [
          normalized.code,
        ]);
        if (duplicate.rowCount) {
          throw new ApiErrorException(
            'SECURITY_ROLE_ALREADY_EXISTS',
            'A role already uses this code',
            HttpStatus.CONFLICT,
          );
        }
        const roleId = randomUUID();
        await client.query(
          `INSERT INTO iam.roles (
             id, code, name, description, is_administrative, is_system_role
           ) VALUES ($1, $2, $3, $4, $5, false)`,
          [
            roleId,
            normalized.code,
            normalized.name,
            normalized.description ?? null,
            normalized.isAdministrative,
          ],
        );
        for (const permission of permissions) {
          const permissionId = randomUUID();
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO iam.permissions (id, module, action)
             VALUES ($1, $2, $3)
             ON CONFLICT (module, action) DO UPDATE SET module = EXCLUDED.module
             RETURNING id`,
            [permissionId, permission.module, permission.action],
          );
          await client.query(
            `INSERT INTO iam.role_permissions (role_id, permission_id, granted_by)
             VALUES ($1, $2, $3)`,
            [roleId, inserted.rows[0]?.id, actor.accountId],
          );
        }
        await this.audit.append(
          {
            action: 'iam.role.created',
            actorAccountId: actor.accountId,
            after: {
              code: normalized.code,
              isAdministrative: normalized.isAdministrative,
              name: normalized.name,
              permissions,
            },
            correlationId: metadata.correlationId,
            targetId: roleId,
            targetType: 'role',
            ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
            ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
          },
          client,
        );
        return requiredRole(await findRole(client, roleId));
      },
    );
    return result.value;
  }

  async replaceAccountRoles(
    accountId: string,
    input: ReplaceAccountRolesRequest,
    keyValue: string | undefined,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<SecurityAccount> {
    const roleIds = [...new Set(input.roleIds)].sort();
    const result = await this.runIdempotent<SecurityAccount>(
      `security.account.${accountId}.roles.replace`,
      keyValue,
      { expectedVersion: input.expectedVersion, roleIds },
      200,
      async (client) => {
        await lockAccount(client, accountId, input.expectedVersion);
        const roles = roleIds.length
          ? await client.query<{ id: string; is_administrative: boolean }>(
              'SELECT id, is_administrative FROM iam.roles WHERE id = ANY($1::uuid[])',
              [roleIds],
            )
          : { rows: [] };
        if (roles.rows.length !== roleIds.length) {
          throw new ApiErrorException(
            'SECURITY_ROLE_NOT_FOUND',
            'One or more selected roles do not exist',
            HttpStatus.BAD_REQUEST,
          );
        }
        const nextAdministrative = roles.rows.some((role) => role.is_administrative);
        if (nextAdministrative) {
          assertAdministrativeFactor(actor);
          const factor = await client.query(
            `SELECT 1 FROM identity.authentication_factors
             WHERE account_id = $1 AND enabled = true`,
            [accountId],
          );
          if (!factor.rowCount) {
            throw new ApiErrorException(
              'TWO_FACTOR_ENROLLMENT_REQUIRED',
              'Administrative access requires an enrolled second factor',
              HttpStatus.CONFLICT,
            );
          }
        }
        const currentResult = await client.query<{ role_id: string }>(
          'SELECT role_id FROM iam.account_roles WHERE account_id = $1 ORDER BY role_id',
          [accountId],
        );
        const currentRoleIds = currentResult.rows.map((row) => row.role_id);
        if (sameStrings(currentRoleIds, roleIds))
          return requiredAccount(await findAccount(client, accountId));
        const currentlyAdministrative = await accountIsAdministrative(client, accountId);
        if (currentlyAdministrative && !nextAdministrative) {
          await ensureAnotherActiveAdministrator(client, accountId);
        }
        await client.query('DELETE FROM iam.account_roles WHERE account_id = $1', [accountId]);
        for (const roleId of roleIds) {
          await client.query(
            `INSERT INTO iam.account_roles (account_id, role_id, assigned_by)
             VALUES ($1, $2, $3)`,
            [accountId, roleId, actor.accountId],
          );
        }
        await client.query(
          `UPDATE identity.user_accounts
           SET version = version + 1, updated_at = now()
           WHERE id = $1`,
          [accountId],
        );
        await this.audit.append(
          {
            action: 'iam.account_roles.replaced',
            actorAccountId: actor.accountId,
            after: { roleIds },
            before: { roleIds: currentRoleIds },
            correlationId: metadata.correlationId,
            targetId: accountId,
            targetType: 'user_account',
            ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
            ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
          },
          client,
        );
        return requiredAccount(await findAccount(client, accountId));
      },
    );
    return result.value;
  }

  async changeAccountStatus(
    accountId: string,
    status: 'active' | 'disabled',
    expectedVersion: number,
    keyValue: string | undefined,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<SecurityAccount> {
    if (accountId === actor.accountId && status === 'disabled') {
      throw new ApiErrorException(
        'SELF_ACCOUNT_DISABLE_FORBIDDEN',
        'You cannot disable your current account',
        HttpStatus.CONFLICT,
      );
    }
    const result = await this.runIdempotent<SecurityAccount>(
      `security.account.${accountId}.status.${status}`,
      keyValue,
      { expectedVersion, status },
      200,
      async (client) => {
        const account = await lockAccount(client, accountId, expectedVersion);
        if (account.status === status) return requiredAccount(await findAccount(client, accountId));
        if (status === 'disabled' && (await accountIsAdministrative(client, accountId))) {
          await ensureAnotherActiveAdministrator(client, accountId);
        }
        await client.query(
          `UPDATE identity.user_accounts
           SET status = $2, failed_login_count = 0, locked_until = NULL,
               version = version + 1, updated_at = now()
           WHERE id = $1`,
          [accountId, status],
        );
        await this.audit.append(
          {
            action:
              status === 'disabled' ? 'identity.account.disabled' : 'identity.account.reactivated',
            actorAccountId: actor.accountId,
            after: { status },
            before: { status: account.status },
            correlationId: metadata.correlationId,
            targetId: accountId,
            targetType: 'user_account',
            ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
            ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
          },
          client,
        );
        return requiredAccount(await findAccount(client, accountId));
      },
    );
    if (status === 'disabled') {
      await this.sessions.revokeAllForAccount(accountId, actor, metadata);
      return requiredAccount(await findAccount(this.database.getPool(), accountId));
    }
    return result.value;
  }

  async listSessions(query: SecuritySessionListQueryDto): Promise<SecuritySession[]> {
    const result = await this.database.getPool().query<SessionRow>(
      `SELECT session.id, session.account_id, employee.display_name, employee.email,
              session.created_at, session.last_seen_at, session.expires_at,
              session.revoked_at, host(session.ip_address) AS ip_address, session.user_agent,
              session.two_factor_verified
       FROM identity.session_records session
       JOIN identity.user_accounts account ON account.id = session.account_id
       JOIN identity.employees employee ON employee.id = account.employee_id
       WHERE ($1::uuid IS NULL OR session.account_id = $1)
       ORDER BY session.created_at DESC, session.id DESC
       LIMIT 250`,
      [query.accountId ?? null],
    );
    return result.rows.map(mapSession);
  }

  async revokeSession(
    sessionId: string,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<void> {
    if (!(await this.sessions.revokeByAdministrator(sessionId, actor, metadata))) {
      throw new ApiErrorException(
        'SESSION_NOT_FOUND',
        'The login session was not found',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  async listAuditEvents(query: AuditEventListQueryDto): Promise<AuditEventPage> {
    if (query.from && query.to && new Date(query.from) > new Date(query.to)) {
      throw new ApiErrorException(
        'INVALID_DATE_RANGE',
        'The audit start date must not be after the end date',
        HttpStatus.BAD_REQUEST,
      );
    }
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 25);
    const parameters: unknown[] = [];
    const conditions: string[] = [];
    const add = (value: unknown): string => {
      parameters.push(value);
      return `$${parameters.length}`;
    };
    if (query.action)
      conditions.push(`event.action ILIKE ${add(`%${escapeLike(query.action)}%`)} ESCAPE E'\\\\'`);
    if (query.actorAccountId)
      conditions.push(`event.actor_account_id = ${add(query.actorAccountId)}::uuid`);
    if (query.targetType) conditions.push(`event.target_type = ${add(query.targetType)}`);
    if (query.from) conditions.push(`event.occurred_at >= ${add(query.from)}::timestamptz`);
    if (query.to) conditions.push(`event.occurred_at <= ${add(query.to)}::timestamptz`);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const count = await this.database
      .getPool()
      .query<{ total: string }>(
        `SELECT count(*)::text AS total FROM audit.events event ${where}`,
        parameters,
      );
    const limit = add(pageSize);
    const offset = add((page - 1) * pageSize);
    const rows = await this.database.getPool().query<AuditRow>(
      `SELECT event.id, event.occurred_at, event.actor_account_id,
              employee.display_name AS actor_display_name, event.action,
              event.target_type, event.target_id, event.correlation_id,
              host(event.source_ip) AS source_ip, event.user_agent, event.before_data,
              event.after_data, event.metadata, event.previous_event_hash,
              event.event_hash
       FROM audit.events event
       LEFT JOIN identity.user_accounts account ON account.id = event.actor_account_id
       LEFT JOIN identity.employees employee ON employee.id = account.employee_id
       ${where}
       ORDER BY event.occurred_at DESC, event.id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      parameters,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return {
      items: rows.rows.map(mapAuditEvent),
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }

  verifyAuditIntegrity(): Promise<AuditIntegrityResult> {
    return this.audit.verifyIntegrity();
  }

  private async runIdempotent<T>(
    scope: string,
    keyValue: string | undefined,
    request: unknown,
    responseStatus: number,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<{ replayed: boolean; value: T }> {
    const key = validIdempotencyKey(keyValue);
    const hash = createHash('sha256').update(canonicalJson(request)).digest('hex');
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO platform.idempotency_keys (
           scope, idempotency_key, request_hash, status, expires_at
         ) VALUES ($1, $2, $3, 'processing', now() + ($4::bigint * interval '1 second'))
         ON CONFLICT DO NOTHING RETURNING idempotency_key`,
        [scope, key, hash, this.environment.IDEMPOTENCY_TTL_SECONDS],
      );
      if (!inserted.rowCount) {
        const existing = await client.query<IdempotencyRow>(
          `SELECT request_hash, status, response_body
           FROM platform.idempotency_keys
           WHERE scope = $1 AND idempotency_key = $2
           FOR UPDATE`,
          [scope, key],
        );
        const row = existing.rows[0];
        if (!row || row.request_hash !== hash || row.status !== 'completed') {
          throw new ApiErrorException(
            'IDEMPOTENCY_KEY_CONFLICT',
            'The idempotency key was already used for a different or incomplete request',
            HttpStatus.CONFLICT,
          );
        }
        await client.query('COMMIT');
        return { replayed: true, value: row.response_body as T };
      }
      const value = await work(client);
      await client.query(
        `UPDATE platform.idempotency_keys
         SET status = 'completed', response_status = $3, response_body = $4
         WHERE scope = $1 AND idempotency_key = $2`,
        [scope, key, responseStatus, value],
      );
      await client.query('COMMIT');
      return { replayed: false, value };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function roleSelect(where = ''): string {
  return `SELECT role.id, role.code, role.name, role.description,
                 role.is_administrative, role.is_system_role, role.version,
                 COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                     'module', permission.module,
                     'action', permission.action
                   ) ORDER BY permission.module, permission.action)
                   FROM iam.role_permissions role_permission
                   JOIN iam.permissions permission ON permission.id = role_permission.permission_id
                   WHERE role_permission.role_id = role.id
                 ), '[]'::jsonb) AS permissions
          FROM iam.roles role
          ${where}
          ORDER BY role.name, role.id`;
}

async function findAccount(
  queryable: Queryable,
  accountId: string,
): Promise<AccountRow | undefined> {
  const result = await queryable.query<AccountRow>(`${accountSelect} WHERE account.id = $1`, [
    accountId,
  ]);
  return result.rows[0];
}

async function findRole(queryable: Queryable, roleId: string): Promise<RoleRow | undefined> {
  const result = await queryable.query<RoleRow>(roleSelect('WHERE role.id = $1'), [roleId]);
  return result.rows[0];
}

async function lockAccount(
  client: PoolClient,
  accountId: string,
  expectedVersion: number,
): Promise<{ status: SecurityAccountStatus }> {
  const result = await client.query<{ status: SecurityAccountStatus; version: number }>(
    `SELECT status, version FROM identity.user_accounts WHERE id = $1 FOR UPDATE`,
    [accountId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiErrorException(
      'SECURITY_ACCOUNT_NOT_FOUND',
      'The employee account was not found',
      HttpStatus.NOT_FOUND,
    );
  }
  if (row.version !== expectedVersion) {
    throw new ApiErrorException(
      'RECORD_VERSION_CONFLICT',
      'The employee account changed; reload it and try again',
      HttpStatus.CONFLICT,
    );
  }
  return row;
}

async function accountIsAdministrative(queryable: Queryable, accountId: string): Promise<boolean> {
  const result = await queryable.query<{ administrative: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM iam.account_roles account_role
       JOIN iam.roles role ON role.id = account_role.role_id
       WHERE account_role.account_id = $1 AND role.is_administrative = true
     ) AS administrative`,
    [accountId],
  );
  return result.rows[0]?.administrative ?? false;
}

async function ensureAnotherActiveAdministrator(
  client: PoolClient,
  excludedAccountId: string,
): Promise<void> {
  const result = await client.query(
    `SELECT 1
     FROM identity.user_accounts account
     JOIN iam.account_roles account_role ON account_role.account_id = account.id
     JOIN iam.roles role ON role.id = account_role.role_id
     WHERE account.id <> $1 AND account.status = 'active' AND role.is_administrative = true
     LIMIT 1`,
    [excludedAccountId],
  );
  if (!result.rowCount) {
    throw new ApiErrorException(
      'LAST_ADMINISTRATOR_PROTECTED',
      'The last active administrative account cannot lose administrative access',
      HttpStatus.CONFLICT,
    );
  }
}

function assertAdministrativeFactor(actor: AuthenticationContext): void {
  if (!actor.isAdministrative || !actor.twoFactorVerified) {
    throw new ApiErrorException(
      'ADMINISTRATIVE_FACTOR_REQUIRED',
      'A two-factor-verified administrative session is required',
      HttpStatus.FORBIDDEN,
    );
  }
}

function normalizePermissions(input: ApiPermission[]): ApiPermission[] {
  const unique = new Map<string, ApiPermission>();
  for (const candidate of input) {
    const permission: Permission = { action: candidate.action, module: candidate.module };
    try {
      assertKnownPermission(permission);
    } catch {
      throw new ApiErrorException(
        'UNKNOWN_PERMISSION',
        'A selected permission is not supported',
        HttpStatus.BAD_REQUEST,
      );
    }
    unique.set(`${permission.module}:${permission.action}`, permission);
  }
  return [...unique.values()].sort((left, right) =>
    `${left.module}:${left.action}`.localeCompare(`${right.module}:${right.action}`),
  );
}

function mapAccount(row: AccountRow): SecurityAccount {
  return {
    accountId: row.account_id,
    activeSessionCount: Number(row.active_session_count),
    createdAt: asIso(row.created_at),
    displayName: row.display_name,
    email: row.email,
    employeeId: row.employee_id,
    employeeNumber: row.employee_number,
    roles: row.roles,
    status: row.status,
    twoFactorEnrolled: row.two_factor_enrolled,
    updatedAt: asIso(row.updated_at),
    version: row.version,
  };
}

function mapRole(row: RoleRow): SecurityRole {
  return {
    code: row.code,
    ...(row.description ? { description: row.description } : {}),
    id: row.id,
    isAdministrative: row.is_administrative,
    isSystemRole: row.is_system_role,
    name: row.name,
    permissions: row.permissions,
    version: row.version,
  };
}

function mapSession(row: SessionRow): SecuritySession {
  return {
    accountId: row.account_id,
    createdAt: asIso(row.created_at),
    displayName: row.display_name,
    email: row.email,
    expiresAt: asIso(row.expires_at),
    id: row.id,
    ...(row.ip_address ? { ipAddress: row.ip_address } : {}),
    lastSeenAt: asIso(row.last_seen_at),
    ...(row.revoked_at ? { revokedAt: asIso(row.revoked_at) } : {}),
    twoFactorVerified: row.two_factor_verified,
    ...(row.user_agent ? { userAgent: row.user_agent } : {}),
  };
}

function mapAuditEvent(row: AuditRow): AuditEventRecord {
  return {
    action: row.action,
    ...(row.actor_account_id ? { actorAccountId: row.actor_account_id } : {}),
    ...(row.actor_display_name ? { actorDisplayName: row.actor_display_name } : {}),
    ...(row.after_data ? { after: row.after_data } : {}),
    ...(row.before_data ? { before: row.before_data } : {}),
    correlationId: row.correlation_id,
    eventHash: row.event_hash,
    id: row.id,
    metadata: row.metadata,
    occurredAt: asIso(row.occurred_at),
    ...(row.previous_event_hash ? { previousEventHash: row.previous_event_hash } : {}),
    ...(row.source_ip ? { sourceIp: row.source_ip } : {}),
    ...(row.target_id ? { targetId: row.target_id } : {}),
    targetType: row.target_type,
    ...(row.user_agent ? { userAgent: row.user_agent } : {}),
  };
}

function requiredAccount(row: AccountRow | undefined): SecurityAccount {
  if (!row) throw new Error('Expected the employee account to exist');
  return mapAccount(row);
}

function requiredRole(row: RoleRow | undefined): SecurityRole {
  if (!row) throw new Error('Expected the security role to exist');
  return mapRole(row);
}

function normalizeRequired(value: string, field: string): string {
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (!normalized) {
    throw new ApiErrorException(
      'VALIDATION_FAILED',
      `${field} is required`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return normalized;
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/gu, ' ');
  return normalized || undefined;
}

function validIdempotencyKey(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9._:-]{8,128}$/u.test(value)) {
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_REQUIRED',
      'Provide an Idempotency-Key with 8 to 128 safe characters',
      HttpStatus.BAD_REQUEST,
    );
  }
  return value;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, '\\$&');
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
