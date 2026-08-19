import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
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

  async putObject(input: {
    body: Buffer;
    checksumSha256: string;
    key: string;
    mediaType: string;
  }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Body: input.body,
        Bucket: this.bucket,
        ContentLength: input.body.length,
        ContentType: input.mediaType,
        Key: input.key,
        Metadata: { 'vista-sha256': input.checksumSha256 },
      }),
    );
  }

  async getObject(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new Error('Object storage returned an empty response body');
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  bucketName(): string {
    return this.bucket;
  }

  onApplicationShutdown(): void {
    this.client.destroy();
  }
}
