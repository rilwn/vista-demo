import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AppEnvironment } from '@vista/config';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { AuditService } from '../src/audit/audit.service.js';
import { AuthController } from '../src/auth/auth.controller.js';
import { AuthService } from '../src/auth/auth.service.js';
import { LoginRateLimitGuard } from '../src/auth/login-rate-limit.guard.js';
import { PasswordService } from '../src/auth/password.service.js';
import { TotpService } from '../src/auth/totp.service.js';
import { ApiErrorException } from '../src/common/api-error.exception.js';
import { configureHttpApplication } from '../src/common/http-application.js';
import { APP_ENVIRONMENT } from '../src/config/config.module.js';
import { migrateUp } from '../src/database/migration-runner.js';

const runInfrastructureTests = process.env['RUN_INFRASTRUCTURE_TESTS'] === 'true';
const password = 'Vista-Test-Password-7!';

describe.skipIf(!runInfrastructureTests)(
  'authentication, authorization, and audit guarantees',
  () => {
    let adminAccountId: string;
    let adminDatabase: Pool;
    let adminToken: string;
    let application: INestApplication;
    let auditService: AuditService;
    let authenticationService: AuthService;
    let authController: AuthController;
    let database: Pool;
    let databaseName: string;
    let deniedEmail: string;
    let deniedToken: string;
    let employeeEmail: string;
    let employeeToken: string;
    let expiredEmail: string;
    let lockoutAccountId: string;
    let lockoutEmail: string;
    let loginRateLimit: LoginRateLimitGuard;
    let administratorEmail: string;
    let totp: TotpService;
    let totpSecret: string;

    beforeAll(async () => {
      const sourceDatabaseUrl = process.env['DATABASE_URL'];
      const sourceRedisUrl = process.env['REDIS_URL'];
      if (!sourceDatabaseUrl || !sourceRedisUrl) {
        throw new Error(
          'DATABASE_URL and REDIS_URL are required for authentication integration tests',
        );
      }

      adminDatabase = new Pool({ connectionString: sourceDatabaseUrl, max: 1 });
      databaseName = `vista_auth_test_${randomUUID().replaceAll('-', '')}`;
      assertTemporaryDatabaseName(databaseName);
      await adminDatabase.query(`CREATE DATABASE ${databaseName}`);
      const isolatedDatabaseUrl = new URL(sourceDatabaseUrl);
      isolatedDatabaseUrl.pathname = `/${databaseName}`;
      const isolatedRedisUrl = new URL(sourceRedisUrl);
      isolatedRedisUrl.pathname = '/14';

      database = new Pool({ connectionString: isolatedDatabaseUrl.toString(), max: 2 });
      await migrateUp(
        database,
        fileURLToPath(new URL('../src/database/migrations', import.meta.url)),
      );
      Object.assign(process.env, {
        AUTH_LOGIN_RATE_LIMIT_MAX: '5',
        BUSINESS_TIMEZONE: 'Europe/Sofia',
        CORS_ORIGINS: 'http://localhost:5173',
        DATABASE_URL: isolatedDatabaseUrl.toString(),
        NODE_ENV: 'test',
        REDIS_URL: isolatedRedisUrl.toString(),
        REQUEST_LOGGING_ENABLED: 'false',
        S3_ACCESS_KEY_ID: 'test',
        S3_BUCKET: 'vista-test',
        S3_ENDPOINT: 'http://localhost:9000',
        S3_REGION: 'us-east-1',
        S3_SECRET_ACCESS_KEY: 'test-secret',
        SESSION_SECRET: 'a-test-session-secret-at-least-32-characters',
        SMTP_FROM: 'test@example.invalid',
        SMTP_HOST: 'localhost',
        SMTP_PORT: '1025',
        TOTP_ENCRYPTION_KEY: 'a-test-totp-key-with-at-least-32-characters',
      });

      const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
      application = module.createNestApplication();
      configureHttpApplication(application, application.get<AppEnvironment>(APP_ENVIRONMENT));
      await application.init();

      const passwords = application.get(PasswordService);
      auditService = application.get(AuditService);
      authenticationService = application.get(AuthService);
      authController = application.get(AuthController);
      loginRateLimit = application.get(LoginRateLimitGuard);
      totp = application.get(TotpService);
      const passwordHash = await passwords.hash(password);
      const runId = randomUUID().replaceAll('-', '');
      employeeEmail = `employee-${runId}@example.invalid`;
      deniedEmail = `denied-${runId}@example.invalid`;
      administratorEmail = `administrator-${runId}@example.invalid`;
      expiredEmail = `expired-${runId}@example.invalid`;
      lockoutEmail = `lockout-${runId}@example.invalid`;
      const employeeId = await createAccount(database, 'employee', employeeEmail, passwordHash);
      const deniedId = await createAccount(database, 'denied', deniedEmail, passwordHash);
      adminAccountId = await createAccount(
        database,
        'administrator',
        administratorEmail,
        passwordHash,
      );
      await createAccount(database, 'expired', expiredEmail, passwordHash);
      lockoutAccountId = await createAccount(database, 'lockout', lockoutEmail, passwordHash);
      await database.query(
        `UPDATE identity.user_accounts
         SET password_expires_at = now() - interval '1 day'
         WHERE employee_id = (
           SELECT id FROM identity.employees WHERE email = $1
         )`,
        [expiredEmail],
      );
      await grantPlatformView(database, employeeId);
      await grantAdministrativeRole(database, adminAccountId);

      expect(deniedId).not.toBe(employeeId);
    }, 30_000);

    afterAll(async () => {
      if (application) {
        for (const token of [adminToken, deniedToken]) {
          if (token) {
            await request(application.getHttpServer())
              .post('/api/v1/auth/logout')
              .set('authorization', `Bearer ${token}`);
          }
        }
        await application.close();
      }
      if (database) {
        await database.end();
      }
      if (adminDatabase && databaseName) {
        assertTemporaryDatabaseName(databaseName);
        await adminDatabase.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
        await adminDatabase.end();
      }
    });

    it('appends an audit event through the serialized hash-chain writer', async () => {
      const event = await auditService.append({
        action: 'test.authentication.started',
        correlationId: randomUUID(),
        targetType: 'authentication_test',
      });

      expect(event.eventHash).toMatch(/^[a-f0-9]{64}$/u);
    });

    it('rejects invalid credentials at the authentication service boundary', async () => {
      try {
        await authenticationService.login(
          { email: employeeEmail, password: 'Incorrect-Password-7!' },
          { correlationId: randomUUID() },
        );
        expect.fail('Expected invalid credentials to be rejected');
      } catch (error) {
        if (!(error instanceof ApiErrorException)) {
          throw error;
        }
        expect(error.getStatus()).toBe(401);
      }
    });

    it('increments the distributed sensitive-login limiter', async () => {
      const headers = new Map<string, number | string>();
      const email = `guard-${randomUUID()}@example.invalid`;
      const executionContext = {
        switchToHttp: () => ({
          getRequest: () => ({ body: { email }, ip: '127.0.0.1' }),
          getResponse: () => ({
            setHeader: (name: string, value: number | string) => headers.set(name, value),
          }),
        }),
      } as unknown as ExecutionContext;

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(loginRateLimit.canActivate(executionContext)).resolves.toBe(true);
      }
      await expect(loginRateLimit.canActivate(executionContext)).rejects.toMatchObject({
        status: 429,
      });
      expect(headers.get('x-ratelimit-limit')).toBe(5);
    });

    it('receives validated login input at the controller boundary', async () => {
      const fakeRequest = {
        correlationId: randomUUID(),
        header: () => undefined,
        ip: '127.0.0.1',
      } as unknown as Parameters<AuthController['login']>[1];
      await expect(
        authController.login(
          { email: employeeEmail, password: 'Incorrect-Password-7!' },
          fakeRequest,
        ),
      ).rejects.toBeInstanceOf(ApiErrorException);
    });

    it('rejects an incorrect password with a stable code and an audit event', async () => {
      const response = await request(application.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: employeeEmail, password: 'Incorrect-Password-7!' })
        .expect(401);

      expect(response.body).toMatchObject({ error: { code: 'AUTHENTICATION_FAILED' } });
      const audit = await database.query<{ count: string }>(
        `SELECT count(*)::text AS count
       FROM audit.events
       WHERE action = 'auth.login.failed' AND target_type = 'user_account'`,
      );
      expect(audit.rows[0]?.count).toBe('3');
    });

    it('enforces the configured failed-login lockout', async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(
          authenticationService.login(
            { email: lockoutEmail, password: 'Incorrect-Password-7!' },
            { correlationId: randomUUID() },
          ),
        ).rejects.toBeInstanceOf(ApiErrorException);
      }

      const state = await database.query<{ failed_login_count: number; locked: boolean }>(
        `SELECT failed_login_count, locked_until > now() AS locked
       FROM identity.user_accounts
       WHERE id = $1`,
        [lockoutAccountId],
      );
      expect(state.rows[0]).toEqual({ failed_login_count: 5, locked: true });
      try {
        await authenticationService.login(
          { email: lockoutEmail, password },
          { correlationId: randomUUID() },
        );
        expect.fail('Expected the locked account to remain unavailable');
      } catch (error) {
        expect(apiErrorCode(error)).toBe('ACCOUNT_TEMPORARILY_LOCKED');
      }
    });

    it('blocks login when the configured password expiration has passed', async () => {
      const response = await request(application.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: expiredEmail, password })
        .expect(403);

      expect(response.body).toMatchObject({ error: { code: 'PASSWORD_EXPIRED' } });
    });

    it('creates a Redis-backed session for valid credentials', async () => {
      const response = await request(application.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: employeeEmail, password })
        .expect(200);

      employeeToken = response.body.sessionToken as string;
      expect(employeeToken).toMatch(/^[a-zA-Z0-9_-]{43}$/u);
      const profile = await request(application.getHttpServer())
        .get('/api/v1/auth/me')
        .set('authorization', `Bearer ${employeeToken}`)
        .expect(200);
      expect(profile.body).toMatchObject({
        email: employeeEmail,
        isAdministrative: false,
        twoFactorVerified: false,
      });
    });

    it('enforces permissions in the backend', async () => {
      await request(application.getHttpServer())
        .get('/api/v1/auth/me/permissions')
        .set('authorization', `Bearer ${employeeToken}`)
        .expect(200);

      const login = await request(application.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: deniedEmail, password })
        .expect(200);
      deniedToken = login.body.sessionToken as string;
      const denied = await request(application.getHttpServer())
        .get('/api/v1/auth/me/permissions')
        .set('authorization', `Bearer ${deniedToken}`)
        .expect(403);
      expect(denied.body).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
    });

    it('revokes the current session', async () => {
      await request(application.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('authorization', `Bearer ${employeeToken}`)
        .expect(204);
      await request(application.getHttpServer())
        .get('/api/v1/auth/me')
        .set('authorization', `Bearer ${employeeToken}`)
        .expect(401);
    });

    it('requires an enrolled and verified second factor for administrators', async () => {
      const unenrolled = await request(application.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: administratorEmail, password })
        .expect(403);
      expect(unenrolled.body).toMatchObject({
        error: { code: 'TWO_FACTOR_ENROLLMENT_REQUIRED' },
      });

      totpSecret = totp.generateSecret();
      await database.query(
        `INSERT INTO identity.authentication_factors (
         account_id, factor_type, encrypted_secret, enabled, verified_at
       ) VALUES ($1, 'totp', $2, true, now())`,
        [adminAccountId, totp.encryptSecret(totpSecret)],
      );
      const challenged = await request(application.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: administratorEmail, password })
        .expect(401);
      expect(challenged.body).toMatchObject({ error: { code: 'TWO_FACTOR_REQUIRED' } });

      const authenticated = await request(application.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: administratorEmail,
          password,
          totpCode: totp.generateCode(totpSecret),
        })
        .expect(200);
      adminToken = authenticated.body.sessionToken as string;
      expect(authenticated.body.account).toMatchObject({ isAdministrative: true });
      const profile = await request(application.getHttpServer())
        .get('/api/v1/auth/me')
        .set('authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(profile.body).toMatchObject({ isAdministrative: true, twoFactorVerified: true });
    });

    it('administers employee access, roles, sessions, and audit integrity through protected APIs', async () => {
      await request(application.getHttpServer())
        .get('/api/v1/platform/security/accounts')
        .set('authorization', `Bearer ${deniedToken}`)
        .expect(403);

      const runId = randomUUID().replaceAll('-', '');
      const created = await request(application.getHttpServer())
        .post('/api/v1/platform/security/accounts')
        .set('authorization', `Bearer ${adminToken}`)
        .set('idempotency-key', `security-account-${runId}`)
        .send({
          displayName: '  Security   Test Employee ',
          email: `security-${runId}@example.invalid`,
          employeeNumber: `sec-${runId.slice(0, 12)}`,
          initialPassword: password,
        })
        .expect(201);
      expect(created.body).toMatchObject({
        activeSessionCount: 0,
        displayName: 'Security Test Employee',
        employeeNumber: `SEC-${runId.slice(0, 12).toUpperCase()}`,
        roles: [],
        status: 'active',
        version: 1,
      });
      expect(JSON.stringify(created.body)).not.toContain(password);
      const accountId = created.body.accountId as string;

      const replay = await request(application.getHttpServer())
        .post('/api/v1/platform/security/accounts')
        .set('authorization', `Bearer ${adminToken}`)
        .set('idempotency-key', `security-account-${runId}`)
        .send({
          displayName: '  Security   Test Employee ',
          email: `security-${runId}@example.invalid`,
          employeeNumber: `sec-${runId.slice(0, 12)}`,
          initialPassword: password,
        })
        .expect(201);
      expect(replay.body).toEqual(created.body);

      const role = await request(application.getHttpServer())
        .post('/api/v1/platform/security/roles')
        .set('authorization', `Bearer ${adminToken}`)
        .set('idempotency-key', `security-role-${runId}`)
        .send({
          code: `crm-agent-${runId.slice(0, 10)}`,
          description: 'CRM access used by the security administration integration test.',
          isAdministrative: false,
          name: 'CRM agent',
          permissions: [
            { action: 'view', module: 'crm' },
            { action: 'create', module: 'crm' },
          ],
        })
        .expect(201);
      const roleId = role.body.id as string;

      const assigned = await request(application.getHttpServer())
        .put(`/api/v1/platform/security/accounts/${accountId}/roles`)
        .set('authorization', `Bearer ${adminToken}`)
        .set('idempotency-key', `security-assign-${runId}`)
        .send({ expectedVersion: 1, roleIds: [roleId] })
        .expect(200);
      expect(assigned.body).toMatchObject({
        roles: [{ code: `crm-agent-${runId.slice(0, 10)}`, id: roleId }],
        version: 2,
      });

      const login = await request(application.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: `security-${runId}@example.invalid`, password })
        .expect(200);
      const employeeSessionToken = login.body.sessionToken as string;
      const employeeSessionId = (
        await request(application.getHttpServer())
          .get('/api/v1/auth/me')
          .set('authorization', `Bearer ${employeeSessionToken}`)
          .expect(200)
      ).body.sessionId as string;

      const sessions = await request(application.getHttpServer())
        .get('/api/v1/platform/security/sessions')
        .set('authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(sessions.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: employeeSessionId, twoFactorVerified: false }),
          expect.objectContaining({ twoFactorVerified: true }),
        ]),
      );

      await request(application.getHttpServer())
        .post(`/api/v1/platform/security/sessions/${employeeSessionId}/revoke`)
        .set('authorization', `Bearer ${adminToken}`)
        .expect(204);
      await request(application.getHttpServer())
        .get('/api/v1/auth/me')
        .set('authorization', `Bearer ${employeeSessionToken}`)
        .expect(401);

      const disabled = await request(application.getHttpServer())
        .post(`/api/v1/platform/security/accounts/${accountId}/disable`)
        .set('authorization', `Bearer ${adminToken}`)
        .set('idempotency-key', `security-disable-${runId}`)
        .send({ expectedVersion: 2 })
        .expect(200);
      expect(disabled.body).toMatchObject({ status: 'disabled', version: 3 });
      await request(application.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: `security-${runId}@example.invalid`, password })
        .expect(401);

      const selfDisable = await request(application.getHttpServer())
        .post(`/api/v1/platform/security/accounts/${adminAccountId}/disable`)
        .set('authorization', `Bearer ${adminToken}`)
        .set('idempotency-key', `security-self-disable-${runId}`)
        .send({ expectedVersion: 1 })
        .expect(409);
      expect(selfDisable.body).toMatchObject({
        error: { code: 'SELF_ACCOUNT_DISABLE_FORBIDDEN' },
      });

      const integrity = await request(application.getHttpServer())
        .get('/api/v1/platform/security/audit-integrity')
        .set('authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(integrity.body).toMatchObject({ valid: true });
      expect(integrity.body.checkedEvents).toBeGreaterThan(0);

      const audit = await request(application.getHttpServer())
        .get('/api/v1/platform/security/audit-events')
        .query({ action: 'identity.account' })
        .set('authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(audit.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action: 'identity.account.created', targetId: accountId }),
          expect.objectContaining({ action: 'identity.account.disabled', targetId: accountId }),
        ]),
      );
      expect(JSON.stringify(audit.body)).not.toContain(password);
    });

    it('maintains a linked append-only audit chain for login and revocation events', async () => {
      const events = await database.query<{
        event_hash: string;
        previous_event_hash: string | null;
      }>(
        `SELECT previous_event_hash, event_hash
       FROM audit.events
       ORDER BY occurred_at, id`,
      );

      expect(events.rows.length).toBeGreaterThanOrEqual(9);
      for (const [index, event] of events.rows.entries()) {
        expect(event.event_hash).toMatch(/^[a-f0-9]{64}$/u);
        expect(event.previous_event_hash).toBe(
          index === 0 ? null : events.rows[index - 1]?.event_hash,
        );
      }
    });
  },
);

