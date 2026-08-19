import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  ChangePasswordRequest,
  ChangePasswordResponse,
  DisableTotpRequest,
  DisableTotpResponse,
  PasswordPolicyResponse,
  StartTotpEnrollmentRequest,
  StartTotpEnrollmentResponse,
  TotpEnrollmentStatus,
  VerifyTotpEnrollmentRequest,
  VerifyTotpEnrollmentResponse,
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

interface TotpEnrollmentAccountRow extends PasswordAccountRow {
  email: string;
}

interface TotpFactorRow {
  enabled: boolean;
  encrypted_secret: Buffer;
  expires_at: Date | null;
  id: string;
  verified_at: Date | null;
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

  async totpStatus(actor: AuthenticationContext): Promise<TotpEnrollmentStatus> {
    const result = await this.database.getPool().query<{ enrolled_at: Date | null }>(
      `SELECT max(verified_at) AS enrolled_at
       FROM identity.authentication_factors
       WHERE account_id = $1
         AND factor_type = 'totp'
         AND enabled = true
         AND verified_at IS NOT NULL`,
      [actor.accountId],
    );
    const enrolledAt = result.rows[0]?.enrolled_at;
    return enrolledAt
      ? { enrolled: true, enrolledAt: enrolledAt.toISOString() }
      : { enrolled: false };
  }

