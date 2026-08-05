import { Inject, Injectable } from '@nestjs/common';
import type { HealthCheck, HealthResponse } from '@vista/contracts';

import { DatabaseService } from '../database/database.service.js';
import { RedisService } from '../database/redis.service.js';

interface Probe {
  ping(): Promise<number>;
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  liveness(): HealthResponse {
    return createResponse({ process: { status: 'up' } });
  }

  async readiness(): Promise<HealthResponse> {
    const [database, redis] = await Promise.all([runProbe(this.database), runProbe(this.redis)]);

    return createResponse({ database, redis });
  }
}

async function runProbe(probe: Probe): Promise<HealthCheck> {
  try {
    return { latencyMs: await probe.ping(), status: 'up' };
  } catch {
    return { detail: 'Dependency probe failed', status: 'down' };
  }
}

function createResponse(checks: Record<string, HealthCheck>): HealthResponse {
  return {
    checks,
    status: Object.values(checks).every((check) => check.status === 'up') ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
  };
}
