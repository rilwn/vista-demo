import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiServiceUnavailableResponse, ApiTooManyRequestsResponse } from '@nestjs/swagger';

export const RATE_LIMIT_POLICY = Symbol('RATE_LIMIT_POLICY');

export type RateLimitPolicyName = 'public' | 'read' | 'sensitive' | 'write';

export const RateLimitPolicy = (policy: RateLimitPolicyName): MethodDecorator & ClassDecorator =>
  applyDecorators(
    SetMetadata(RATE_LIMIT_POLICY, policy),
    ApiTooManyRequestsResponse({ description: 'The endpoint request limit was exceeded.' }),
    ApiServiceUnavailableResponse({
      description: 'The distributed request-protection store is unavailable.',
    }),
  );
