import { createHash, randomBytes } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  AccountRecoveryHandoff,
  CompleteAccountRecoveryRequest,
  CompleteAccountRecoveryResponse,
  IssueAccountRecoveryHandoffRequest,
  StartAccountRecoveryTotpRequest,
  StartAccountRecoveryTotpResponse,
  VerifyAccountRecoveryTotpRequest,
  VerifyAccountRecoveryTotpResponse,
} from '@vista/contracts';
import type { PoolClient } from 'pg';

import { AuditService } from '../audit/audit.service.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';
import type { AuthenticationContext, RequestSecurityMetadata } from './authentication.types.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import { TotpService } from './totp.service.js';

interface RecoveryTargetRow {
  active: boolean;
  email: string;
  id: string;
  password_hash: string;
  status: 'active' | 'disabled' | 'locked';
  version: number;
}

interface RecoveryHandoffRow extends RecoveryTargetRow {
  code_digest: string;
  consumed_at: Date | null;
  encrypted_code: Buffer;
  expires_at: Date;
  handoff_id: string;
  recovery_started_at: Date | null;
  revoked_at: Date | null;
}

interface TotpFactorRow {
  encrypted_secret: Buffer;
  expires_at: Date | null;
  id: string;
}

@Injectable()
export class AccountRecoveryService {
  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(TotpService) private readonly totp: TotpService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async issueHandoff(
    accountId: string,
    input: IssueAccountRecoveryHandoffRequest,
    idempotencyKey: string | undefined,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<AccountRecoveryHandoff> {
    requireRecoveryAuthority(actor);
    if (!idempotencyKey?.trim()) {
      throw new ApiErrorException(
        'IDEMPOTENCY_KEY_REQUIRED',
        'An idempotency key is required for account recovery',
        HttpStatus.BAD_REQUEST,
      );
    }
    const reason = normalizeReason(input.reason);
    const client = await this.database.getPool().connect();
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      // Serialize the initial lookup too: a missing row cannot be locked FOR UPDATE.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `account-recovery:${actor.accountId}:${idempotencyKey.trim()}`,
      ]);
      const replay = await client.query<{
        account_id: string;
        consumed_at: Date | null;
        email: string;
        encrypted_code: Buffer;
        expires_at: Date;
        reason: string;
        revoked_at: Date | null;
      }>(
        `SELECT handoff.account_id, employee.email, handoff.encrypted_code, handoff.expires_at,
                handoff.reason, handoff.consumed_at, handoff.revoked_at
         FROM identity.account_recovery_handoffs handoff
         JOIN identity.user_accounts account ON account.id = handoff.account_id
         JOIN identity.employees employee ON employee.id = account.employee_id
         WHERE handoff.issued_by_account_id = $1 AND handoff.idempotency_key = $2
         FOR UPDATE`,
        [actor.accountId, idempotencyKey.trim()],
      );
      if (replay.rows[0]) {
        const handoff = replay.rows[0];
        if (handoff.account_id !== accountId || handoff.reason !== reason) {
          throw new ApiErrorException(
            'IDEMPOTENCY_KEY_REUSED',
            'This idempotency key belongs to a different recovery request',
            HttpStatus.CONFLICT,
          );
        }
        if (
          handoff.consumed_at ||
          handoff.revoked_at ||
          handoff.expires_at.getTime() <= Date.now()
        ) {
          throw recoveryCodeUnavailable();
        }
        await client.query('COMMIT');
        transactionOpen = false;
        return {
          email: handoff.email,
          expiresAt: handoff.expires_at.toISOString(),
          recoveryCode: this.totp.decryptValue(handoff.encrypted_code),
        };
      }

      const target = await lockRecoveryTarget(client, accountId);
      if (target.version !== input.expectedVersion) {
        throw new ApiErrorException(
          'VERSION_CONFLICT',
          'This employee record was changed. Refresh and try again.',
          HttpStatus.CONFLICT,
        );
      }
      if (!target.active || target.status === 'disabled') {
        throw new ApiErrorException(
          'ACCOUNT_RECOVERY_UNAVAILABLE',
          'A disabled employee account cannot receive a recovery handoff.',
          HttpStatus.CONFLICT,
        );
      }

