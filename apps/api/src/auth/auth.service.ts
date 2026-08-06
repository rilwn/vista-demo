import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type { PoolClient } from 'pg';

import { AuditService } from '../audit/audit.service.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';
import type { RequestSecurityMetadata } from './authentication.types.js';
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

@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(TotpService) private readonly totp: TotpService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

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

  private verifyTotp(code: string, encryptedSecret: Buffer): boolean {
    try {
      return this.totp.verify(code, encryptedSecret);
    } catch {
      return false;
    }
  }
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
