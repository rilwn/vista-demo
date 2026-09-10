import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { signIn } from './sign-in.js';

for (const [scope, module, area] of [
  ['finance', 'Finance', 'Finance reports'],
  ['service', 'Service', 'Service reports'],
  ['crm', 'Customers & CRM', 'CRM analytics'],
] as const) {
  test(`${module} pages older exports and recovers a history load failure`, async ({ page }) => {
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
    const openingHistory = page.waitForResponse(
      (r) => r.request().method() === 'GET' && r.url().includes(`/${scope}/report-exports?`),
    );
    await page.getByRole('button', { name: 'Export report', exact: true }).click();
    const initialHistory = await openingHistory;
    expect(initialHistory.status()).toBe(200);
    const initialTotal = ((await initialHistory.json()) as { total: number }).total;
    const totalPages = Math.ceil((initialTotal + 7) / 6);
    const panel = page.getByRole('dialog');
    const history = panel.getByRole('region', { name: 'Recent exports' });
    if (scope === 'finance') {
      await page
        .getByRole('combobox', { name: 'Search Report', exact: true })
        .fill('Supplier turn');
      await page
        .getByRole('listbox')
        .getByRole('option', { name: 'Supplier turnover', exact: true })
        .click();
    }
    await panel.getByLabel('From', { exact: true }).fill('2020-01-01');
    await panel.locator('input[type="radio"][value="csv"]').check();
    const ids = new Set<string>();
    for (let i = 0; i < 7; i++) {
      const response = page.waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().endsWith(`/${scope}/report-exports`),
      );
      await panel.getByRole('button', { name: 'Prepare export', exact: true }).click();
      const result = await response;
      expect(result.ok()).toBe(true);
      ids.add(((await result.json()) as { id: string }).id);
      await expect(history.locator('article')).toHaveCount(Math.min(initialTotal + i + 1, 6));
    }
    expect(ids.size).toBe(7);
    await history.getByRole('button', { name: 'Next exports' }).click();
    await expect(history).toContainText(`Page 2 of ${totalPages}`);
    await expect(history.locator('article')).toHaveCount(Math.min(initialTotal + 1, 6));
    const download = history
      .locator('article')
      .first()
      .getByRole('button', { name: 'Download', exact: true });
    await expect(download).toBeVisible({ timeout: 45000 });
    const pending = page.waitForEvent('download');
    await download.click();
    const file = await pending;
    expect((await readFile(await file.path())).length).toBeGreaterThan(50);
    await page.route(`**/${scope}/report-exports?*`, (route) => route.abort('failed'), {
      times: 1,
    });
    await history.getByRole('button', { name: 'Refresh' }).click();
    await expect(history.getByRole('alert')).toContainText('Select Refresh');
    await history.getByRole('button', { name: 'Refresh' }).click();
    await expect(download).toBeVisible();
    await expect(history).toContainText(`Page 2 of ${totalPages}`);
    await page.setViewportSize({ width: 768, height: 1024 });
    await history.scrollIntoViewIfNeeded();
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`${scope}-export-paging.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    await history.scrollIntoViewIfNeeded();
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const previous = history.getByRole('button', { name: 'Previous exports' });
    await previous.focus();
    await page.keyboard.press('Enter');
    await expect(history).toContainText(`Page 1 of ${totalPages}`);
    await history.getByRole('button', { name: 'Next exports' }).click();
    await expect(history).toContainText(`Page 2 of ${totalPages}`);
    await page.screenshot({ path: test.info().outputPath(`${scope}-export-paging-phone.png`) });
    await panel.getByRole('button', { name: 'Prepare export', exact: true }).click();
    await expect(history).toContainText(`Page 1 of ${Math.ceil((initialTotal + 8) / 6)}`);
  });
}