      await client.query(
        `UPDATE identity.account_recovery_handoffs
         SET revoked_at = now()
         WHERE account_id = $1
           AND consumed_at IS NULL
           AND revoked_at IS NULL
           AND expires_at > now()`,
        [accountId],
      );
      const recoveryCode = randomBytes(32).toString('base64url');
      const expiresAt = new Date(
        Date.now() + this.environment.ACCOUNT_RECOVERY_TTL_SECONDS * 1_000,
      );
      await client.query(
        `INSERT INTO identity.account_recovery_handoffs (
           account_id, issued_by_account_id, code_digest, encrypted_code,
           idempotency_key, reason, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          accountId,
          actor.accountId,
          digest(recoveryCode),
          this.totp.encryptValue(recoveryCode),
          idempotencyKey.trim(),
          reason,
          expiresAt,
        ],
      );
      await this.audit.append(
        {
          action: 'auth.recovery.handoff_issued',
          actorAccountId: actor.accountId,
          after: { expiresAt: expiresAt.toISOString() },
          correlationId: metadata.correlationId,
          metadata: { reason },
          targetId: accountId,
          targetType: 'user_account',
          ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
          ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
        },
        client,
      );
      await client.query('COMMIT');
      transactionOpen = false;
      return { email: target.email, expiresAt: expiresAt.toISOString(), recoveryCode };
    } catch (error) {
      if (transactionOpen) await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async completeRecovery(
    input: CompleteAccountRecoveryRequest,
    metadata: RequestSecurityMetadata,
  ): Promise<CompleteAccountRecoveryResponse> {
    const client = await this.database.getPool().connect();
    let revokedDigests: string[] = [];
    let response: CompleteAccountRecoveryResponse | undefined;
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      const handoff = await lockRecoveryHandoff(client, input.email, input.recoveryCode);
      requireUsableHandoff(handoff);
      const isAdministrative = await accountIsAdministrative(client, handoff.id);
      if (handoff.recovery_started_at && isAdministrative) {
        await client.query('COMMIT');
        transactionOpen = false;
        return { expiresAt: handoff.expires_at.toISOString(), requiresTotpEnrollment: true };
      }
      await ensurePasswordHasNotBeenUsed(client, handoff, input.newPassword, this.passwords);
      const changedAt = new Date();
      const expiresAt = this.passwords.passwordExpiresAt(changedAt);
      const passwordHash = await this.passwords.hash(input.newPassword, 'newPassword');
      await client.query(
        `INSERT INTO identity.password_history (account_id, password_hash, replaced_at, replaced_by)
         VALUES ($1, $2, $3, $1)`,
        [handoff.id, handoff.password_hash, changedAt],
      );
      await client.query(
        `DELETE FROM identity.password_history
         WHERE id IN (
           SELECT id FROM identity.password_history
           WHERE account_id = $1
           ORDER BY replaced_at DESC, id DESC
           OFFSET $2
         )`,
        [handoff.id, this.environment.PASSWORD_HISTORY_COUNT],
      );
      await client.query(
        `UPDATE identity.user_accounts
         SET password_hash = $2, password_changed_at = $3, password_expires_at = $4,
             failed_login_count = 0, locked_until = NULL, two_factor_enrolled_at = NULL,
             version = version + 1, updated_at = $3
         WHERE id = $1`,
        [handoff.id, passwordHash, changedAt, expiresAt ?? null],
      );
      await client.query('DELETE FROM identity.authentication_factors WHERE account_id = $1', [
        handoff.id,
      ]);
      const revoked = await client.query<{ redis_key_digest: string }>(
        `UPDATE identity.session_records
         SET revoked_at = now()
         WHERE account_id = $1 AND revoked_at IS NULL
         RETURNING redis_key_digest`,
        [handoff.id],
      );
      revokedDigests = revoked.rows.map((row) => row.redis_key_digest);
      await client.query(
        `UPDATE identity.account_recovery_handoffs
         SET ${isAdministrative ? 'recovery_started_at' : 'consumed_at'} = now()
         WHERE id = $1`,
        [handoff.handoff_id],
      );
      await this.audit.append(
        {
          action: 'auth.recovery.completed',
          after: {
            requiresTotpEnrollment: isAdministrative,
            revokedSessionCount: revokedDigests.length,
          },
          correlationId: metadata.correlationId,
          targetId: handoff.id,
          targetType: 'user_account',
          ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
          ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
        },
        client,
      );
      await client.query('COMMIT');
      transactionOpen = false;
      response = {
        ...(isAdministrative ? { expiresAt: handoff.expires_at.toISOString() } : {}),
        requiresTotpEnrollment: isAdministrative,
      };
    } catch (error) {
      if (transactionOpen) await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await this.clearRevokedSessions(revokedDigests);
    if (!response) throw new Error('Account recovery did not produce a response');
    return response;
  }

  async startTotpEnrollment(
    input: StartAccountRecoveryTotpRequest,
    metadata: RequestSecurityMetadata,
  ): Promise<StartAccountRecoveryTotpResponse> {
    const client = await this.database.getPool().connect();
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      const handoff = await lockRecoveryHandoff(client, input.email, input.recoveryCode);
      requireUsableHandoff(handoff);
      if (!handoff.recovery_started_at || !(await accountIsAdministrative(client, handoff.id))) {
        throw recoveryCodeUnavailable();
      }
      const pending = await client.query<TotpFactorRow>(
        `SELECT id, encrypted_secret, expires_at
         FROM identity.authentication_factors
         WHERE account_id = $1
           AND factor_type = 'totp'
           AND enabled = false
           AND verified_at IS NULL
           AND expires_at > now()
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [handoff.id],
      );
      const existing = pending.rows[0];
      if (existing?.expires_at) {
        const secret = this.totp.decryptSecret(existing.encrypted_secret);
        await client.query('COMMIT');
        transactionOpen = false;
        return enrollmentResponse(
          existing.id,
          handoff.email,
          secret,
          existing.expires_at,
          this.totp,
        );
      }

