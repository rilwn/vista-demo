import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { signIn } from './sign-in.js';

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: `Search ${label}`, exact: true }).fill(option);
  await page.getByRole('listbox').getByRole('option', { name: option, exact: true }).click();
}

for (const [scope, module, search] of [
  ['procurement', 'Procurement', 'Demo'],
  ['warehouse', 'Warehouse', 'DEV-ADAPTER-12V'],
  ['sales', 'Sales', 'DEV-Q-0001'],
  ['logistics', 'Logistics', 'Demo'],
] as const) {
  test(`${module} reports preserve filters and download all three formats`, async ({ page }) => {
    test.setTimeout(180000);
    page.setDefaultTimeout(15000);
    await page.goto('/');
    await signIn(page, 'manager@vista.local');
    await page
      .locator('.workspace-sidebar')
      .getByRole('link', { name: module, exact: true })
      .click();
    if (scope === 'logistics') {
      await page
        .getByRole('navigation', { name: 'Choose an area' })
        .getByRole('link', { name: /^Deliveries / })
        .click();
      await page.getByRole('button', { name: 'Plan delivery', exact: true }).click();
      const panel = page.getByRole('dialog');
      const today = new Date().toISOString().slice(0, 10);
      await panel.getByLabel('Starts', { exact: true }).fill(`${today}T14:00`);
      await panel.getByLabel('Ends', { exact: true }).fill(`${today}T15:00`);
      await panel.getByRole('button', { name: 'Plan delivery', exact: true }).click();
      await expect(panel.getByText('Company transport', { exact: true })).toBeVisible();
      await panel.getByRole('button', { name: /Back/ }).first().click();
      await page
        .getByRole('navigation', { name: 'Logistics sections', exact: true })
        .getByRole('link', { name: 'Reports', exact: true })
        .click();
    } else {
      await page
        .getByRole('navigation', { name: 'Choose an area' })
        .getByRole('link', { name: /^Reports / })
        .click();
    }
    await expect(page.locator('.erp-report-result-heading').first()).toContainText(/\d+ records?/);

    // Empty results must be recoverable without losing the filter controls.
    await page.getByLabel('Search report values', { exact: true }).fill('BROWSER-NO-SUCH-RECORD');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByText('No records match these filters.', { exact: true })).toBeVisible();
    await page.getByLabel('Search report values', { exact: true }).fill(search);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.locator('.erp-report-results tbody tr').first()).toBeVisible();

    if (scope !== 'warehouse') {
      const from = page.getByLabel('From', { exact: true });
      const original = await from.inputValue();
      await from.fill('2200-01-01');
      await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
      await expect(page.getByText('Choose a start date on or before the end date.')).toBeVisible();
      await from.fill(original);
    }

    await page.getByText('Customize view', { exact: false }).click();
    await page.getByLabel('Report name', { exact: true }).fill(`Browser ${module} view`);
    await page.getByRole('button', { name: 'Save as new report' }).click();
    await expect(page.getByText('Your report view is saved.')).toBeVisible();
    await page.reload();
    await page.getByText('Customize view', { exact: false }).click();
    await choose(page, 'My saved reports', `Browser ${module} view`);
    await expect(page.getByLabel('Search report values', { exact: true })).toHaveValue(search);
    await expect(page.locator('.erp-report-results tbody tr').first()).toBeVisible();

    for (const [format, label, signature] of [
      ['csv', 'CSV', null],
      ['xlsx', 'Excel', 'PK'],
      ['pdf', 'PDF', '%PDF-'],
    ] as const) {
      await choose(page, 'File type', label);
      const submitting = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/erp/reports/${scope}/exports`) &&
          response.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Prepare export', exact: true }).click();
      const response = await submitting;
      expect(response.ok()).toBe(true);
      const request = response.request().postDataJSON() as { search: string; format: string };
      expect(request.search).toBe(search);
      expect(request.format).toBe(format);
      const row = page.locator('.erp-report-recent li').first();
      await expect(row).toContainText(label);
      await expect(row.getByRole('button', { name: 'Download', exact: true })).toBeVisible({
        timeout: 45000,
      });
      const downloading = page.waitForEvent('download');
      await row.getByRole('button', { name: 'Download', exact: true }).click();
      const download = await downloading;
      expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
      const bytes = await readFile(await download.path());
      expect(bytes.length).toBeGreaterThan(50);
      if (signature) expect(bytes.subarray(0, signature.length).toString()).toBe(signature);
      else expect(bytes.toString()).toContain(scope === 'warehouse' ? search : 'Demo');
    }
    if (scope === 'warehouse') {
      const content = '**/erp/reports/warehouse/exports/*/content';
      await page.route(content, (route) => route.abort('failed'), { times: 1 });
      await page
        .locator('.erp-report-recent li')
        .first()
        .getByRole('button', { name: 'Download', exact: true })
        .click();
      await expect(
        page.getByText('The file could not be downloaded. Select Download to try again.'),
      ).toBeVisible();
      const downloading = page.waitForEvent('download');
      await page
        .locator('.erp-report-recent li')
        .first()
        .getByRole('button', { name: 'Download', exact: true })
        .click();
      expect((await downloading).suggestedFilename()).toMatch(/\.pdf$/);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: test.info().outputPath(`${scope}-reports-desktop.png`),
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.locator('body').evaluate((el) => el.scrollWidth <= window.innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: test.info().outputPath(`${scope}-reports-mobile.png`),
      fullPage: true,
      animations: 'disabled',
    });
  });
}

test('read-only reports hide export actions and the API rejects export creation', async ({
  page,
}) => {
  await page.goto('/');
  await signIn(page, 'viewer@vista.local');
  await page
    .locator('.workspace-sidebar')
    .getByRole('link', { name: 'Warehouse', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Choose an area' })
    .getByRole('link', { name: /^Reports / })
    .click();
  await expect(page.locator('.erp-report-results tbody tr').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare export', exact: true })).toHaveCount(0);
  const token = await page.evaluate(() => {
    const session = JSON.parse(sessionStorage.getItem('vista.erp-crm.session.v1') ?? '{}') as {
      sessionToken?: string;
    };
    return session.sessionToken;
  });
  if (!token) throw Error('Expected an authenticated viewer session');
  const response = await page.request.post('/api/v1/erp/reports/warehouse/exports', {
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    data: { definitionKey: 'warehouse.stock-balances', format: 'csv' },
  });
  expect(response.status()).toBe(403);
  await expect(page.locator('.erp-report-recent')).toContainText('No exports requested yet.');
});
