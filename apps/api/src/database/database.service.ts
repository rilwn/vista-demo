import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import { Pool } from 'pg';

import { APP_ENVIRONMENT } from '../config/config.module.js';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly pool: Pool;

  constructor(@Inject(APP_ENVIRONMENT) environment: AppEnvironment) {
    this.pool = new Pool({
      application_name: 'vista-api',
      connectionString: environment.DATABASE_URL,
      max: 10,
    });
  }

  async ping(): Promise<number> {
    const start = performance.now();
    await this.pool.query('SELECT 1');
    return Math.round(performance.now() - start);
  }

  getPool(): Pool {
    return this.pool;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