  async startTotpEnrollment(
    input: StartTotpEnrollmentRequest,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<StartTotpEnrollmentResponse> {
    const client = await this.database.getPool().connect();
    let enrollment: StartTotpEnrollmentResponse | undefined;
    let rejectionReason: string | undefined;
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      const account = await this.lockTotpEnrollmentAccount(client, actor.accountId);
      if (!(await this.passwords.verify(input.currentPassword, account.password_hash))) {
        rejectionReason = 'current_credential_invalid';
        throw new ApiErrorException(
          'CURRENT_PASSWORD_INVALID',
          'The current password is incorrect',
          HttpStatus.BAD_REQUEST,
          [{ field: 'currentPassword', message: 'Enter your current password' }],
        );
      }

      const active = await client.query<{ id: string }>(
        `SELECT id
         FROM identity.authentication_factors
         WHERE account_id = $1
           AND factor_type = 'totp'
           AND enabled = true
           AND verified_at IS NOT NULL
         FOR UPDATE`,
        [actor.accountId],
      );
      if (active.rowCount) {
        throw new ApiErrorException(
          'TOTP_ALREADY_ENROLLED',
          'An authenticator is already enrolled. Verify it before replacing or removing it.',
          HttpStatus.CONFLICT,
        );
      }

      await client.query(
        `DELETE FROM identity.authentication_factors
         WHERE account_id = $1
           AND factor_type = 'totp'
           AND enabled = false
           AND verified_at IS NULL
           AND (expires_at IS NULL OR expires_at <= now())`,
        [actor.accountId],
      );
      const pending = await client.query<TotpFactorRow>(
        `SELECT id, encrypted_secret, enabled, expires_at, verified_at
         FROM identity.authentication_factors
         WHERE account_id = $1
           AND factor_type = 'totp'
           AND enabled = false
           AND verified_at IS NULL
           AND expires_at > now()
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [actor.accountId],
      );

      if (pending.rows[0]) {
        enrollment = this.totpEnrollmentResponse(
          pending.rows[0].id,
          account.email,
          this.totp.decryptSecret(pending.rows[0].encrypted_secret),
          pending.rows[0].expires_at!,
        );
      } else {
        await client.query(
          `DELETE FROM identity.authentication_factors
           WHERE account_id = $1
             AND factor_type = 'totp'
             AND enabled = false
             AND verified_at IS NULL`,
          [actor.accountId],
        );
        const secret = this.totp.generateSecret();
        const expiresAt = new Date(
          Date.now() + this.environment.TOTP_ENROLLMENT_TTL_SECONDS * 1_000,
        );
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO identity.authentication_factors (
             account_id, factor_type, encrypted_secret, enabled, expires_at
           ) VALUES ($1, 'totp', $2, false, $3)
           RETURNING id`,
          [actor.accountId, this.totp.encryptSecret(secret), expiresAt],
        );
        const enrollmentId = inserted.rows[0]?.id;
        if (!enrollmentId) throw new Error('TOTP enrollment factor was not created');
        enrollment = this.totpEnrollmentResponse(enrollmentId, account.email, secret, expiresAt);
        await this.audit.append(
          {
            action: 'auth.two_factor.enrollment_started',
            actorAccountId: actor.accountId,
            after: { enrollmentId, expiresAt: expiresAt.toISOString(), factorType: 'totp' },
            correlationId: metadata.correlationId,
            targetId: actor.accountId,
            targetType: 'user_account',
            ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
            ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
          },
          client,
        );
      }
      await client.query('COMMIT');
      transactionOpen = false;
    } catch (error) {
      if (transactionOpen) await client.query('ROLLBACK');
      if (rejectionReason) await this.recordTotpRejection(actor, metadata, rejectionReason);
      throw error;
    } finally {
      client.release();
    }
    if (!enrollment) throw new Error('TOTP enrollment response was not created');
    return enrollment;
  }

  async verifyTotpEnrollment(
    enrollmentId: string,
    input: VerifyTotpEnrollmentRequest,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<VerifyTotpEnrollmentResponse> {
    const client = await this.database.getPool().connect();
    let revokedDigests: string[] = [];
    let response: VerifyTotpEnrollmentResponse | undefined;
    let rejectionReason: string | undefined;
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      await this.lockTotpEnrollmentAccount(client, actor.accountId);
      const factor = await this.findTotpFactorForUpdate(client, actor.accountId, enrollmentId);
      if (!factor) {
        throw new ApiErrorException(
          'TOTP_ENROLLMENT_NOT_FOUND',
          'This authenticator setup is no longer available. Start setup again.',
          HttpStatus.NOT_FOUND,
        );
      }
      if (factor.enabled && factor.verified_at) {
        await client.query('COMMIT');
        transactionOpen = false;
        return {
          enrolled: true,
          enrolledAt: factor.verified_at.toISOString(),
          revokedOtherSessionCount: 0,
        };
      }
      if (!factor.expires_at || factor.expires_at.getTime() <= Date.now()) {
        await client.query('DELETE FROM identity.authentication_factors WHERE id = $1', [
          factor.id,
        ]);
        rejectionReason = 'enrollment_expired';
        throw new ApiErrorException(
          'TOTP_ENROLLMENT_EXPIRED',
          'This authenticator setup expired. Start setup again.',
          HttpStatus.CONFLICT,
        );
      }
      if (!this.verifyTotp(input.code, factor.encrypted_secret)) {
        rejectionReason = 'code_invalid';
        throw new ApiErrorException(
          'TOTP_CODE_INVALID',
          'The authenticator code is invalid or has expired.',
          HttpStatus.BAD_REQUEST,
          [{ field: 'code', message: 'Enter the current six-digit authenticator code' }],
        );
      }

      const verifiedAt = new Date();
      await client.query(
        `UPDATE identity.authentication_factors
         SET enabled = true, verified_at = $2, expires_at = NULL
         WHERE id = $1`,
        [factor.id, verifiedAt],
      );
      await client.query(
        `UPDATE identity.user_accounts
         SET two_factor_enrolled_at = COALESCE(two_factor_enrolled_at, $2), updated_at = $2
         WHERE id = $1`,
        [actor.accountId, verifiedAt],
      );
      const revoked = await client.query<{ redis_key_digest: string }>(
        `UPDATE identity.session_records
         SET revoked_at = now()
         WHERE account_id = $1
           AND id <> $2
           AND revoked_at IS NULL
         RETURNING redis_key_digest`,
        [actor.accountId, actor.sessionId],
      );
      revokedDigests = revoked.rows.map((row) => row.redis_key_digest);
      await this.audit.append(
        {
          action: 'auth.two_factor.enrolled',
          actorAccountId: actor.accountId,
          after: {
            factorType: 'totp',
            revokedOtherSessionCount: revokedDigests.length,
            verifiedAt: verifiedAt.toISOString(),
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
      response = {
        enrolled: true,
        enrolledAt: verifiedAt.toISOString(),
        revokedOtherSessionCount: revokedDigests.length,
      };
    } catch (error) {
      if (transactionOpen) await client.query('ROLLBACK');
      if (rejectionReason) await this.recordTotpRejection(actor, metadata, rejectionReason);
      throw error;
    } finally {
      client.release();
    }
    await this.removeRevokedSessionTokens(revokedDigests, actor.accountId);
    if (!response) throw new Error('TOTP enrollment verification response was not created');
    return response;
  }

  async disableTotp(
    input: DisableTotpRequest,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<DisableTotpResponse> {
    const client = await this.database.getPool().connect();
    let revokedDigests: string[] = [];
    let response: DisableTotpResponse | undefined;
    let rejectionReason: string | undefined;
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      const account = await this.lockTotpEnrollmentAccount(client, actor.accountId);
      if (!(await this.passwords.verify(input.currentPassword, account.password_hash))) {
        rejectionReason = 'current_credential_invalid';
        throw new ApiErrorException(
          'CURRENT_PASSWORD_INVALID',
          'The current password is incorrect',
          HttpStatus.BAD_REQUEST,
          [{ field: 'currentPassword', message: 'Enter your current password' }],
        );
      }
      const factors = await client.query<TotpFactorRow>(
        `SELECT id, encrypted_secret, enabled, expires_at, verified_at
         FROM identity.authentication_factors
         WHERE account_id = $1
           AND factor_type = 'totp'
           AND enabled = true
           AND verified_at IS NOT NULL
         ORDER BY verified_at
         FOR UPDATE`,
        [actor.accountId],
      );
      if (!factors.rowCount) {
        await client.query('COMMIT');
        transactionOpen = false;
        return { enrolled: false, revokedOtherSessionCount: 0 };
      }
      const factor = factors.rows.find((candidate) =>
        this.verifyTotp(input.code, candidate.encrypted_secret),
      );
      if (!factor) {
        rejectionReason = 'code_invalid';
        throw new ApiErrorException(
          'TOTP_CODE_INVALID',
          'The authenticator code is invalid or has expired.',
          HttpStatus.BAD_REQUEST,
          [{ field: 'code', message: 'Enter the current six-digit authenticator code' }],
        );
      }
      if (actor.isAdministrative && factors.rowCount === 1) {
        throw new ApiErrorException(
          'TOTP_REQUIRED_FOR_ADMINISTRATOR',
          'Administrative access must retain an enrolled authenticator.',
          HttpStatus.CONFLICT,
        );
      }

      await client.query('DELETE FROM identity.authentication_factors WHERE id = $1', [factor.id]);
      const remaining = factors.rows.filter((candidate) => candidate.id !== factor.id);
      if (!remaining.length) {
        await client.query(
          `UPDATE identity.user_accounts
           SET two_factor_enrolled_at = NULL, updated_at = now()
           WHERE id = $1`,
          [actor.accountId],
        );
      }
      const revoked = await client.query<{ redis_key_digest: string }>(
        `UPDATE identity.session_records
         SET revoked_at = now()
         WHERE account_id = $1
           AND id <> $2
           AND revoked_at IS NULL
         RETURNING redis_key_digest`,
        [actor.accountId, actor.sessionId],
      );
      revokedDigests = revoked.rows.map((row) => row.redis_key_digest);
      await this.audit.append(
        {
          action: 'auth.two_factor.disabled',
          actorAccountId: actor.accountId,
          after: { factorType: 'totp', revokedOtherSessionCount: revokedDigests.length },
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
      response = {
        enrolled: remaining.length > 0,
        ...(remaining[0]?.verified_at
          ? { enrolledAt: remaining[0].verified_at.toISOString() }
          : {}),
        revokedOtherSessionCount: revokedDigests.length,
      };
    } catch (error) {
      if (transactionOpen) await client.query('ROLLBACK');
      if (rejectionReason) await this.recordTotpRejection(actor, metadata, rejectionReason);
      throw error;
    } finally {
      client.release();
    }
    await this.removeRevokedSessionTokens(revokedDigests, actor.accountId);
    if (!response) throw new Error('TOTP disable response was not created');
    return response;
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
      await client.query(
        `DELETE FROM identity.authentication_factors
         WHERE account_id = $1
           AND factor_type = 'totp'
           AND enabled = false
           AND verified_at IS NULL`,
        [actor.accountId],
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

  private async lockTotpEnrollmentAccount(
    client: PoolClient,
    accountId: string,
  ): Promise<TotpEnrollmentAccountRow> {
    const result = await client.query<TotpEnrollmentAccountRow>(
      `SELECT account.password_hash, account.status, employee.email
       FROM identity.user_accounts account
       JOIN identity.employees employee ON employee.id = account.employee_id
       WHERE account.id = $1
         AND employee.active = true
       FOR UPDATE`,
      [accountId],
    );
    const account = result.rows[0];
    if (!account || account.status !== 'active') {
      throw new ApiErrorException(
        'AUTHENTICATION_REQUIRED',
        'Authentication is required',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return account;
  }

  private async findTotpFactorForUpdate(
    client: PoolClient,
    accountId: string,
    factorId: string,
  ): Promise<TotpFactorRow | undefined> {
    const result = await client.query<TotpFactorRow>(
      `SELECT id, encrypted_secret, enabled, expires_at, verified_at
       FROM identity.authentication_factors
       WHERE id = $1
         AND account_id = $2
         AND factor_type = 'totp'
       FOR UPDATE`,
      [factorId, accountId],
    );
    return result.rows[0];
  }

  private totpEnrollmentResponse(
    enrollmentId: string,
    email: string,
    secret: string,
    expiresAt: Date,
  ): StartTotpEnrollmentResponse {
    return {
      enrollmentId,
      expiresAt: expiresAt.toISOString(),
      manualEntryKey: secret,
      provisioningUri: this.totp.createEnrollmentUri(email, secret),
    };
  }

  private async recordTotpRejection(
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    reason: string,
  ): Promise<void> {
    await this.audit.append({
      action: 'auth.two_factor.enrollment_rejected',
      actorAccountId: actor.accountId,
      correlationId: metadata.correlationId,
      metadata: { reason },
      targetId: actor.accountId,
      targetType: 'user_account',
      ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
      ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
    });
  }

  private async removeRevokedSessionTokens(digests: string[], accountId: string): Promise<void> {
    if (!digests.length) return;
    try {
      await this.sessions.removeRevokedSessionTokens(digests);
    } catch (error) {
      this.logger.event('warn', 'auth.two_factor.revoked_token_cleanup_failed', {
        accountId,
        count: digests.length,
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      });
    }
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
