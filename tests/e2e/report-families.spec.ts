import { expect, test, type Page, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import { signIn } from './sign-in.js';
import {
  prepareReportFamilyFixtures,
  removeReportFamilyFixtures,
} from './report-family-fixtures.js';

test.beforeAll(prepareReportFamilyFixtures);
test.afterAll(removeReportFamilyFixtures);

async function choose(page: Page, label: string, value: string) {
  await page
    .getByRole('combobox', { name: `Search ${label}`, exact: true })
    .fill(value.slice(0, -1));
  await page.getByRole('listbox').getByRole('option', { name: value, exact: true }).click();
}
async function submitExport(page: Page, button: Locator, scope: string, interrupt: boolean) {
  const endpoint = `/${scope}/report-exports`;
  let acceptedId = '';
  let acceptedKey = '';
  if (interrupt) {
    const failed = page.waitForEvent('requestfailed', {
      predicate: (r) => r.url().endsWith(endpoint) && r.method() === 'POST',
    });
    await page.route(`**/api/v1${endpoint}`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(202);
      acceptedId = ((await response.json()) as { id: string }).id;
      acceptedKey = route.request().headers()['idempotency-key'] ?? '';
      await route.abort('failed');
      await page.unroute(`**/api/v1${endpoint}`);
    });
    await button.click();
    await failed;
    await expect(button).toBeEnabled();
  }
  const pending = page.waitForResponse(
    (r) => r.url().endsWith(endpoint) && r.request().method() === 'POST',
  );
  await button.click();
  const response = await pending;
  expect(response.status()).toBe(202);
  if (interrupt) {
    expect(acceptedId).toBeTruthy();
    expect(acceptedKey).toBeTruthy();
    expect(((await response.json()) as { id: string }).id).toBe(acceptedId);
    expect(response.request().headers()['idempotency-key']).toBe(acceptedKey);
  }
}

async function completeFile(page: Page, row: Locator, format: string, prefix: string) {
  const button = row.getByRole('button', { name: 'Download', exact: true });
  await expect(button).toBeVisible({ timeout: 45000 });
  const pending = page.waitForEvent('download');
  await button.click();
  const file = await pending;
  expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
  const bytes = await readFile(await file.path());
  let text = bytes.toString();
  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(await file.path());
    text = JSON.stringify(workbook.worksheets.map((sheet) => sheet.getSheetValues()));
  }
  if (format === 'pdf') {
    const path = test.info().outputPath(`${prefix}large.pdf`);
    await file.saveAs(path);
    // Read cells in PDF drawing order; layout mode interleaves neighboring
    // columns when a long document number wraps onto a second line.
    text = execFileSync('pdftotext', ['-raw', path, '-'], {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    }).replace(/\s+/g, '');
    expect(bytes.toString('latin1').match(/\/Type \/Page\b/g)?.length).toBeGreaterThan(1);
  }
  const codes = text.match(new RegExp(`${prefix}\\d{4}`, 'g')) ?? [];
  if (prefix === 'FAMILY-POS-') {
    const compact = text.replace(/\s+/g, '');
    expect(compact).toContain('2026-01-1512:00:00');
    expect(compact).toContain('2026-01-1514:00:00');
    expect(text).not.toContain('2026-01-15T10:00:00');
  }
  expect(codes.sort()).toEqual(
    Array.from({ length: 1001 }, (_, i) => `${prefix}${String(i + 1).padStart(4, '0')}`),
  );
  return bytes.length;
}

