import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { parseEnvironment } from '@vista/config';
import { RateLimitPolicy } from './rate-limit.decorator.js';
import { policyForContext, rateLimitForContext } from './rate-limit.policy.js';

@RateLimitPolicy('write')
class PolicyFixture {
  @RateLimitPolicy('sensitive')
  sensitive(this: void): void {}

  write(this: void): void {}
}

class UnclassifiedFixture {
  endpoint(this: void): void {}
}

const environment = parseEnvironment({
  API_RATE_LIMIT_MAX: '100',
  API_RATE_LIMIT_PUBLIC_MAX: '40',
  API_RATE_LIMIT_READ_MAX: '200',
  API_RATE_LIMIT_SENSITIVE_MAX: '10',
  API_RATE_LIMIT_WRITE_MAX: '50',
  BUSINESS_TIMEZONE: 'Europe/Sofia',
  CORS_ORIGINS: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://vista:password@localhost:5432/vista',
  REDIS_URL: 'redis://localhost:6379/0',
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

describe('rate-limit policy', () => {
  it('allows a method policy to override its controller policy', () => {
    const context = executionContext(PolicyFixture, handlerOf(PolicyFixture, 'sensitive'));

    expect(policyForContext(context)).toBe('sensitive');
    expect(rateLimitForContext(environment, context)).toBe(10);
  });

  it('inherits the controller policy and retains a safe fallback', () => {
    const inherited = executionContext(PolicyFixture, handlerOf(PolicyFixture, 'write'));
    const fallback = executionContext(
      UnclassifiedFixture,
      handlerOf(UnclassifiedFixture, 'endpoint'),
    );

    expect(rateLimitForContext(environment, inherited)).toBe(50);
    expect(policyForContext(fallback)).toBeUndefined();
    expect(rateLimitForContext(environment, fallback)).toBe(100);
  });
});

type RouteHandler = (...arguments_: never[]) => unknown;

function executionContext(controller: object, handler: RouteHandler): ExecutionContext {
  return {
    getClass: () => controller,
    getHandler: () => handler,
  } as unknown as ExecutionContext;
}

function handlerOf(controller: { prototype: object }, name: string): RouteHandler {
  const value = Object.getOwnPropertyDescriptor(controller.prototype, name)?.value as unknown;
  if (typeof value !== 'function') throw new Error(`Missing test handler ${name}`);
  return value as RouteHandler;
}