async function createAccount(
  pool: Pool,
  label: string,
  email: string,
  passwordHash: string,
): Promise<string> {
  const employeeId = randomUUID();
  const accountId = randomUUID();
  await pool.query(
    `INSERT INTO identity.employees (id, employee_number, display_name, email)
     VALUES ($1, $2, $3, $4)`,
    [employeeId, `${label}-${randomUUID()}`, `Test ${label}`, email],
  );
  await pool.query(
    `INSERT INTO identity.user_accounts (id, employee_id, password_hash)
     VALUES ($1, $2, $3)`,
    [accountId, employeeId, passwordHash],
  );
  return accountId;
}

async function grantPlatformView(pool: Pool, accountId: string): Promise<void> {
  const roleId = randomUUID();
  const permissionId = randomUUID();
  await pool.query(
    `INSERT INTO iam.roles (id, code, name)
     VALUES ($1, $2, 'Integration test platform viewer')`,
    [roleId, `test-platform-viewer-${randomUUID()}`],
  );
  await pool.query(
    `INSERT INTO iam.permissions (id, module, action)
     VALUES ($1, 'platform', 'view')`,
    [permissionId],
  );
  await pool.query('INSERT INTO iam.role_permissions (role_id, permission_id) VALUES ($1, $2)', [
    roleId,
    permissionId,
  ]);
  await pool.query('INSERT INTO iam.account_roles (account_id, role_id) VALUES ($1, $2)', [
    accountId,
    roleId,
  ]);
}

