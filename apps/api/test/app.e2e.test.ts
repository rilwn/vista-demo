import 'reflect-metadata';

import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Throttle } from '@nestjs/throttler';
import type { AppEnvironment } from '@vista/config';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { Public } from '../src/auth/auth.decorators.js';
import { configureHttpApplication } from '../src/common/http-application.js';
import { APP_ENVIRONMENT } from '../src/config/config.module.js';

const runInfrastructureTests = process.env['RUN_INFRASTRUCTURE_TESTS'] === 'true';
const testEnvironment: NodeJS.ProcessEnv = {
  BUSINESS_TIMEZONE: 'Europe/Sofia',
  CORS_ORIGINS: 'http://localhost:5173',
  DATABASE_URL:
    process.env['DATABASE_URL'] ?? 'postgresql://vista:password@localhost:5432/vista_test',
  NODE_ENV: 'test',
  REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379/15',
  S3_ACCESS_KEY_ID: process.env['S3_ACCESS_KEY_ID'] ?? 'test',
  S3_BUCKET: process.env['S3_BUCKET'] ?? 'vista-test',
  S3_ENDPOINT: process.env['S3_ENDPOINT'] ?? 'http://localhost:9000',
  S3_REGION: process.env['S3_REGION'] ?? 'us-east-1',
  S3_SECRET_ACCESS_KEY: process.env['S3_SECRET_ACCESS_KEY'] ?? 'test-secret',
  SESSION_SECRET: 'a-test-session-secret-at-least-32-characters',
  SMTP_FROM: 'test@example.invalid',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  TOTP_ENCRYPTION_KEY: 'a-test-totp-key-with-at-least-32-characters',
};

@Controller('_test/rate-limit')
@Public()
class RateLimitTestController {
  @Get()
  @Throttle({ default: { limit: 1, ttl: 60_000 } })
  response(): { status: string } {
    return { status: 'ok' };
  }
}

describe('platform API', () => {
  let application: INestApplication;

  beforeAll(async () => {
    Object.assign(process.env, testEnvironment);
    const module = await Test.createTestingModule({
      controllers: [RateLimitTestController],
      imports: [AppModule],
    }).compile();
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

  it.skipIf(!runInfrastructureTests)(
    'reports PostgreSQL, Redis, and object storage as ready',
    async () => {
      const response = await request(application.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(200);

      expect(response.body).toMatchObject({
        checks: {
          database: { status: 'up' },
          objectStorage: { status: 'up' },
          redis: { status: 'up' },
        },
        status: 'ok',
      });
    },
  );

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

  it('rate limits protected routes and preserves the stable error envelope', async () => {
    await request(application.getHttpServer()).get('/api/v1/_test/rate-limit').expect(200);
    const response = await request(application.getHttpServer())
      .get('/api/v1/_test/rate-limit')
      .expect(429);

    expect(response.body).toMatchObject({
      error: {
        code: 'RATE_LIMITED',
        correlationId: response.headers['x-correlation-id'],
      },
    });
  });
});
