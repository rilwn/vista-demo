import 'reflect-metadata';

import { createHash, randomUUID } from 'node:crypto';

import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { VistaConfigModule } from '../src/config/config.module.js';
import { ObjectStorageModule } from '../src/storage/object-storage.module.js';
import { ObjectStorageService } from '../src/storage/object-storage.service.js';

const runInfrastructureTests = process.env['RUN_INFRASTRUCTURE_TESTS'] === 'true';

describe.skipIf(!runInfrastructureTests)('S3-compatible object storage readiness', () => {
  let module: TestingModule;
  let storage: ObjectStorageService;

  beforeAll(async () => {
    Object.assign(process.env, {
      BUSINESS_TIMEZONE: process.env['BUSINESS_TIMEZONE'] ?? 'Europe/Sofia',
      CORS_ORIGINS: process.env['CORS_ORIGINS'] ?? 'http://localhost:5173',
      DATABASE_URL:
        process.env['DATABASE_URL'] ?? 'postgresql://vista:password@localhost:55432/vista',
      NODE_ENV: 'test',
      REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:56379/15',
      S3_ACCESS_KEY_ID: process.env['S3_ACCESS_KEY_ID'] ?? 'test',
      S3_BUCKET: process.env['S3_BUCKET'] ?? 'vista-test',
      S3_ENDPOINT: process.env['S3_ENDPOINT'] ?? 'http://localhost:9000',
      S3_FORCE_PATH_STYLE: 'true',
      S3_REGION: process.env['S3_REGION'] ?? 'us-east-1',
      S3_SECRET_ACCESS_KEY: process.env['S3_SECRET_ACCESS_KEY'] ?? 'test-secret',
      SESSION_SECRET:
        process.env['SESSION_SECRET'] ?? 'a-test-session-secret-at-least-32-characters',
      SMTP_FROM: process.env['SMTP_FROM'] ?? 'test@example.invalid',
      SMTP_HOST: process.env['SMTP_HOST'] ?? 'localhost',
      SMTP_PORT: process.env['SMTP_PORT'] ?? '1025',
      TOTP_ENCRYPTION_KEY:
        process.env['TOTP_ENCRYPTION_KEY'] ?? 'a-test-totp-key-with-at-least-32-characters',
    });

    module = await Test.createTestingModule({
      imports: [VistaConfigModule, ObjectStorageModule],
    }).compile();
    storage = module.get(ObjectStorageService);
  });

  afterAll(async () => {
    await module.close();
  });

  it('verifies that the configured private bucket is reachable', async () => {
    await expect(storage.ping()).resolves.toBeGreaterThanOrEqual(0);
  });

  it('writes, reads, verifies, and removes a private object', async () => {
    const body = Buffer.from('%PDF-1.4\nVista object-storage integration test\n');
    const key = `integration/object-storage/${randomUUID()}`;
    try {
      await storage.putObject({
        body,
        checksumSha256: createHash('sha256').update(body).digest('hex'),
        key,
        mediaType: 'application/pdf',
      });
      await expect(storage.getObject(key)).resolves.toEqual(body);
    } finally {
      await storage.deleteObject(key);
    }
  });
});
