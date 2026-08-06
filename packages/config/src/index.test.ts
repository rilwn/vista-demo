import { describe, expect, it } from 'vitest';

import { parseEnvironment } from './index';

const validEnvironment: NodeJS.ProcessEnv = {
  BUSINESS_TIMEZONE: 'Europe/Sofia',
  CORS_ORIGINS: 'http://localhost:5173,http://localhost:5174',
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
};

describe('parseEnvironment', () => {
  it('normalizes values and keeps optional capabilities disabled by default', () => {
    const environment = parseEnvironment(validEnvironment);

    expect(environment.API_PORT).toBe(3000);
    expect(environment.API_RATE_LIMIT_MAX).toBe(120);
    expect(environment.API_RATE_LIMIT_TTL_MS).toBe(60_000);
    expect(environment.AUTH_LOGIN_RATE_LIMIT_MAX).toBe(5);
    expect(environment.CORS_ORIGINS).toEqual(['http://localhost:5173', 'http://localhost:5174']);
    expect(environment.DEPENDENCY_HEALTH_TIMEOUT_MS).toBe(2_000);
    expect(environment.FEATURE_CUSTOMER_PORTAL).toBe(false);
    expect(environment.FEATURE_FIFO_COSTING).toBe(false);
    expect(environment.IDEMPOTENCY_TTL_SECONDS).toBe(86_400);
    expect(environment.JOB_DEFAULT_ATTEMPTS).toBe(5);
    expect(environment.JOB_QUEUE_NAME).toBe('platform');
    expect(environment.PASSWORD_EXPIRY_DAYS).toBe(0);
    expect(environment.PASSWORD_MIN_LENGTH).toBe(12);
    expect(environment.REQUEST_LOGGING_ENABLED).toBe(true);
    expect(environment.SESSION_TTL_SECONDS).toBe(28_800);
  });

  it('fails fast when required configuration is missing', () => {
    expect(() => parseEnvironment({})).toThrow('Invalid environment configuration');
  });

  it('rejects non-PostgreSQL database URLs', () => {
    expect(() =>
      parseEnvironment({ ...validEnvironment, DATABASE_URL: 'mysql://localhost/vista' }),
    ).toThrow('DATABASE_URL must use the postgresql scheme');
  });

  it('rejects unsafe or unbounded operational settings', () => {
    expect(() => parseEnvironment({ ...validEnvironment, API_RATE_LIMIT_MAX: '0' })).toThrow(
      'API_RATE_LIMIT_MAX',
    );
    expect(() => parseEnvironment({ ...validEnvironment, JOB_DEFAULT_ATTEMPTS: '21' })).toThrow(
      'JOB_DEFAULT_ATTEMPTS',
    );
    expect(() => parseEnvironment({ ...validEnvironment, PASSWORD_MIN_LENGTH: '7' })).toThrow(
      'PASSWORD_MIN_LENGTH',
    );
  });
});