for (const [scope, module, area, report, prefix] of [
  ['finance', 'Finance', 'Finance reports', 'Purchase journal review', 'FAMILY-FIN-'],
  ['service', 'Service', 'Service reports', 'Service request register', 'FAMILY-SVC-'],
  ['crm', 'Customers & CRM', 'CRM analytics', 'Employee performance', 'FAMILY-EMP-'],
] as const) {
  test(`${module} exports all 1001 records in every format`, async ({ page }) => {
    test.setTimeout(180000);
    await page.goto('/');
    await signIn(page, 'manager@vista.local');
    await page
      .locator('.workspace-sidebar')
      .getByRole('link', { name: module, exact: true })
      .click();
    await page
      .getByRole('navigation', { name: 'Choose an area' })
      .getByRole('link', { name: new RegExp(`^${area} `) })
      .click();
    await page.getByRole('button', { name: 'Export report', exact: true }).click();
    const panel = page.getByRole('dialog');
    await choose(page, 'Report', report);
    await panel.getByLabel('From', { exact: true }).fill('2026-01-15');
    await panel.getByLabel('To', { exact: true }).fill('2026-01-15');
    for (const format of ['csv', 'xlsx', 'pdf']) {
      const started = performance.now();
      await panel.locator(`input[type="radio"][value="${format}"]`).check();
      await submitExport(
        page,
        panel.getByRole('button', { name: 'Prepare export', exact: true }),
        scope,
        format === 'csv',
      );
      const row = panel.locator('.report-export-list article').first();
      await expect(row.locator('.report-export-file-mark')).toHaveText(format.toUpperCase());
      const bytes = await completeFile(page, row, format, prefix);
      await test.info().attach(`${scope}-${format}-timing.json`, {
        contentType: 'application/json',
        body: JSON.stringify({
          rows: 1001,
          bytes,
          milliseconds: performance.now() - started,
          localFixtureOnly: true,
        }),
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: 'Dismiss message', exact: true })).toHaveCount(
      0,
      { timeout: 10000 },
    );
    await panel.locator('.security-drawer-body').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(
      panel.getByRole('button', { name: 'Prepare export', exact: true }),
    ).toBeInViewport();
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`${scope}-large-mobile.png`) });
  });
}

test('POS exports all 1001 closed shifts in every format', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('http://127.0.0.1:5374/');
  await signIn(page, 'pos.operator@vista.local');
  await page
    .getByRole('navigation', { name: 'POS navigation' })
    .getByRole('link', { name: 'Reports', exact: true })
    .click();
  await page.getByLabel('From', { exact: true }).fill('2026-01-15');
  await page.getByLabel('To', { exact: true }).fill('2026-01-15');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  for (const format of ['csv', 'xlsx', 'pdf']) {
    const started = performance.now();
    await submitExport(
      page,
      page
        .locator('.pos-export-buttons')
        .getByRole('button', { name: format.toUpperCase(), exact: true }),
      'pos',
      format === 'csv',
    );
    const row = page.locator('.pos-export-list article').first();
    await expect(row.locator('.pos-export-format')).toHaveText(format.toUpperCase());
    const bytes = await completeFile(page, row, format, 'FAMILY-POS-');
    await test.info().attach(`pos-${format}-timing.json`, {
      contentType: 'application/json',
      body: JSON.stringify({
        rows: 1001,
        bytes,
        milliseconds: performance.now() - started,
        localFixtureOnly: true,
      }),
    });
  }
});

test('read-only employee cannot save, create or retry exports in any remaining family', async ({
  page,
}) => {
  await page.goto('/');
  await signIn(page, 'viewer@vista.local');
  await expect(page.locator('.workspace-sidebar')).toBeVisible();
  const token = await page.evaluate(
    () =>
      (
        JSON.parse(sessionStorage.getItem('vista.erp-crm.session.v1') ?? '{}') as {
          sessionToken: string;
        }
      ).sessionToken,
  );
  expect(token).toBeTruthy();
  for (const [scope, definitionKey] of [
    ['finance', 'finance.purchase-journal'],
    ['service', 'service.request-register'],
    ['crm', 'crm.employee-performance'],
    ['pos', 'pos.shift-register'],
  ]) {
    const input = { definitionKey, format: 'csv', dateFrom: '2026-01-15', dateTo: '2026-01-15' };
    for (const [path, data] of [
      ['report-exports', input],
      ['saved-reports', { ...input, id: crypto.randomUUID(), name: 'Denied report' }],
      [`report-exports/${crypto.randomUUID()}/retry`, {}],
    ] as const) {
      const response = await page.request.post(`/api/v1/${scope}/${path}`, {
        headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
        data,
      });
      expect(response.status(), `${scope}/${path}`).toBe(403);
    }
  }
});
