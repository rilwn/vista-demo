import type { ExecutionContext } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';

import { RATE_LIMIT_POLICY, type RateLimitPolicyName } from './rate-limit.decorator.js';

export function rateLimitForContext(
  environment: AppEnvironment,
  context: ExecutionContext,
): number {
  const policy = policyForContext(context);
  switch (policy) {
    case 'public':
      return environment.API_RATE_LIMIT_PUBLIC_MAX;
    case 'read':
      return environment.API_RATE_LIMIT_READ_MAX;
    case 'sensitive':
      return environment.API_RATE_LIMIT_SENSITIVE_MAX;
    case 'write':
      return environment.API_RATE_LIMIT_WRITE_MAX;
    default:
      return environment.API_RATE_LIMIT_MAX;
  }
}

export function policyForContext(context: ExecutionContext): RateLimitPolicyName | undefined {
  return readPolicy(context.getHandler()) ?? readPolicy(context.getClass());
}

function readPolicy(target: object): RateLimitPolicyName | undefined {
  const value = Reflect.getMetadata(RATE_LIMIT_POLICY, target) as unknown;
  return value === 'public' || value === 'read' || value === 'sensitive' || value === 'write'
    ? value
    : undefined;
}