      await client.query(
        `DELETE FROM identity.authentication_factors
         WHERE account_id = $1 AND factor_type = 'totp' AND enabled = false`,
        [handoff.id],
      );
      const secret = this.totp.generateSecret();
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO identity.authentication_factors (
           account_id, factor_type, encrypted_secret, enabled, expires_at
         ) VALUES ($1, 'totp', $2, false, $3)
         RETURNING id`,
        [handoff.id, this.totp.encryptSecret(secret), handoff.expires_at],
      );
      const enrollmentId = inserted.rows[0]?.id;
      if (!enrollmentId) throw new Error('Recovery authenticator enrollment was not created');
      await this.audit.append(
        {
          action: 'auth.recovery.factor_enrollment_started',
          after: { expiresAt: handoff.expires_at.toISOString(), factorType: 'totp' },
          correlationId: metadata.correlationId,
          targetId: handoff.id,
          targetType: 'user_account',
          ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
          ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
        },
        client,
      );
      await client.query('COMMIT');
      transactionOpen = false;
      return enrollmentResponse(enrollmentId, handoff.email, secret, handoff.expires_at, this.totp);
    } catch (error) {
      if (transactionOpen) await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async verifyTotpEnrollment(
    enrollmentId: string,
    input: VerifyAccountRecoveryTotpRequest,
    metadata: RequestSecurityMetadata,
  ): Promise<VerifyAccountRecoveryTotpResponse> {
    const client = await this.database.getPool().connect();
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      const handoff = await lockRecoveryHandoff(client, input.email, input.recoveryCode);
      requireUsableHandoff(handoff);
      if (!handoff.recovery_started_at || !(await accountIsAdministrative(client, handoff.id))) {
        throw recoveryCodeUnavailable();
      }
      const factor = await client.query<TotpFactorRow>(
        `SELECT id, encrypted_secret, expires_at
         FROM identity.authentication_factors
         WHERE id = $1
           AND account_id = $2
           AND factor_type = 'totp'
           AND enabled = false
           AND verified_at IS NULL
         FOR UPDATE`,
        [enrollmentId, handoff.id],
      );
      const pending = factor.rows[0];
      if (!pending || !pending.expires_at || pending.expires_at.getTime() <= Date.now()) {
        throw new ApiErrorException(
          'RECOVERY_TOTP_ENROLLMENT_EXPIRED',
          'Authenticator setup has expired. Start the recovery setup again.',
          HttpStatus.CONFLICT,
        );
      }
      if (!verifyTotp(this.totp, input.code, pending.encrypted_secret)) {
        await this.audit.append(
          {
            action: 'auth.recovery.factor_enrollment_rejected',
            correlationId: metadata.correlationId,
            metadata: { reason: 'code_invalid' },
            targetId: handoff.id,
            targetType: 'user_account',
            ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
            ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
          },
          client,
        );
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
        [pending.id, verifiedAt],
      );
      await client.query(
        `UPDATE identity.user_accounts
         SET two_factor_enrolled_at = $2, updated_at = $2
         WHERE id = $1`,
        [handoff.id, verifiedAt],
      );
      await client.query(
        `UPDATE identity.account_recovery_handoffs SET consumed_at = $2 WHERE id = $1`,
        [handoff.handoff_id, verifiedAt],
      );
      await this.audit.append(
        {
          action: 'auth.recovery.factor_enrolled',
          after: { factorType: 'totp' },
          correlationId: metadata.correlationId,
          targetId: handoff.id,
          targetType: 'user_account',
          ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
          ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
        },
        client,
      );
      await client.query('COMMIT');
      transactionOpen = false;
      return { enrolled: true, enrolledAt: verifiedAt.toISOString() };
    } catch (error) {
      if (transactionOpen) await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async clearRevokedSessions(digests: string[]): Promise<void> {
    try {
      await this.sessions.removeRevokedSessionTokens(digests);
    } catch {
      // The durable session-record revocation remains authoritative if Redis cleanup is delayed.
    }
  }
}

async function lockRecoveryTarget(
  client: PoolClient,
  accountId: string,
): Promise<RecoveryTargetRow> {
  const result = await client.query<RecoveryTargetRow>(
    `SELECT account.id, account.password_hash, account.status, account.version,
            employee.active, employee.email
     FROM identity.user_accounts account
     JOIN identity.employees employee ON employee.id = account.employee_id
     WHERE account.id = $1
     FOR UPDATE`,
    [accountId],
  );
  const target = result.rows[0];
  if (!target) {
    throw new ApiErrorException(
      'SECURITY_ACCOUNT_NOT_FOUND',
      'The employee account no longer exists',
      HttpStatus.NOT_FOUND,
    );
  }
  return target;
}

async function lockRecoveryHandoff(
  client: PoolClient,
  email: string,
  recoveryCode: string,
): Promise<RecoveryHandoffRow> {
  const result = await client.query<RecoveryHandoffRow>(
    `SELECT handoff.id AS handoff_id, handoff.code_digest, handoff.encrypted_code,
            handoff.expires_at, handoff.recovery_started_at, handoff.consumed_at, handoff.revoked_at,
            account.id, account.password_hash, account.status, account.version,
            employee.active, employee.email
     FROM identity.account_recovery_handoffs handoff
     JOIN identity.user_accounts account ON account.id = handoff.account_id
     JOIN identity.employees employee ON employee.id = account.employee_id
     WHERE handoff.code_digest = $1 AND employee.email = $2
     FOR UPDATE`,
    [digest(recoveryCode), email.trim().toLowerCase()],
  );
  const handoff = result.rows[0];
  if (!handoff) throw recoveryCodeUnavailable();
  return handoff;
}

function requireUsableHandoff(handoff: RecoveryHandoffRow): void {
  if (
    handoff.revoked_at ||
    handoff.consumed_at ||
    handoff.expires_at.getTime() <= Date.now() ||
    !handoff.active ||
    handoff.status === 'disabled'
  ) {
    throw recoveryCodeUnavailable();
  }
}

async function accountIsAdministrative(client: PoolClient, accountId: string): Promise<boolean> {
  const result = await client.query<{ administrative: boolean }>(
    `SELECT COALESCE(bool_or(role.is_administrative), false) AS administrative
     FROM iam.account_roles assignment
     JOIN iam.roles role ON role.id = assignment.role_id
     WHERE assignment.account_id = $1`,
    [accountId],
  );
  return result.rows[0]?.administrative ?? false;
}

async function ensurePasswordHasNotBeenUsed(
  client: PoolClient,
  account: RecoveryTargetRow,
  newPassword: string,
  passwords: PasswordService,
): Promise<void> {
  const history = await client.query<{ password_hash: string }>(
    `SELECT password_hash
     FROM identity.password_history
     WHERE account_id = $1
     ORDER BY replaced_at DESC, id DESC
     LIMIT $2`,
    [account.id, passwords.policySummary().historyCount],
  );
  for (const passwordHash of [
    account.password_hash,
    ...history.rows.map((row) => row.password_hash),
  ]) {
    if (await passwords.verify(newPassword, passwordHash)) {
      throw new ApiErrorException(
        'PASSWORD_REUSE_NOT_ALLOWED',
        'A recently used password cannot be used again',
        HttpStatus.BAD_REQUEST,
        [{ field: 'newPassword', message: 'Choose a password you have not used recently' }],
      );
    }
  }
}

function enrollmentResponse(
  enrollmentId: string,
  email: string,
  secret: string,
  expiresAt: Date,
  totp: TotpService,
): StartAccountRecoveryTotpResponse {
  return {
    enrollmentId,
    expiresAt: expiresAt.toISOString(),
    manualEntryKey: secret,
    provisioningUri: totp.createEnrollmentUri(email, secret),
  };
}

function requireRecoveryAuthority(actor: AuthenticationContext): void {
  if (actor.isAdministrative && actor.twoFactorVerified) return;
  throw new ApiErrorException(
    'RECOVERY_AUTHORITY_REQUIRED',
    'Account recovery requires a two-factor-verified administrator.',
    HttpStatus.FORBIDDEN,
  );
}

function recoveryCodeUnavailable(): ApiErrorException {
  return new ApiErrorException(
    'RECOVERY_CODE_INVALID',
    'The recovery code is invalid, expired, or no longer available.',
    HttpStatus.BAD_REQUEST,
  );
}

function normalizeReason(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (normalized.length < 3 || normalized.length > 1_000) {
    throw new ApiErrorException(
      'RECOVERY_REASON_INVALID',
      'Provide a short recovery authorization note.',
      HttpStatus.BAD_REQUEST,
      [{ field: 'reason', message: 'Enter at least three characters' }],
    );
  }
  return normalized;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function verifyTotp(totp: TotpService, code: string, encryptedSecret: Buffer): boolean {
  try {
    return totp.verify(code, encryptedSecret);
  } catch {
    return false;
  }
}
