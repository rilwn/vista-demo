import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
if (process.env['VISTA_E2E_ISOLATED'] !== 'true')
  throw Error('Use npm run test:e2e to start isolated services.');
const cwd = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 60000,
  outputDir: '../../test-results/browser',
  reporter: [['list'], ['html', { outputFolder: '../../playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5373',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env['PLAYWRIGHT_EXECUTABLE_PATH']
      ? { executablePath: process.env['PLAYWRIGHT_EXECUTABLE_PATH'] }
      : {},
  },
  webServer: [
    {
      command: 'npm run dev -w @vista/backup-control -- --host 127.0.0.1 --port 5375 --strictPort',
      cwd,
      url: 'http://127.0.0.1:5375',
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -w @vista/pos-web -- --host 127.0.0.1 --port 5374 --strictPort',
      cwd,
      url: 'http://127.0.0.1:5374',
      reuseExistingServer: false,
    },
    {
      command: 'node apps/api/dist/main.js',
      cwd,
      url: 'http://127.0.0.1:5300/api/v1/health/live',
      reuseExistingServer: false,
      timeout: 90000,
    },
    {
      command: 'npm run dev -w @vista/erp-crm-web -- --host 127.0.0.1 --port 5373 --strictPort',
      cwd,
      url: 'http://127.0.0.1:5373',
      reuseExistingServer: false,
    },
  ],
});
