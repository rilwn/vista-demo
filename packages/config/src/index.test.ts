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
    expect(environment.CORS_ORIGINS).toEqual(['http://localhost:5173', 'http://localhost:5174']);
    expect(environment.FEATURE_CUSTOMER_PORTAL).toBe(false);
    expect(environment.FEATURE_FIFO_COSTING).toBe(false);
  });

  it('fails fast when required configuration is missing', () => {
    expect(() => parseEnvironment({})).toThrow('Invalid environment configuration');
  });

  it('rejects non-PostgreSQL database URLs', () => {
    expect(() =>
      parseEnvironment({ ...validEnvironment, DATABASE_URL: 'mysql://localhost/vista' }),
    ).toThrow('DATABASE_URL must use the postgresql scheme');
  });
});
