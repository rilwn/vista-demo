import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { signIn } from './sign-in.js';

const prefix = 'BROWSER-LARGE-';
let pool: Pool;
test.beforeAll(async () => {
  const url = new URL(process.env['DATABASE_URL'] ?? '');
  if (
    process.env['VISTA_E2E_ISOLATED'] !== 'true' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '58432' ||
    url.pathname !== '/vista_e2e' ||
    url.username !== 'vista_e2e'
  )
    throw Error('Report fixtures require the disposable browser database.');
  pool = new Pool({ connectionString: url.href });
  const existing = await pool.query<{ count: number }>(
    'SELECT count(*)::integer AS count FROM master_data.products WHERE product_code LIKE $1',
    [prefix + '%'],
  );
  // A restarted Playwright worker reuses only this disposable run's fixtures.
  if (existing.rows[0]?.count) {
    expect(existing.rows[0].count).toBe(1001);
    return;
  }
  // Synthetic reporting fixtures only; this does not post operational inventory.
  const inserted = await pool.query(
    `WITH products AS (
    INSERT INTO master_data.products (product_code, name, category_id, unit_id, created_by, updated_by)
    SELECT $1 || lpad(n::text,4,'0'), 'Large report item ' || n,
      p.category_id, p.unit_id, p.created_by, p.updated_by
    FROM master_data.products p CROSS JOIN generate_series(1,1001) n
    WHERE p.product_code = 'DEV-ADAPTER-12V'
    RETURNING id
  ) INSERT INTO inventory.stock_balances (warehouse_id, product_id, quantity, average_unit_cost_bgn)
    SELECT w.id, p.id, 2, 3 FROM products p CROSS JOIN master_data.warehouses w WHERE w.code = 'WH-CENTRAL'`,
    [prefix],
  );
  expect(inserted.rowCount).toBe(1001);
});
test.afterAll(async () => {
  await pool?.end();
});

async function openReports(page: Page, module: string) {
  await page.locator('.workspace-sidebar').getByRole('link', { name: module, exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Choose an area' })
    .getByRole('link', { name: /^Reports / })
    .click();
  await expect(page.locator('.erp-report-result-heading').first()).toBeVisible();
}
async function tokenFor(page: Page) {
  await expect(page.locator('.workspace-sidebar')).toBeVisible();
  const token = await page.evaluate(
    () =>
      (
        JSON.parse(sessionStorage.getItem('vista.erp-crm.session.v1') ?? '{}') as {
          sessionToken?: string;
        }
      ).sessionToken,
  );
  if (!token) throw Error('Expected a signed-in test account');
  return token;
}

test('large warehouse preview and export preserve every row and filter', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await signIn(page, 'manager@vista.local');
  await openReports(page, 'Warehouse');
  await page.getByLabel('Search report values', { exact: true }).fill(prefix);
  const previewStarted = performance.now();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('.erp-report-result-heading').first()).toContainText(/1,?001/);
  const previewMs = performance.now() - previewStarted;
  await expect(page.locator('.erp-report-results tbody tr')).toHaveCount(25);
  const first = await page.locator('.erp-report-results tbody').innerText();
  const paging = page.locator('.erp-report-pagination');
  await paging.getByRole('button', { name: 'Next', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(paging).toContainText('Page 2 of 41');
  await expect(page.locator('.erp-report-results tbody')).not.toHaveText(first);
  const token = await tokenFor(page);
  const codes: string[] = [];
  const pagingStarted = performance.now();
  for (let number = 1; number <= 41; number++) {
    const response = await page.request.get('/api/v1/erp/reports/warehouse/preview', {
      headers: { Authorization: `Bearer ${token}` },
      params: { definitionKey: 'warehouse.stock-balances', search: prefix, page: number },
    });
    expect(response.status()).toBe(200);
    const result = (await response.json()) as {
      total: number;
      totalPages: number;
      rows: { code: string }[];
    };
    expect(result.total).toBe(1001);
    expect(result.totalPages).toBe(41);
    codes.push(...result.rows.map((row) => row.code));
  }
  expect(new Set(codes).size).toBe(1001);
  expect(codes).toHaveLength(1001);
  const pagingMs = performance.now() - pagingStarted;
  await page.locator('.erp-report-options summary').click();
  await page.getByRole('checkbox', { name: 'Product code', exact: true }).check();
  await page.locator('.erp-report-options summary').click();
  const exportStarted = performance.now();
  await page.getByRole('combobox', { name: 'Search File type', exact: true }).fill('CS');
  await page.getByRole('listbox').getByRole('option', { name: 'CSV', exact: true }).click();
  const submitting = page.waitForResponse(
    (response) =>
      response.url().endsWith('/erp/reports/warehouse/exports') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Prepare export', exact: true }).click();
  const submitted = await submitting;
  expect(submitted.status()).toBe(202);
  expect(submitted.request().postDataJSON()).toMatchObject({ search: prefix, format: 'csv' });
  await expect(page.locator('.erp-report-recent li').first()).toContainText('CSV');
  const download = page
    .locator('.erp-report-recent li')
    .first()
    .getByRole('button', { name: 'Download', exact: true });
  await expect(download).toBeVisible({ timeout: 45000 });
  const pending = page.waitForEvent('download');
  await download.click();
  const file = await pending;
  expect(file.suggestedFilename()).toMatch(/\.csv$/);
  const bytes = await readFile(await file.path());
  const exported = bytes.toString().match(/BROWSER-LARGE-\d{4}/g) ?? [];
  expect(exported.sort()).toEqual([...codes].sort());
  await test.info().attach('local-report-measurements.json', {
    contentType: 'application/json',
    body: JSON.stringify(
      {
        rows: 1001,
        pages: 41,
        previewMs,
        pagingMs,
        exportAndDownloadMs: performance.now() - exportStarted,
        bytes: bytes.length,
        note: 'Local disposable fixture measurements, not production acceptance targets.',
      },
      null,
      2,
    ),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await paging.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await paging.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(paging).toContainText('Page 1 of 41');
  await page.screenshot({ path: test.info().outputPath('large-report-mobile.png') });
});

test('read-only users can read ERP reports but cannot save, export or retry them', async ({
  page,
}) => {
  await page.goto('/');
  await signIn(page, 'viewer@vista.local');
  const token = await tokenFor(page);
  for (const [scope, module, definitionKey] of [
    ['procurement', 'Procurement', 'procurement.order-comparison'],
    ['warehouse', 'Warehouse', 'warehouse.stock-balances'],
    ['sales', 'Sales', 'sales.quotation-register'],
    ['logistics', 'Logistics', 'logistics.deliveries'],
  ]) {
    await openReports(page, module);
    await expect(page.getByRole('button', { name: 'Prepare export', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save as new report', exact: true })).toHaveCount(
      0,
    );
    for (const [suffix, data] of [
      ['exports', { definitionKey, format: 'csv' }],
      ['saved', { id: crypto.randomUUID(), definitionKey, format: 'csv', name: 'Denied report' }],
      [`exports/${crypto.randomUUID()}/retry`, {}],
    ] as const) {
      const response = await page.request.post(`/api/v1/erp/reports/${scope}/${suffix}`, {
        headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
        data,
      });
      expect(response.status(), `${scope}/${suffix} denies read-only changes`).toBe(403);
    }
  }
});
