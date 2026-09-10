import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { signIn } from './sign-in.js';

test('POS retains older exports, safely retries a lost response and allows a fresh report', async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto('http://127.0.0.1:5374/');
  await signIn(page, 'pos.operator@vista.local');
  await page
    .getByRole('navigation', { name: 'POS navigation' })
    .getByRole('link', { name: 'Reports', exact: true })
    .click();
  const csv = page.locator('.pos-export-buttons').getByRole('button', { name: 'CSV', exact: true });
  let firstId = '';
  const keys: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname.endsWith('/pos/report-exports')
    )
      keys.push(request.headers()['idempotency-key']);
  });
  await page.route(
    '**/pos/report-exports',
    async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      const committed = await route.fetch();
      expect(committed.ok()).toBe(true);
      firstId = ((await committed.json()) as { id: string }).id;
      await route.abort('failed');
    },
    { times: 1 },
  );
  await csv.click();
  await expect.poll(() => firstId).not.toBe('');
  await expect(csv).toBeEnabled();
  const retried = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/pos/report-exports'),
  );
  await csv.click();
  expect(((await (await retried).json()) as { id: string }).id).toBe(firstId);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  const history = page.locator('.pos-recent-exports');
  await expect(history.getByRole('button', { name: 'Download', exact: true })).toHaveCount(1, {
    timeout: 45000,
  });
  for (const tab of [
    'Cashiers',
    'Products',
    'Categories',
    'Payments',
    'Locations',
    'Compare locations',
  ]) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    // A preceding success toast can cover the top-right export controls.
    // Wait for its normal dismissal before clicking the next report action.
    await expect(page.getByRole('button', { name: 'Dismiss message' })).toHaveCount(0, {
      timeout: 15000,
    });
    const sent = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/pos/report-exports'),
    );
    await csv.click();
    expect((await sent).ok()).toBe(true);
    await expect(
      history.locator('article').first().getByRole('button', { name: 'Download', exact: true }),
    ).toBeVisible({ timeout: 45000 });
  }
  await history.getByRole('button', { name: 'Next exports' }).click();
  await expect(history).toContainText('Page 2 of 2');
  await expect(history.locator('article')).toHaveCount(1);
  await expect(history.locator('article')).toContainText('Shift register');
  const downloading = page.waitForEvent('download');
  await history.getByRole('button', { name: 'Download', exact: true }).click();
  const file = await downloading;
  expect(file.suggestedFilename()).toMatch(/\.csv$/);
  expect((await readFile(await file.path())).length).toBeGreaterThan(50);
  await page.screenshot({
    path: test.info().outputPath('pos-older-exports.png'),
    animations: 'disabled',
  });
  await page.getByRole('tab', { name: 'Shifts', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Dismiss message' })).toHaveCount(0, {
    timeout: 15000,
  });
  const fresh = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/pos/report-exports'),
  );
  await csv.click();
  const freshId = ((await (await fresh).json()) as { id: string }).id;
  expect(freshId).not.toBe(firstId);
  await expect(history).toContainText('Page 1 of 2');
  await expect(history.locator('article').first()).toContainText('Shift register');
  await expect(page.getByRole('button', { name: 'Dismiss message' })).toHaveCount(0, {
    timeout: 15000,
  });
  const repeated = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/pos/report-exports'),
  );
  await csv.click();
  expect(((await (await repeated).json()) as { id: string }).id).not.toBe(freshId);
  await page.setViewportSize({ width: 768, height: 1024 });
  await history.scrollIntoViewIfNeeded();
  expect(await page.locator('body').evaluate((el) => el.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: test.info().outputPath('pos-export-history-tablet.png'),
    animations: 'disabled',
  });
});
