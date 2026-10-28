import { createHash } from 'node:crypto';

import { parseEnvironment } from '@vista/config';
import { describe, expect, it, vi } from 'vitest';

import { SessionService } from './session.service.js';

const sessionToken = 'a'.repeat(43);
const accountId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';

describe('directory role authorization in sessions', () => {
  it('discards malformed cached directory groups before resolving permissions', async () => {
    const redis = {
      del: vi.fn().mockResolvedValue(1),
      get: vi.fn().mockResolvedValue(
        JSON.stringify({
          accountId,
          sessionId,
          twoFactorVerified: true,
          authProvider: 'oidc',
          authMethod: 'oidc',
          directoryGroups: [42],
        }),
      ),
    };
    const databaseQuery = vi.fn();
    const database = { getPool: () => ({ query: databaseQuery }) };
    const redisService = { ensureConnected: () => Promise.resolve(redis) };
    const audit = { append: vi.fn() };
    const environment = parseEnvironment({
      BUSINESS_TIMEZONE: 'Europe/Sofia',
      CORS_ORIGINS: 'http://localhost:5173',
      DATABASE_URL: 'postgresql://vista:password@localhost:5432/vista',
      REDIS_URL: 'redis://localhost:6379/0',
      S3_ACCESS_KEY_ID: 'local',
      S3_BUCKET: 'vista-development',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_SECRET_ACCESS_KEY: 'local-secret',
      SESSION_SECRET: 'a-session-secret-with-at-least-32-characters',
      SMTP_FROM: 'no-reply@example.invalid',
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1025',
      TOTP_ENCRYPTION_KEY: 'a-totp-encryption-key-at-least-32-chars',
    });
    const service = new SessionService(
      environment,
      database as never,
      redisService as never,
      audit as never,
    );

    await expect(service.resolve(sessionToken)).resolves.toBeUndefined();
    expect(redis.del).toHaveBeenCalledOnce();
    expect(databaseQuery).not.toHaveBeenCalled();
  });

  it('adds only configured, existing Vista roles to the session permission set', async () => {
    const digest = createHash('sha256').update(sessionToken).digest('hex');
    const redis = {
      del: vi.fn().mockResolvedValue(1),
      get: vi.fn().mockResolvedValue(
        JSON.stringify({
          accountId,
          sessionId,
          twoFactorVerified: true,
          authProvider: 'oidc',
          directoryGroups: ['CN=Finance,OU=Groups'],
        }),
      ),
    };
    const dbQuery = vi.fn((sql: string) => {
      if (sql.includes('FROM identity.session_records session')) {
        return Promise.resolve({
          rows: [
            {
              account_id: accountId,
              auth_provider: 'oidc',
              directory_groups: ['CN=Finance,OU=Groups'],
              display_name: 'Vista Finance Officer',
              email: 'finance@vista.local',
              employee_id: '33333333-3333-4333-8333-333333333333',
              expires_at: new Date(Date.now() + 60_000),
              is_administrative: false,
              role_names: ['Finance Officer'],
              session_id: sessionId,
              two_factor_verified: true,
            },
          ],
        });
      }
      if (sql.includes('FROM iam.account_roles'))
        return Promise.resolve({ rows: [{ action: 'view', module: 'erp.finance' }] });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    const database = { getPool: () => ({ query: dbQuery }) };
    const redisService = { ensureConnected: () => Promise.resolve(redis) };
    const audit = { append: vi.fn() };
    const environment = parseEnvironment({
      BUSINESS_TIMEZONE: 'Europe/Sofia',
      CORS_ORIGINS: 'http://localhost:5173',
      DATABASE_URL: 'postgresql://vista:password@localhost:5432/vista',
      REDIS_URL: 'redis://localhost:6379/0',
      S3_ACCESS_KEY_ID: 'local',
      S3_BUCKET: 'vista-development',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_SECRET_ACCESS_KEY: 'local-secret',
      SESSION_SECRET: 'a-session-secret-with-at-least-32-characters',
      SMTP_FROM: 'no-reply@example.invalid',
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1025',
      TOTP_ENCRYPTION_KEY: 'a-totp-encryption-key-at-least-32-chars',
      DIRECTORY_AUTH_PROVIDER: 'oidc',
      DIRECTORY_OIDC_ISSUER: 'https://identity.example.invalid',
      DIRECTORY_OIDC_CLIENT_ID: 'vista',
      DIRECTORY_OIDC_CLIENT_SECRET: 'not-a-real-secret',
      DIRECTORY_OIDC_CALLBACK_URL:
        'https://api.example.invalid/api/v1/auth/directory/oidc/callback',
      DIRECTORY_LOGIN_RETURN_URLS_JSON: '{"operations":"https://ops.example.invalid"}',
      DIRECTORY_GROUP_ROLE_MAPPINGS_JSON: '{"cn=finance,ou=groups":["finance"]}',
    });
    const service = new SessionService(
      environment,
      database as never,
      redisService as never,
      audit as never,
    );

    const context = await service.resolve(sessionToken);

    expect(context?.isAdministrative).toBe(false);
    expect(context?.permissions).toEqual([{ action: 'view', module: 'erp.finance' }]);
    expect(dbQuery).toHaveBeenCalledWith(expect.stringContaining('role.code = ANY($4::text[])'), [
      sessionId,
      digest,
      true,
      ['finance'],
    ]);
    expect(dbQuery).toHaveBeenCalledWith(expect.stringContaining('FROM iam.roles role'), [
      accountId,
      ['finance'],
    ]);
    expect(dbQuery).toHaveBeenCalledWith(expect.stringContaining('role.code = ANY($2::text[])'), [
      accountId,
      ['finance'],
    ]);
  });

  it('writes the emergency-access audit event in the same transaction as the session', async () => {
    const environment = parseEnvironment({
      BUSINESS_TIMEZONE: 'Europe/Sofia',
      CORS_ORIGINS: 'http://localhost:5173',
      DATABASE_URL: 'postgresql://vista:password@localhost:5432/vista',
      REDIS_URL: 'redis://localhost:6379/0',
      S3_ACCESS_KEY_ID: 'local',
      S3_BUCKET: 'vista-development',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_SECRET_ACCESS_KEY: 'local-secret',
      SESSION_SECRET: 'a-session-secret-with-at-least-32-characters',
      SMTP_FROM: 'no-reply@example.invalid',
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1025',
      TOTP_ENCRYPTION_KEY: 'a-totp-encryption-key-at-least-32-chars',
    });
    const transaction = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
      release: vi.fn(),
    };
    const database = { getPool: () => ({ connect: () => Promise.resolve(transaction) }) };
    const redis = { set: vi.fn().mockResolvedValue('OK') };
    const redisService = { ensureConnected: () => Promise.resolve(redis) };
    const audit = { append: vi.fn().mockResolvedValue({}) };
    const service = new SessionService(
      environment,
      database as never,
      redisService as never,
      audit as never,
    );

    await service.create(
      accountId,
      true,
      { correlationId: '44444444-4444-4444-8444-444444444444' },
      {
        authMethod: 'emergency_password',
        authProvider: 'local',
        emergencyReason: 'Organization identity service outage',
      },
    );

    const emergencyEvent = audit.append.mock.calls.find(
      ([event]) => event.action === 'auth.emergency_access.used',
    );
    expect(emergencyEvent?.[0].after).toMatchObject({
      reason: 'Organization identity service outage',
    });
    expect(emergencyEvent?.[1]).toBe(transaction);
    expect(transaction.query).toHaveBeenCalledWith(
      expect.stringContaining('emergency_access_reason'),
      expect.arrayContaining(['Organization identity service outage']),
    );
  });
});
