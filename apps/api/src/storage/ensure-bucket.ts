import 'dotenv/config';

import { S3Client } from '@aws-sdk/client-s3';
import { ensurePrivateBucket } from './bucket-bootstrap.js';

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}

async function run(): Promise<void> {
  const client = new S3Client({
    credentials: {
      accessKeyId: requiredEnvironment('S3_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnvironment('S3_SECRET_ACCESS_KEY'),
    },
    endpoint: requiredEnvironment('S3_ENDPOINT'),
    forcePathStyle: process.env['S3_FORCE_PATH_STYLE'] !== 'false',
    region: process.env['S3_REGION'] || 'us-east-1',
  });

  try {
    await ensurePrivateBucket(
      client,
      requiredEnvironment('S3_BUCKET'),
      process.env['S3_REGION'] || 'us-east-1',
      Number(process.env['DEPENDENCY_HEALTH_TIMEOUT_MS'] || 5_000),
    );
    await ensurePrivateBucket(
      client,
      process.env['BACKUP_S3_BUCKET'] || 'vista-backups',
      process.env['S3_REGION'] || 'us-east-1',
      Number(process.env['DEPENDENCY_HEALTH_TIMEOUT_MS'] || 5_000),
    );
    process.stdout.write('Private file and backup storage buckets are ready.\n');
  } finally {
    client.destroy();
  }
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown storage error';
  process.stderr.write(`Could not prepare the private object-storage bucket: ${message}\n`);
  process.exitCode = 1;
});
