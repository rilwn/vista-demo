import { expect, test, type Page, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { signIn } from './sign-in.js';

test.use({ actionTimeout: 15000 });

async function choose(page: Page, label: string, value: string) {
  // An exact typed match selects immediately. Keep a partial search so the
  // option click remains meaningful even when selection remounts the panel.
  await page
    .getByRole('combobox', { name: `Search ${label}`, exact: true })
    .fill(value.slice(0, -1));
  await page.getByRole('listbox').getByRole('option', { name: value, exact: true }).click();
}

async function downloadFile(page: Page, row: Locator, format: string) {
  await expect(row.getByRole('button', { name: 'Download', exact: true })).toBeVisible({
    timeout: 45000,
  });
  const downloading = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Download', exact: true }).click();
  const file = await downloading;
  expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
  const bytes = await readFile(await file.path());
  expect(bytes.length).toBeGreaterThan(50);
  if (format === 'pdf') expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  if (format === 'xlsx') expect(bytes.subarray(0, 2).toString()).toBe('PK');
  if (format === 'csv') expect(bytes.toString()).not.toMatch(/<!doctype|<html/i);
}

for (const [scope, module, area] of [
  ['finance', 'Finance', 'Finance reports'],
  ['service', 'Service', 'Service reports'],
  ['crm', 'Customers & CRM', 'CRM analytics'],
] as const) {
  test(`${module} saved report exports survive reopening and reject another account`, async ({
    page,
    browser,
  }) => {
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
    if (scope === 'finance') await choose(page, 'Report', 'Supplier turnover');
    await panel.getByLabel('From', { exact: true }).fill('2020-01-01');
    await panel.getByLabel('Save these options', { exact: true }).fill(`Browser ${scope} report`);
    await panel.getByRole('button', { name: 'Save as new report' }).click();
    await expect(page.getByText(/Report saved\./)).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Export report', exact: true }).click();
    await choose(page, 'My saved reports', `Browser ${scope} report`);
    await expect(panel.getByLabel('Save these options', { exact: true })).toHaveValue(
      `Browser ${scope} report`,
    );
    await expect(panel.getByLabel('From', { exact: true })).toHaveValue('2020-01-01');
    let exportId = '';
    for (const format of ['csv', 'xlsx', 'pdf']) {
      await panel.locator(`input[type="radio"][value="${format}"]`).check();
      const submitted = page.waitForResponse(
        (r) => r.url().endsWith(`/${scope}/report-exports`) && r.request().method() === 'POST',
      );
      await panel.getByRole('button', { name: 'Prepare export', exact: true }).click();
      const response = await submitted;
      expect(response.ok()).toBe(true);
      exportId = ((await response.json()) as { id: string }).id;
      expect(exportId).toMatch(/^[\da-f-]{36}$/);
      const row = panel.locator('.report-export-list article').first();
      await expect(row.locator('.report-export-file-mark')).toHaveText(format.toUpperCase());
      await downloadFile(page, row, format);
    }
    await expect(page.getByRole('button', { name: 'Dismiss message', exact: true })).toHaveCount(
      0,
      { timeout: 10000 },
    );
    await panel.locator('.security-drawer-body').evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({
      path: test.info().outputPath(`${scope}-export-desktop.png`),
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.locator('.security-drawer-body').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(
      panel.getByRole('button', { name: 'Prepare export', exact: true }),
    ).toBeInViewport();
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`${scope}-export-mobile.png`),
      animations: 'disabled',
    });

    const other = await browser.newContext({ baseURL: 'http://127.0.0.1:5373' });
    try {
      const second = await other.newPage();
      await second.goto('/');
      await signIn(
        second,
        scope === 'finance'
          ? 'finance@vista.local'
          : scope === 'service'
            ? 'dispatcher@vista.local'
            : 'crm@vista.local',
      );
      await expect(second.locator('.workspace-sidebar')).toBeVisible();
      const token = await second.evaluate(
        () =>
          (
            JSON.parse(sessionStorage.getItem('vista.erp-crm.session.v1') ?? '{}') as {
              sessionToken: string;
            }
          ).sessionToken,
      );
      if (!token) throw Error('Expected a signed-in second employee');
      const headers = { Authorization: `Bearer ${token}` };
      const permitted = await second.request.get(`/api/v1/${scope}/report-exports/definitions`, {
        headers,
      });
      expect(permitted.status()).toBe(200);
      const privateList = await second.request.get(`/api/v1/${scope}/report-exports`, { headers });
      expect(privateList.status()).toBe(200);
      expect(
        ((await privateList.json()) as { items: { id: string }[] }).items.some(
          (item) => item.id === exportId,
        ),
      ).toBe(false);
      const denied = await second.request.get(
        `/api/v1/${scope}/report-exports/${exportId}/content`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect([403, 404]).toContain(denied.status());
    } finally {
      await other.close();
    }
  });
}

test('POS downloads period reports in all formats', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('http://127.0.0.1:5374/');
  await signIn(page, 'pos.operator@vista.local');
  await page
    .getByRole('navigation', { name: 'POS navigation' })
    .getByRole('link', { name: 'Reports', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
  await page.getByLabel('From', { exact: true }).fill('2020-01-01');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByText('Saved reports & export fields', { exact: true }).click();
  await page.getByLabel('Report name', { exact: true }).fill('Browser POS period');
  await page.getByRole('button', { name: 'Save as new report', exact: true }).click();
  await expect(page.getByText('Report saved. Open it again from My saved reports.')).toBeVisible();
  await page.reload();
  await page.getByText('Saved reports & export fields', { exact: true }).click();
  await choose(page, 'My saved reports', 'Browser POS period');
  await expect(page.getByLabel('From', { exact: true })).toHaveValue('2020-01-01');
  for (const format of ['csv', 'xlsx', 'pdf']) {
    await page
      .locator('.pos-export-buttons')
      .getByRole('button', { name: format.toUpperCase(), exact: true })
      .click();
    const row = page.locator('.pos-export-list article').first();
    await expect(row.locator('.pos-export-format')).toHaveText(format.toUpperCase());
    await downloadFile(page, row, format);
  }
  await page.screenshot({
    path: test.info().outputPath('pos-reports-desktop.png'),
    animations: 'disabled',
  });
});

test('central report library exports a saved view and runs a pausable schedule', async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto('/');
  await signIn(page, 'manager@vista.local');
  const sidebar = page.locator('.workspace-sidebar');
  await sidebar.getByRole('link', { name: 'Warehouse', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Choose an area' })
    .getByRole('link', { name: /^Reports / })
    .click();
  await page.getByText('Customize view', { exact: false }).click();
  await page.getByLabel('Report name', { exact: true }).fill('Browser scheduled stock');
  await page.getByRole('button', { name: 'Save as new report' }).click();
  await expect(page.getByText('Your report view is saved.')).toBeVisible();
  await sidebar.getByRole('link', { name: 'Reports', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Choose an area' })
    .getByRole('link', { name: /^Report library / })
    .click();
  await page.getByLabel('Find a report', { exact: true }).fill('NO-SUCH-REPORT');
  await expect(page.getByText('No reports match your search.')).toBeVisible();
  await page.getByLabel('Find a report', { exact: true }).fill('');
  await page
    .locator('.hub-list li')
    .filter({ hasText: 'Browser scheduled stock' })
    .getByRole('button', { name: 'Review saved view' })
    .click();
  const panel = page.getByRole('dialog');
  await panel.getByRole('button', { name: 'Prepare export · Excel', exact: true }).click();
  await downloadFile(page, panel, 'xlsx');
  await panel.getByRole('button', { name: 'Schedule this view', exact: true }).click();
  await panel.getByLabel('Schedule name', { exact: true }).fill('Browser daily stock');
  const todayInSofia = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Sofia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const yesterday = new Date(`${todayInSofia}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  await panel
    .getByLabel('First run', { exact: true })
    .fill(`${yesterday.toISOString().slice(0, 10)}T23:30`);
  await panel.getByRole('button', { name: 'Create schedule', exact: true }).click();
  await expect(panel.getByText('Your schedule is saved.')).toBeVisible();
  await panel.getByRole('link', { name: 'Scheduled exports', exact: true }).click();
  const schedule = page.locator('.hub-list li').filter({ hasText: 'Browser daily stock' });
  await schedule.getByRole('button', { name: 'Run history', exact: true }).click();
  await downloadFile(page, panel, 'xlsx');
  await page.screenshot({
    path: test.info().outputPath('scheduled-report-desktop.png'),
    animations: 'disabled',
  });
  await panel.locator('footer').getByRole('button', { name: 'Back', exact: true }).click();
  await schedule.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(schedule).toContainText('Paused');
  await page.reload();
  await expect(schedule).toContainText('Paused');
  await schedule.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(schedule).toContainText('Active');
  // Leave the disposable schedule paused after verifying both transitions.
  await schedule.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(schedule).toContainText('Paused');
});
