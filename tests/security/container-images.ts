import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function imageMatrix(outputs: string[]) {
  if (!outputs.length || outputs.some((output) => !output.trim()))
    throw new Error('Every Compose file must supply at least one container image.');
  const images = [...new Set(outputs.flatMap((output) => output.trim().split(/\s+/)))].sort();
  for (const image of images) {
    // Only explicit tags/digests, never shell syntax, interpolation or implicit latest.
    if (
      !/^[a-z0-9][a-z0-9./_-]*(?::[A-Za-z0-9_.-]+|@sha256:[a-f0-9]{64})$/.test(image) ||
      image.endsWith(':latest')
    )
      throw new Error('Container scanning requires an explicit image version or digest.');
  }
  return { include: images.map((image, index) => ({ image, artifact: `container-${index + 1}` })) };
}

export function discoverImages() {
  const cwd = fileURLToPath(new URL('../../', import.meta.url));
  return imageMatrix(
    ['infrastructure/docker/compose.yml', 'tests/e2e/compose.yml'].map((file) =>
      execFileSync(
        'docker',
        ['compose', '--env-file', '/dev/null', '-f', file, 'config', '--images'],
        {
          cwd,
          encoding: 'utf8',
          timeout: 30000,
          // Do not read .env or pass credentials from the caller to Compose.
          env: {
            PATH: process.env['PATH'],
            POSTGRES_DB: 'scan-only',
            POSTGRES_USER: 'scan-only',
            POSTGRES_PASSWORD: 'scan-only',
            S3_ACCESS_KEY_ID: 'scan-only',
            S3_SECRET_ACCESS_KEY: 'scan-only',
            S3_BUCKET: 'scan-only',
          },
        },
      ),
    ),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.stdout.write(`${JSON.stringify(discoverImages())}\n`);
