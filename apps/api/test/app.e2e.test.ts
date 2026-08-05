import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AppEnvironment } from '@vista/config';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureHttpApplication } from '../src/common/http-application.js';
import { APP_ENVIRONMENT } from '../src/config/config.module.js';

const testEnvironment: NodeJS.ProcessEnv = {
  BUSINESS_TIMEZONE: 'Europe/Sofia',
  CORS_ORIGINS: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://vista:password@localhost:5432/vista_test',
  NODE_ENV: 'test',
  REDIS_URL: 'redis://localhost:6379/15',
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
};

describe('platform API', () => {
  let application: INestApplication;

  beforeAll(async () => {
    Object.assign(process.env, testEnvironment);
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    application = module.createNestApplication();
    configureHttpApplication(application, application.get<AppEnvironment>(APP_ENVIRONMENT));
    await application.init();
  });

  afterAll(async () => {
    await application.close();
  });

  it('serves a versioned liveness endpoint with a correlation identifier', async () => {
    const response = await request(application.getHttpServer())
      .get('/api/v1/health/live')
      .set('x-correlation-id', 'test-request-01')
      .expect(200);

    expect(response.headers['x-correlation-id']).toBe('test-request-01');
    expect(response.body).toMatchObject({
      checks: { process: { status: 'up' } },
      status: 'ok',
      version: '0.1.0',
    });
  });

  it('replaces an invalid inbound correlation identifier', async () => {
    const response = await request(application.getHttpServer())
      .get('/api/v1')
      .set('x-correlation-id', 'invalid value with spaces')
      .expect(200);

    expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns the stable error envelope for unknown routes', async () => {
    const response = await request(application.getHttpServer())
      .get('/api/v1/not-found')
      .expect(404);

    expect(response.body).toMatchObject({
      error: {
        code: 'RESOURCE_NOT_FOUND',
        message: 'Cannot GET /api/v1/not-found',
      },
    });
    expect(response.body.error.correlationId).toBe(response.headers['x-correlation-id']);
  });
});
