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
import {
  mapDirectoryGroupsToRoleCodes,
  type DirectoryProvider,
} from './directory-authentication.service.js';

interface StoredSession {
  authMethod?: 'password' | 'directory_password' | 'oidc' | 'saml' | 'emergency_password';
  authProvider?: 'local' | DirectoryProvider;
  accountId: string;
  directoryGroups?: string[];
  sessionId: string;
  twoFactorVerified: boolean;
}

interface SessionAccountRow {
  auth_provider: 'local' | DirectoryProvider;
  account_id: string;
  display_name: string;
  email: string;
  employee_id: string;
  expires_at: Date;
  is_administrative: boolean;
  role_names: string[];
  directory_groups: string[];
  session_id: string;
  two_factor_verified: boolean;
}

@Injectable()
export class SessionService {
  private readonly ttlSeconds: number;
  private readonly environment: AppEnvironment;

  constructor(
    @Inject(APP_ENVIRONMENT) environment: AppEnvironment,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {
    this.environment = environment;
    this.ttlSeconds = environment.SESSION_TTL_SECONDS;
  }

  async create(
    accountId: string,
    twoFactorVerified: boolean,
    metadata: RequestSecurityMetadata,
    authentication: {
      authMethod?: StoredSession['authMethod'];
      authProvider?: StoredSession['authProvider'];
      directoryGroups?: string[];
      emergencyReason?: string;
    } = {},
  ): Promise<{ expiresAt: string; sessionId: string; token: string }> {
    const token = randomBytes(32).toString('base64url');
    const digest = digestToken(token);
    const redisKey = sessionKey(digest);
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1_000);
    const stored: StoredSession = {
      accountId,
      sessionId,
      twoFactorVerified,
      authProvider: authentication.authProvider ?? 'local',
      authMethod: authentication.authMethod ?? 'password',
      directoryGroups: authentication.directoryGroups ?? [],
    };
    const directoryRoleCodes =
      stored.authProvider !== 'local'
        ? mapDirectoryGroupsToRoleCodes(
            stored.directoryGroups ?? [],
            this.environment.DIRECTORY_GROUP_ROLE_MAPPINGS_JSON,
          )
        : [];
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
           id, account_id, redis_key_digest, expires_at, ip_address, user_agent,
           two_factor_verified, auth_provider, auth_method, directory_groups, emergency_access_reason
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          sessionId,
          accountId,
          digest,
          expiresAt,
          metadata.sourceIp ?? null,
          metadata.userAgent ?? null,
          twoFactorVerified,
          stored.authProvider,
          stored.authMethod,
          stored.directoryGroups,
          authentication.emergencyReason ?? null,
        ],
      );
      await this.audit.append(
        {
          action: 'auth.login.succeeded',
          actorAccountId: accountId,
          after: {
            sessionId,
            twoFactorVerified,
            authProvider: stored.authProvider,
            authMethod: stored.authMethod,
            directoryGroupCount: stored.directoryGroups?.length ?? 0,
            directoryRoleCodes,
            emergencyAccess: Boolean(authentication.emergencyReason),
          },
          correlationId: metadata.correlationId,
          targetId: accountId,
          targetType: 'user_account',
          ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
          ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
        },
        client,
      );
      if (authentication.emergencyReason) {
        await this.audit.append(
          {
            action: 'auth.emergency_access.used',
            actorAccountId: accountId,
            after: {
              authProvider: this.environment.DIRECTORY_AUTH_PROVIDER,
              reason: authentication.emergencyReason.slice(0, 500),
            },
            correlationId: metadata.correlationId,
            targetId: accountId,
            targetType: 'user_account',
            ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
            ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
          },
          client,
        );
      }
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

    const mappedRoleCodes =
      stored.authProvider && stored.authProvider !== 'local'
        ? mapDirectoryGroupsToRoleCodes(
            stored.directoryGroups ?? [],
            this.environment.DIRECTORY_GROUP_ROLE_MAPPINGS_JSON,
          )
        : [];
    const result = await this.database.getPool().query<SessionAccountRow>(
      `SELECT
         session.id AS session_id,
         session.account_id,
         session.expires_at,
         session.auth_provider,
         session.directory_groups,
         account.employee_id,
         employee.display_name,
         employee.email,
         $3::boolean AS two_factor_verified,
         COALESCE(bool_or(role.is_administrative), false) AS is_administrative,
         COALESCE(array_agg(DISTINCT role.name ORDER BY role.name)
           FILTER (WHERE role.id IS NOT NULL), ARRAY[]::text[]) AS role_names
       FROM identity.session_records session
       JOIN identity.user_accounts account ON account.id = session.account_id
       JOIN identity.employees employee ON employee.id = account.employee_id
       LEFT JOIN iam.account_roles account_role ON account_role.account_id = account.id
       LEFT JOIN iam.roles assigned_role ON assigned_role.id = account_role.role_id
       LEFT JOIN iam.roles role ON role.id = assigned_role.id OR role.code = ANY($4::text[])
       WHERE session.id = $1
         AND session.redis_key_digest = $2
         AND session.revoked_at IS NULL
         AND session.expires_at > now()
         AND account.status = 'active'
         AND employee.active = true
         AND (account.locked_until IS NULL OR account.locked_until <= now())
       GROUP BY session.id, account.id, employee.id`,
      [stored.sessionId, digest, stored.twoFactorVerified, mappedRoleCodes],
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

    const permissions = await this.loadPermissions(account.account_id, mappedRoleCodes);
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
      roleNames: account.role_names,
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

  async revokeByAdministrator(
    sessionId: string,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<boolean> {
    const client = await this.database.getPool().connect();
    let digest: string | undefined;
    try {
      await client.query('BEGIN');
      const existing = await client.query<{
        account_id: string;
        redis_key_digest: string;
        revoked_at: Date | null;
      }>(
        `SELECT account_id, redis_key_digest, revoked_at
         FROM identity.session_records
         WHERE id = $1
         FOR UPDATE`,
        [sessionId],
      );
      const session = existing.rows[0];
      if (!session) {
        await client.query('COMMIT');
        return false;
      }
      if (!session.revoked_at) {
        await client.query('UPDATE identity.session_records SET revoked_at = now() WHERE id = $1', [
          sessionId,
        ]);
        digest = session.redis_key_digest;
        await this.audit.append(
          {
            action: 'auth.session.revoked_by_administrator',
            actorAccountId: actor.accountId,
            after: { accountId: session.account_id, revoked: true },
            correlationId: metadata.correlationId,
            targetId: sessionId,
            targetType: 'login_session',
            ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
            ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
          },
          client,
        );
      }
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
    return true;
  }

  async revokeAllForAccount(
    accountId: string,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<number> {
    const client = await this.database.getPool().connect();
    let digests: string[] = [];
    try {
      await client.query('BEGIN');
      const result = await client.query<{ redis_key_digest: string }>(
        `UPDATE identity.session_records
         SET revoked_at = now()
         WHERE account_id = $1 AND revoked_at IS NULL
         RETURNING redis_key_digest`,
        [accountId],
      );
      digests = result.rows.map((row) => row.redis_key_digest);
      if (digests.length > 0) {
        await this.audit.append(
          {
            action: 'auth.account_sessions.revoked',
            actorAccountId: actor.accountId,
            after: { revokedSessionCount: digests.length },
            correlationId: metadata.correlationId,
            targetId: accountId,
            targetType: 'user_account',
            ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
            ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
          },
          client,
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    if (digests.length > 0) {
      const redis = await this.redis.ensureConnected();
      await Promise.all(digests.map((digest) => redis.del(sessionKey(digest))));
    }
    return digests.length;
  }

  async removeRevokedSessionTokens(digests: string[]): Promise<void> {
    if (digests.length === 0) return;
    const redis = await this.redis.ensureConnected();
    await Promise.all(digests.map((digest) => redis.del(sessionKey(digest))));
  }

  private async loadPermissions(
    accountId: string,
    mappedRoleCodes: string[],
  ): Promise<Permission[]> {
    const result = await this.database.getPool().query<{
      action: PermissionAction;
      module: PermissionModule;
    }>(
      `SELECT DISTINCT permission.module, permission.action
       FROM iam.roles role
       JOIN iam.role_permissions role_permission ON role_permission.role_id = role.id
       JOIN iam.permissions permission ON permission.id = role_permission.permission_id
       WHERE role.code = ANY($2::text[])
          OR EXISTS (
            SELECT 1 FROM iam.account_roles account_role
            WHERE account_role.account_id = $1 AND account_role.role_id = role.id
          )
       ORDER BY permission.module, permission.action`,
      [accountId, mappedRoleCodes],
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
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    const validProvider =
      record['authProvider'] === undefined ||
      (typeof record['authProvider'] === 'string' &&
        ['local', 'ldap', 'oidc', 'saml'].includes(record['authProvider']));
    const validMethod =
      record['authMethod'] === undefined ||
      (typeof record['authMethod'] === 'string' &&
        ['password', 'directory_password', 'oidc', 'saml', 'emergency_password'].includes(
          record['authMethod'],
        ));
    const groups = record['directoryGroups'];
    const validGroups =
      groups === undefined ||
      (Array.isArray(groups) &&
        groups.length <= 500 &&
        groups.every(
          (group) => typeof group === 'string' && group.length > 0 && group.length <= 512,
        ));
    if (
      typeof record['accountId'] === 'string' &&
      typeof record['sessionId'] === 'string' &&
      typeof record['twoFactorVerified'] === 'boolean' &&
      validProvider &&
      validMethod &&
      validGroups
    )
      return parsed as StoredSession;
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
