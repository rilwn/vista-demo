import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';

import { APP_ENVIRONMENT } from '../config/config.module.js';

@Injectable()
export class ObjectStorageService implements OnApplicationShutdown {
  private readonly bucket: string;
  private readonly client: S3Client;
  private readonly timeoutMs: number;

  constructor(@Inject(APP_ENVIRONMENT) environment: AppEnvironment) {
    this.bucket = environment.S3_BUCKET;
    this.timeoutMs = environment.DEPENDENCY_HEALTH_TIMEOUT_MS;
    this.client = new S3Client({
      credentials: {
        accessKeyId: environment.S3_ACCESS_KEY_ID,
        secretAccessKey: environment.S3_SECRET_ACCESS_KEY,
      },
      endpoint: environment.S3_ENDPOINT,
      forcePathStyle: environment.S3_FORCE_PATH_STYLE,
      region: environment.S3_REGION,
    });
  }

  async ping(): Promise<number> {
    const startedAt = performance.now();
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }), {
      abortSignal: AbortSignal.timeout(this.timeoutMs),
    });
    return Math.round(performance.now() - startedAt);
  }

  onApplicationShutdown(): void {
    this.client.destroy();
  }
}
