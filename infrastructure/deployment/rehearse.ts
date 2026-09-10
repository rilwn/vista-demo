import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

// Only disposable, randomly named resources are ever removed by this command.
const project = `vista-deploy-${randomBytes(6).toString('hex')}`;
assert.match(project, /^vista-deploy-[a-f0-9]{12}$/);
const env: NodeJS.ProcessEnv = {
  PATH: process.env['PATH'],
  DOCKER_HOST: process.env['DOCKER_HOST'],
  VISTA_IMAGE_TAG: project,
  POSTGRES_PASSWORD: randomBytes(32).toString('hex'),
  S3_SECRET_ACCESS_KEY: randomBytes(32).toString('hex'),
  SESSION_SECRET: randomBytes(32).toString('hex'),
  TOTP_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
};
const prefix = [
  'compose',
  '--env-file',
  '/dev/null',
  '-p',
  project,
  '-f',
  'infrastructure/deployment/compose.yml',
];
function compose(...args: string[]) {
  const result = spawnSync('docker', [...prefix, ...args], { env, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`Deployment command failed: ${args[0]}`);
}
async function check() {
  // The rehearsal deliberately restarts servers. Do not reuse a connection
  // pooled before the restart, and bound every read so CI cannot hang.
  const request = (url: string) =>
    fetch(url, { headers: { Connection: 'close' }, signal: AbortSignal.timeout(15000) });
  for (const [port, path] of [
    [5473, '/partners'],
    [5474, '/shifts'],
    [5475, '/policies'],
  ] as const) {
    const base = `http://127.0.0.1:${port}`;
    const page = await request(base + path);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    const html = await page.text();
    const asset = html.match(/src="(\/assets\/[^"]+\.js)"/u)?.[1];
    assert.ok(asset, 'A deep link must load the built application');
    assert.equal((await request(base + asset)).status, 200);
    assert.equal((await request(base + '/api/v1/health/ready')).status, 200);
    assert.equal((await request(base + '/api/v1/auth/me')).status, 401);
    assert.equal((await request(base + '/api/v1/not-a-route')).status, 404);
  }
}
try {
  compose('build', 'api', 'operations', 'pos', 'recovery');
  compose('up', '-d', '--wait', 'postgres', 'redis', 'minio', 'mailpit');
  compose('run', '--rm', 'minio-init');
  compose('run', '--rm', '--no-deps', 'api', 'node', 'apps/api/dist/database/migrate.js', 'up');
  compose('up', '-d', '--wait', 'api', 'operations', 'pos', 'recovery');
  await check();
  compose('stop', 'operations', 'pos', 'recovery', 'api');
  compose('run', '--rm', '--no-deps', 'api', 'node', 'apps/api/dist/database/migrate.js', 'down');
  compose('run', '--rm', '--no-deps', 'api', 'node', 'apps/api/dist/database/migrate.js', 'up');
  compose('up', '-d', '--wait', 'api', 'operations', 'pos', 'recovery');
  await check();
  console.log(
    'Deployment rehearsal passed: four images, migrations, deep links, API health, access checks and restart.',
  );
} finally {
  // The project is generated and validated above, never supplied by an environment variable.
  compose('down', '--volumes', '--remove-orphans');
}
