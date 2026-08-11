import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  ChangePasswordRequest,
  ChangePasswordResponse,
  PasswordPolicyResponse,
} from '@vista/contracts';
import type { PoolClient } from 'pg';

import { AuditService } from '../audit/audit.service.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';
import { StructuredLogger } from '../logging/structured-logger.service.js';
import type { AuthenticationContext, RequestSecurityMetadata } from './authentication.types.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import { TotpService } from './totp.service.js';

export interface LoginInput {
  email: string;
  password: string;
  totpCode?: string;
}

export interface LoginResult {
  account: {
    displayName: string;
    email: string;
    id: string;
    isAdministrative: boolean;
  };
  expiresAt: string;
  sessionToken: string;
}

interface AccountRow {
  active: boolean;
  display_name: string;
  email: string;
  failed_login_count: number;
  id: string;
  is_administrative: boolean;
  locked_until: Date | null;
  password_expires_at: Date | null;
  password_hash: string;
  status: 'active' | 'disabled' | 'locked';
}

interface PasswordAccountRow {
  password_hash: string;
  status: 'active' | 'disabled' | 'locked';
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(TotpService) private readonly totp: TotpService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(StructuredLogger) private readonly logger: StructuredLogger,
  ) {}

  passwordPolicy(): PasswordPolicyResponse {
    return this.passwords.policySummary();
  }

  async changePassword(
    input: ChangePasswordRequest,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<ChangePasswordResponse> {
    const client = await this.database.getPool().connect();
    let transactionOpen = false;
    let revokedDigests: string[] = [];
    const changedAt = new Date();
    const expiresAt = this.passwords.passwordExpiresAt(changedAt);
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      const accountResult = await client.query<PasswordAccountRow>(
        `SELECT password_hash, status
         FROM identity.user_accounts
         WHERE id = $1
         FOR UPDATE`,
        [actor.accountId],
      );
      const account = accountResult.rows[0];
      if (!account || account.status !== 'active') {
        throw new ApiErrorException(
          'AUTHENTICATION_REQUIRED',
          'Authentication is required',
          HttpStatus.UNAUTHORIZED,
        );
      }
      if (!(await this.passwords.verify(input.currentPassword, account.password_hash))) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        await this.recordPasswordChangeRejection(actor, metadata, 'current_credential_invalid');
        throw new ApiErrorException(
          'CURRENT_PASSWORD_INVALID',
          'The current password is incorrect',
          HttpStatus.BAD_REQUEST,
          [{ field: 'currentPassword', message: 'Enter your current password' }],
        );
      }

      const history = await client.query<{ password_hash: string }>(
        `SELECT password_hash
         FROM identity.password_history
         WHERE account_id = $1
         ORDER BY replaced_at DESC, id DESC
         LIMIT $2`,
        [actor.accountId, this.environment.PASSWORD_HISTORY_COUNT],
      );
      for (const passwordHash of [account.password_hash, ...history.rows.map(rowPasswordHash)]) {
        if (await this.passwords.verify(input.newPassword, passwordHash)) {
          await client.query('ROLLBACK');
          transactionOpen = false;
          await this.recordPasswordChangeRejection(actor, metadata, 'recent_password_reused');
          throw new ApiErrorException(
            'PASSWORD_REUSE_NOT_ALLOWED',
            'A recently used password cannot be used again',
            HttpStatus.BAD_REQUEST,
            [{ field: 'newPassword', message: 'Choose a password you have not used recently' }],
          );
        }
      }

      const passwordHash = await this.passwords.hash(input.newPassword, 'newPassword');
      await client.query(
        `INSERT INTO identity.password_history (
           account_id, password_hash, replaced_at, replaced_by
         ) VALUES ($1, $2, $3, $1)`,
        [actor.accountId, account.password_hash, changedAt],
      );
      await client.query(
        `DELETE FROM identity.password_history
         WHERE id IN (
           SELECT id FROM identity.password_history
           WHERE account_id = $1
           ORDER BY replaced_at DESC, id DESC
           OFFSET $2
         )`,
        [actor.accountId, this.environment.PASSWORD_HISTORY_COUNT],
      );
      await client.query(
        `UPDATE identity.user_accounts
         SET password_hash = $2, password_changed_at = $3, password_expires_at = $4,
             failed_login_count = 0, locked_until = NULL, version = version + 1,
             updated_at = $3
         WHERE id = $1`,
        [actor.accountId, passwordHash, changedAt, expiresAt ?? null],
      );
      const revoked = await client.query<{ redis_key_digest: string }>(
        `UPDATE identity.session_records
         SET revoked_at = now()
         WHERE account_id = $1 AND id <> $2 AND revoked_at IS NULL
         RETURNING redis_key_digest`,
        [actor.accountId, actor.sessionId],
      );
      revokedDigests = revoked.rows.map((row) => row.redis_key_digest);
      await this.audit.append(
        {
          action: 'auth.password.changed',
          actorAccountId: actor.accountId,
          after: {
            ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
            revokedOtherSessionCount: revokedDigests.length,
          },
          correlationId: metadata.correlationId,
          targetId: actor.accountId,
          targetType: 'user_account',
          ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
          ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
        },
        client,
      );
      await client.query('COMMIT');
      transactionOpen = false;
    } catch (error) {
      if (transactionOpen) await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    try {
      await this.sessions.removeRevokedSessionTokens(revokedDigests);
    } catch (error) {
      this.logger.event('warn', 'auth.password.revoked_token_cleanup_failed', {
        accountId: actor.accountId,
        count: revokedDigests.length,
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      });
    }
    return {
      changedAt: changedAt.toISOString(),
      ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
      revokedOtherSessionCount: revokedDigests.length,
    };
  }

  async login(input: LoginInput, metadata: RequestSecurityMetadata): Promise<LoginResult> {
    const email = input.email.trim().toLowerCase();
    const account = await this.findAccount(email);
    const passwordMatches = await this.passwords.verify(
      input.password,
      account?.password_hash ?? 'invalid-password-hash',
    );
    if (!account || !passwordMatches || !account.active || account.status === 'disabled') {
      await this.recordFailedLogin(account, metadata, 'credentials_invalid', Boolean(account));
      throw authenticationFailed();
    }

    if (
      account.status === 'locked' ||
      (account.locked_until !== null && account.locked_until.getTime() > Date.now())
    ) {
      await this.recordFailedLogin(account, metadata, 'account_locked', false);
      throw new ApiErrorException(
        'ACCOUNT_TEMPORARILY_LOCKED',
        'The account is temporarily unavailable',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (
      account.password_expires_at !== null &&
      account.password_expires_at.getTime() <= Date.now()
    ) {
      await this.recordFailedLogin(account, metadata, 'password_expired', false);
      throw new ApiErrorException(
        'PASSWORD_EXPIRED',
        'The password has expired',
        HttpStatus.FORBIDDEN,
      );
    }

    const factors = await this.database.getPool().query<{ encrypted_secret: Buffer }>(
      `SELECT encrypted_secret
       FROM identity.authentication_factors
       WHERE account_id = $1
         AND factor_type = 'totp'
         AND enabled = true
         AND verified_at IS NOT NULL
         AND encrypted_secret IS NOT NULL
       ORDER BY created_at`,
      [account.id],
    );
    if (account.is_administrative && factors.rowCount === 0) {
      await this.recordFailedLogin(account, metadata, 'two_factor_enrollment_required', false);
      throw new ApiErrorException(
        'TWO_FACTOR_ENROLLMENT_REQUIRED',
        'An administrative account must enroll a second factor before login',
        HttpStatus.FORBIDDEN,
      );
    }

    const secondFactorRequired = factors.rows.length > 0;
    if (secondFactorRequired && input.totpCode === undefined) {
      await this.recordFailedLogin(account, metadata, 'two_factor_required', false);
      throw new ApiErrorException(
        'TWO_FACTOR_REQUIRED',
        'A second-factor code is required',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (
      secondFactorRequired &&
      !factors.rows.some(({ encrypted_secret }) =>
        input.totpCode === undefined ? false : this.verifyTotp(input.totpCode, encrypted_secret),
      )
    ) {
      await this.recordFailedLogin(account, metadata, 'two_factor_invalid', true);
      throw authenticationFailed();
    }

    const session = await this.sessions.create(account.id, secondFactorRequired, metadata);
    return {
      account: {
        displayName: account.display_name,
        email: account.email,
        id: account.id,
        isAdministrative: account.is_administrative,
      },
      expiresAt: session.expiresAt,
      sessionToken: session.token,
    };
  }

  private async findAccount(email: string): Promise<AccountRow | undefined> {
    const result = await this.database.getPool().query<AccountRow>(
      `SELECT
         account.id,
         account.password_hash,
         account.password_expires_at,
         account.status,
         account.failed_login_count,
         account.locked_until,
         employee.email,
         employee.display_name,
         employee.active,
         COALESCE(bool_or(role.is_administrative), false) AS is_administrative
       FROM identity.employees employee
       JOIN identity.user_accounts account ON account.employee_id = employee.id
       LEFT JOIN iam.account_roles account_role ON account_role.account_id = account.id
       LEFT JOIN iam.roles role ON role.id = account_role.role_id
       WHERE employee.email = $1
       GROUP BY account.id, employee.id`,
      [email],
    );
    return result.rows[0];
  }

  private async recordFailedLogin(
    account: AccountRow | undefined,
    metadata: RequestSecurityMetadata,
    reason: string,
    incrementFailure: boolean,
  ): Promise<void> {
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      if (account && incrementFailure) {
        await incrementFailedLogin(
          client,
          account.id,
          this.environment.AUTH_MAX_FAILED_ATTEMPTS,
          this.environment.AUTH_LOCKOUT_SECONDS,
        );
      }
      await this.audit.append(
        {
          action: 'auth.login.failed',
          correlationId: metadata.correlationId,
          metadata: { reason },
          targetType: 'user_account',
          ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
          ...(account ? { targetId: account.id } : {}),
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
  }

  private async recordPasswordChangeRejection(
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    reason: string,
  ): Promise<void> {
    await this.audit.append({
      action: 'auth.password.change_rejected',
      actorAccountId: actor.accountId,
      correlationId: metadata.correlationId,
      metadata: { reason },
      targetId: actor.accountId,
      targetType: 'user_account',
      ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
      ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
    });
  }

  private verifyTotp(code: string, encryptedSecret: Buffer): boolean {
    try {
      return this.totp.verify(code, encryptedSecret);
    } catch {
      return false;
    }
  }
}

function rowPasswordHash(row: { password_hash: string }): string {
  return row.password_hash;
}

async function incrementFailedLogin(
  client: PoolClient,
  accountId: string,
  maximumAttempts: number,
  lockoutSeconds: number,
): Promise<void> {
  await client.query(
    `UPDATE identity.user_accounts
     SET failed_login_count = failed_login_count + 1,
         locked_until = CASE
           WHEN failed_login_count + 1 >= $2
             THEN now() + ($3 * interval '1 second')
           ELSE locked_until
         END,
         updated_at = now()
     WHERE id = $1`,
    [accountId, maximumAttempts, lockoutSeconds],
  );
}

function authenticationFailed(): ApiErrorException {
  return new ApiErrorException(
    'AUTHENTICATION_FAILED',
    'The supplied credentials are invalid',
    HttpStatus.UNAUTHORIZED,
  );
}
