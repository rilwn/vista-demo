import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const project = `vista-e2e-${randomUUID().replaceAll('-', '')}`;
if (!/^vista-e2e-[a-f0-9]{32}$/.test(project)) throw Error('Invalid isolated project');
const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  CI: process.env.CI,
  PLAYWRIGHT_EXECUTABLE_PATH: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  VISTA_E2E_ISOLATED: 'true',
  DOTENV_CONFIG_PATH: '/dev/null',
  NODE_ENV: 'development',
  API_HOST: '127.0.0.1',
  API_PORT: '5300',
  VISTA_API_PROXY_URL: 'http://127.0.0.1:5300',
  CORS_ORIGINS: 'http://127.0.0.1:5373,http://127.0.0.1:5374,http://127.0.0.1:5375',
  BUSINESS_TIMEZONE: 'Europe/Sofia',
  DATABASE_URL: 'postgresql://vista_e2e:local-e2e-only@127.0.0.1:58432/vista_e2e',
  REDIS_URL: 'redis://127.0.0.1:58379/0',
  S3_ENDPOINT: 'http://127.0.0.1:58900',
  S3_ACCESS_KEY_ID: 'vista-e2e',
  S3_SECRET_ACCESS_KEY: 'local-e2e-storage-only',
  S3_BUCKET: 'vista-e2e',
  S3_REGION: 'us-east-1',
  S3_FORCE_PATH_STYLE: 'true',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '58025',
  SMTP_FROM: 'e2e@example.invalid',
  SESSION_SECRET: 'local-e2e-session-secret-at-least-32-characters',
  TOTP_ENCRYPTION_KEY: 'local-e2e-totp-secret-at-least-32-characters',
  DEV_FIXTURES_ENABLED: 'true',
  DEV_FIXTURES_PASSWORD: 'Vista-Browser-Test-7!',
  REQUEST_LOGGING_ENABLED: 'false',
};
let active: ChildProcess | undefined;
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    interrupted = true;
    active?.kill('SIGTERM');
  });
function run(command: string, args: string[], cleanup = false): Promise<void> {
  if (interrupted && !cleanup) return Promise.reject(Error('Browser run interrupted'));
  return new Promise((resolve, reject) => {
    active = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    active.once('error', reject);
    active.once('exit', (code) => {
      active = undefined;
      if (code === 0) resolve();
      else reject(Error(`${command} exited with ${code}`));
    });
  });
}
const compose = ['compose', '--project-name', project, '--file', 'tests/e2e/compose.yml'];
try {
  await run('docker', [
    ...compose,
    'up',
    '-d',
    '--wait',
    '--wait-timeout',
    '90',
    'postgres',
    'redis',
    'minio',
    'mailpit',
  ]);
  await run('docker', [...compose, 'run', '--rm', 'minio-init']);
  await run('npm', ['run', 'build:packages']);
  await run('npm', ['run', 'build', '-w', '@vista/api']);
  await run('node', ['--import', 'tsx', 'apps/api/src/database/migrate.ts', 'up']);
  await run('node', ['apps/api/dist/database/seed-dev.js']);
  const allIntegration = process.argv.includes('--all-integration');
  const integrationTests = allIntegration
    ? ['test']
    : [
        ...(process.argv.includes('--crm-integration')
          ? ['test/crm-pipeline.integration.test.ts']
          : []),
        ...(process.argv.includes('--files-integration') ? ['test/files.integration.test.ts'] : []),
        ...(process.argv.includes('--sales-integration') ? ['test/sales.integration.test.ts'] : []),
        ...(process.argv.includes('--pos-integration') ? ['test/pos.integration.test.ts'] : []),
        ...(process.argv.includes('--auth-integration')
          ? ['test/authentication.integration.test.ts']
          : []),
      ];
  if (integrationTests.length > 0) {
    env['RUN_INFRASTRUCTURE_TESTS'] = 'true';
    if (allIntegration) env['RUN_DATABASE_TESTS'] = 'true';
    try {
      await run('npm', ['run', 'test', '-w', '@vista/api', '--', ...integrationTests]);
    } finally {
      delete env['RUN_INFRASTRUCTURE_TESTS'];
      delete env['RUN_DATABASE_TESTS'];
    }
  }
  await run('node', [
    'node_modules/@playwright/test/cli.js',
    'test',
    '--config',
    'tests/e2e/playwright.config.ts',
    ...process.argv
      .slice(2)
      .filter(
        (argument) =>
          ![
            '--crm-integration',
            '--pos-integration',
            '--auth-integration',
            '--sales-integration',
            '--files-integration',
            '--migration-rehearsal',
            '--all-integration',
          ].includes(argument),
      ),
  ]);
  if (process.argv.includes('--migration-rehearsal')) {
    // Browser servers have stopped. Only this run's disposable database is used.
    await run('node', ['--import', 'tsx', 'apps/api/src/database/migrate.ts', 'down']);
    await run('node', ['--import', 'tsx', 'apps/api/src/database/migrate.ts', 'up']);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Browser acceptance failed');
  process.exitCode = 1;
} finally {
  // Unique project created by this process only; never target the development compose project.
  await run('docker', [...compose, 'ps', '--all'], true);
  await run('docker', [...compose, 'down', '--volumes'], true);
}
