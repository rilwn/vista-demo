import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Permission, PermissionAction, PermissionModule } from '@vista/auth';
import type { AppEnvironment } from '@vista/config';

import { AuditService } from '../audit/audit.service.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';
import { RedisService } from '../database/redis.service.js';
import type { AuthenticationContext, RequestSecurityMetadata } from './authentication.types.js';

interface StoredSession {
  accountId: string;
  sessionId: string;
  twoFactorVerified: boolean;
}

interface SessionAccountRow {
  account_id: string;
  display_name: string;
  email: string;
  employee_id: string;
  expires_at: Date;
  is_administrative: boolean;
  session_id: string;
  two_factor_verified: boolean;
}

@Injectable()
export class SessionService {
  private readonly ttlSeconds: number;

  constructor(
    @Inject(APP_ENVIRONMENT) environment: AppEnvironment,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {
    this.ttlSeconds = environment.SESSION_TTL_SECONDS;
  }

  async create(
    accountId: string,
    twoFactorVerified: boolean,
    metadata: RequestSecurityMetadata,
  ): Promise<{ expiresAt: string; sessionId: string; token: string }> {
    const token = randomBytes(32).toString('base64url');
    const digest = digestToken(token);
    const redisKey = sessionKey(digest);
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1_000);
    const stored: StoredSession = { accountId, sessionId, twoFactorVerified };
    const redis = await this.redis.ensureConnected();
    const storedInRedis = await redis.set(
      redisKey,
      JSON.stringify(stored),
      'EX',
      this.ttlSeconds,
      'NX',
    );
    if (storedInRedis !== 'OK') {
      throw new Error('Unable to allocate a unique session token');
    }

    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE identity.user_accounts
         SET failed_login_count = 0, locked_until = NULL, updated_at = now()
         WHERE id = $1`,
        [accountId],
      );
      await client.query(
        `INSERT INTO identity.session_records (
           id, account_id, redis_key_digest, expires_at, ip_address, user_agent
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          sessionId,
          accountId,
          digest,
          expiresAt,
          metadata.sourceIp ?? null,
          metadata.userAgent ?? null,
        ],
      );
      await this.audit.append(
        {
          action: 'auth.login.succeeded',
          actorAccountId: accountId,
          after: { sessionId, twoFactorVerified },
          correlationId: metadata.correlationId,
          targetId: accountId,
          targetType: 'user_account',
          ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
          ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
        },
        client,
      );
      await client.query('COMMIT');
      return { expiresAt: expiresAt.toISOString(), sessionId, token };
    } catch (error) {
      await client.query('ROLLBACK');
      await redis.del(redisKey);
      throw error;
    } finally {
      client.release();
    }
  }

  async resolve(token: string): Promise<AuthenticationContext | undefined> {
    if (!/^[a-zA-Z0-9_-]{43}$/u.test(token)) {
      return undefined;
    }
    const digest = digestToken(token);
    const redis = await this.redis.ensureConnected();
    const serialized = await redis.get(sessionKey(digest));
    if (!serialized) {
      return undefined;
    }
    const stored = parseStoredSession(serialized);
    if (!stored) {
      await redis.del(sessionKey(digest));
      return undefined;
    }

    const result = await this.database.getPool().query<SessionAccountRow>(
      `SELECT
         session.id AS session_id,
         session.account_id,
         session.expires_at,
         account.employee_id,
         employee.display_name,
         employee.email,
         $3::boolean AS two_factor_verified,
         COALESCE(bool_or(role.is_administrative), false) AS is_administrative
       FROM identity.session_records session
       JOIN identity.user_accounts account ON account.id = session.account_id
       JOIN identity.employees employee ON employee.id = account.employee_id
       LEFT JOIN iam.account_roles account_role ON account_role.account_id = account.id
       LEFT JOIN iam.roles role ON role.id = account_role.role_id
       WHERE session.id = $1
         AND session.redis_key_digest = $2
         AND session.revoked_at IS NULL
         AND session.expires_at > now()
         AND account.status = 'active'
         AND employee.active = true
         AND (account.locked_until IS NULL OR account.locked_until <= now())
       GROUP BY session.id, account.id, employee.id`,
      [stored.sessionId, digest, stored.twoFactorVerified],
    );
    const account = result.rows[0];
    if (!account || account.account_id !== stored.accountId) {
      await redis.del(sessionKey(digest));
      return undefined;
    }
    if (account.is_administrative && !account.two_factor_verified) {
      await redis.del(sessionKey(digest));
      return undefined;
    }

    const permissions = await this.loadPermissions(account.account_id);
    await this.database
      .getPool()
      .query('UPDATE identity.session_records SET last_seen_at = now() WHERE id = $1', [
        account.session_id,
      ]);
    return {
      accountId: account.account_id,
      displayName: account.display_name,
      email: account.email,
      employeeId: account.employee_id,
      isAdministrative: account.is_administrative,
      permissions,
      sessionId: account.session_id,
      twoFactorVerified: account.two_factor_verified,
    };
  }

  async revoke(context: AuthenticationContext, metadata: RequestSecurityMetadata): Promise<void> {
    const client = await this.database.getPool().connect();
    let digest: string | undefined;
    try {
      await client.query('BEGIN');
      const result = await client.query<{ redis_key_digest: string }>(
        `UPDATE identity.session_records
         SET revoked_at = COALESCE(revoked_at, now())
         WHERE id = $1 AND account_id = $2
         RETURNING redis_key_digest`,
        [context.sessionId, context.accountId],
      );
      digest = result.rows[0]?.redis_key_digest;
      await this.audit.append(
        {
          action: 'auth.session.revoked',
          actorAccountId: context.accountId,
          correlationId: metadata.correlationId,
          targetId: context.sessionId,
          targetType: 'login_session',
          ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
          ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
        },
        client,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    if (digest) {
      const redis = await this.redis.ensureConnected();
      await redis.del(sessionKey(digest));
    }
  }

  private async loadPermissions(accountId: string): Promise<Permission[]> {
    const result = await this.database.getPool().query<{
      action: PermissionAction;
      module: PermissionModule;
    }>(
      `SELECT DISTINCT permission.module, permission.action
       FROM iam.account_roles account_role
       JOIN iam.role_permissions role_permission ON role_permission.role_id = account_role.role_id
       JOIN iam.permissions permission ON permission.id = role_permission.permission_id
       WHERE account_role.account_id = $1
       ORDER BY permission.module, permission.action`,
      [accountId],
    );
    return result.rows;
  }
}

function digestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function sessionKey(digest: string): string {
  return `vista:session:${digest}`;
}

function parseStoredSession(value: string): StoredSession | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>)['accountId'] === 'string' &&
      typeof (parsed as Record<string, unknown>)['sessionId'] === 'string' &&
      typeof (parsed as Record<string, unknown>)['twoFactorVerified'] === 'boolean'
    ) {
      return parsed as StoredSession;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function requireAuthentication(
  context: AuthenticationContext | undefined,
): AuthenticationContext {
  if (!context) {
    throw new ApiErrorException(
      'AUTHENTICATION_REQUIRED',
      'Authentication is required',
      HttpStatus.UNAUTHORIZED,
    );
  }
  return context;
}