async function grantAdministrativeRole(pool: Pool, accountId: string): Promise<void> {
  const roleId = randomUUID();
  await pool.query(
    `INSERT INTO iam.roles (id, code, name, is_administrative)
     VALUES ($1, $2, 'Integration test administrator', true)`,
    [roleId, `test-administrator-${randomUUID()}`],
  );
  await pool.query('INSERT INTO iam.account_roles (account_id, role_id) VALUES ($1, $2)', [
    accountId,
    roleId,
  ]);
  for (const action of ['view', 'create', 'edit', 'approve'] as const) {
    const permission = await pool.query<{ id: string }>(
      `INSERT INTO iam.permissions (id, module, action)
       VALUES ($1, 'platform', $2)
       ON CONFLICT (module, action) DO UPDATE SET module = EXCLUDED.module
       RETURNING id`,
      [randomUUID(), action],
    );
    await pool.query(
      `INSERT INTO iam.role_permissions (role_id, permission_id)
       VALUES ($1, $2)`,
      [roleId, permission.rows[0]?.id],
    );
  }
}

function assertTemporaryDatabaseName(value: string): void {
  if (!/^vista_auth_test_[a-f0-9]{32}$/u.test(value)) {
    throw new Error('Refusing to operate on an unexpected authentication test database');
  }
}

function apiErrorCode(error: unknown): string | undefined {
  if (!(error instanceof ApiErrorException)) {
    return undefined;
  }
  const response = error.getResponse();
  if (typeof response !== 'object' || response === null) {
    return undefined;
  }
  const code = (response as Record<string, unknown>)['code'];
  return typeof code === 'string' ? code : undefined;
}
