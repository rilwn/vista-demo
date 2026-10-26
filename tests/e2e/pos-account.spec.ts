import { expect, test } from '@playwright/test';
import type { FinancialDocument } from '@vista/contracts';
import { signIn } from './sign-in.js';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { fixtureId } from '../../apps/api/src/database/development-fixtures.js';

test('Finance collects deferred POS credit, replays a lost response, reverses a mistake and settles in Bulgarian on mobile', async ({
  page,
  context,
}, testInfo) => {
  const pos = await context.newPage();
  await prepareTestApprover();
  await pos.goto('http://127.0.0.1:5374/');
  await signIn(pos, 'pos.operator@vista.local');
  const nav = pos.getByRole('navigation', { name: 'POS navigation' });
  await nav.getByRole('link', { name: 'Shifts', exact: true }).click();
  await pos.getByLabel('Opening cash', { exact: false }).fill('100');
  await pos.getByRole('button', { name: 'Open cashier shift', exact: true }).click();
  await pos.getByLabel('Search or scan', { exact: true }).fill('DEV-ADAPTER-12V');
  await pos.getByRole('button', { name: /DEV-ADAPTER-12V.*Demo 12 V Power Adapter/ }).click();
  const basket = pos.getByRole('complementary', { name: 'Current sale basket' }),
    receipt = pos.getByRole('dialog');
  await basket.getByRole('button', { name: 'Add customer', exact: true }).click();
  await receipt.getByPlaceholder('Company, UIC, or VAT number').fill('Alfa');
  await receipt.getByRole('button', { name: /Alfa Market Demo Ltd/ }).click();
  await receipt.getByRole('radio', { name: /Alfa Market.*Central Store/ }).check();
  await receipt.getByRole('button', { name: 'Use customer', exact: true }).click();
  await basket.getByRole('button', { name: 'Advance / account', exact: true }).click();
  const advance = basket.getByLabel('Use from advance', { exact: true });
  if (await advance.count()) await advance.fill('0');
  await basket.getByRole('button', { name: 'On account', exact: true }).click();
  await basket.getByRole('button', { name: /^Complete sale/ }).click();
  await expect(receipt).toContainText('Sale complete');
  const saleNumber = await receipt
    .locator('.pos-receipt-summary > div')
    .filter({ has: pos.getByText('Sale', { exact: true }) })
    .locator('dd')
    .innerText();
  const prepared = pos.waitForResponse(
    (response) =>
      response.url().endsWith('/invoice-draft') && response.request().method() === 'POST',
  );
  await receipt.getByRole('button', { name: 'Prepare invoice', exact: true }).click();
  const invoice = (await (await prepared).json()) as FinancialDocument;
  await receipt.getByRole('button', { name: 'Start next sale', exact: true }).click();
  await page.goto('/');
  await signIn(page, 'manager@vista.local');
  await page
    .locator('.workspace-sidebar')
    .getByRole('link', { name: 'Finance', exact: true })
    .click();
  await page.getByRole('link', { name: /^Financial documents/ }).click();
  await page
    .locator('.financial-document-register-row')
    .filter({ hasText: invoice.number })
    .getByRole('button', { name: 'Preview', exact: true })
    .click();
  const panel = page.getByRole('dialog');
  await panel
    .getByRole('checkbox', {
      name: 'I have checked the parties, dates, currency, amounts and VAT details.',
      exact: true,
    })
    .check();
  const issued = page.waitForResponse(
    (response) => response.url().endsWith('/issue') && response.request().method() === 'POST',
  );
  await panel.getByRole('button', { name: 'Issue document', exact: true }).click();
  const official = (await (await issued).json()) as FinancialDocument;
  await panel.getByRole('button', { name: 'Open customer account', exact: true }).click();
  const row = panel.locator('.pos-account-sale').filter({ hasText: saleNumber });
  await row.getByRole('button', { name: 'Collect payment', exact: true }).click();
  await panel.getByLabel('Amount (EUR)', { exact: true }).fill('10');
  await panel
    .getByLabel('Payment reference (optional)', { exact: true })
    .fill('DEMO-POS-CREDIT-10');
  await panel
    .getByRole('checkbox', {
      name: 'I have checked the amount, payment method and source sale.',
      exact: true,
    })
    .check();
  const footer = await panel.locator('.pos-account-payment-actions').boundingBox(),
    bounds = await panel.boundingBox();
  expect(Math.abs(footer!.x - bounds!.x)).toBeLessThan(3);
  expect(bounds!.width - footer!.width).toBeLessThan(4);
  await page.screenshot({ path: testInfo.outputPath('pos-account-collect-desktop.png') });
  await expect(panel.getByRole('button', { name: 'Record payment', exact: true })).toBeEnabled();
  let loseResponse = true;
  const keys: string[] = [];
  await page.route('**/pos-sales/*/payments', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key'] ?? '');
    if (loseResponse) {
      loseResponse = false;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort('failed');
    } else await route.continue();
  });
  await panel.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('The payment could not be saved.');
  await expect(panel.getByLabel('Amount (EUR)', { exact: true })).toHaveValue('10');
  await panel.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(row.locator('.pos-account-history > article')).toHaveCount(1);
  expect(keys.length).toBe(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[0]).toBe(keys[1]);
  await expect(row.locator('.pos-account-amounts dd')).toHaveText([
    '30.68 EUR',
    '0.00 EUR',
    '10.00 EUR',
    '20.68 EUR',
  ]);
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('pos-account-history-desktop.png') });
  await panel.locator('.panel-back-button').click();
  await expect(
    panel.getByRole('heading', { name: official.officialNumber!, exact: true }),
  ).toBeVisible();
  await expect(panel.getByRole('region', { name: 'POS payments', exact: true })).toContainText(
    'Collected after checkout: 10.00 EUR',
  );
  await panel.getByRole('button', { name: 'Open customer account', exact: true }).click();
  await row.getByRole('button', { name: 'Reverse payment', exact: true }).click();
  await panel
    .getByLabel('Reason for reversal', { exact: true })
    .fill('Payment was recorded against the wrong bank transfer');
  await panel
    .getByRole('checkbox', {
      name: 'I have checked the amount, payment method and source sale.',
      exact: true,
    })
    .check();
  await panel.getByRole('button', { name: 'Reverse payment', exact: true }).click();
  await expect(row.locator('.pos-account-history')).toContainText('Reversed');
  await expect(row.locator('.pos-account-amounts dd')).toHaveText([
    '30.68 EUR',
    '0.00 EUR',
    '0.00 EUR',
    '30.68 EUR',
  ]);
  await panel.locator('.panel-back-button').click();
  await panel.locator('.panel-close-button').click();
  await page.getByRole('button', { name: 'BG', exact: true }).click();
  await page
    .locator('.financial-document-register-row')
    .filter({ hasText: official.officialNumber! })
    .getByRole('button', { name: 'Преглед', exact: true })
    .click();
  await panel.getByRole('button', { name: 'Отвори клиентската сметка', exact: true }).click();
  await row.getByRole('button', { name: 'Запис на плащане', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await panel
    .getByRole('checkbox', {
      name: 'Проверих сумата, начина на плащане и първоначалната продажба.',
      exact: true,
    })
    .check();
  await panel.locator('.pos-account-payment-scroll').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const mobileFooter = await panel.locator('.pos-account-payment-actions').boundingBox(),
    mobileBounds = await panel.boundingBox();
  expect(mobileBounds!.width - mobileFooter!.width).toBeLessThan(4);
  expect(
    mobileBounds!.y + mobileBounds!.height - mobileFooter!.y - mobileFooter!.height,
  ).toBeLessThan(3);
  await page.screenshot({ path: testInfo.outputPath('pos-account-collect-bg-mobile.png') });
  await panel.getByRole('button', { name: 'Запази плащането', exact: true }).click();
  await expect(row.locator('.finance-status')).toHaveText('Платено');
  await expect(row.locator('.pos-account-amounts dd')).toHaveText([
    '30,68 EUR',
    '0,00 EUR',
    '30,68 EUR',
    '0,00 EUR',
  ]);
  await row.scrollIntoViewIfNeeded();
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('pos-account-history-bg-mobile.png') });
  await nav.getByRole('link', { name: 'Shifts', exact: true }).click();
  await pos.getByLabel('Counted cash', { exact: false }).fill('100');
  await pos.getByRole('button', { name: 'Close cashier shift', exact: true }).click();
  await expect(pos.getByRole('button', { name: 'Open cashier shift', exact: true })).toBeVisible();
  await pos.close();
});

async function prepareTestApprover() {
  const url = new URL(process.env['DATABASE_URL'] ?? '');
  if (
    process.env['VISTA_E2E_ISOLATED'] !== 'true' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '58432' ||
    url.pathname !== '/vista_e2e' ||
    url.username !== 'vista_e2e'
  )
    throw new Error('Approval fixture requires the disposable browser database');
  const pool = new Pool({ connectionString: url.href });
  try {
    const role = randomUUID();
    await pool.query(
      "INSERT INTO iam.roles(id,code,name) VALUES($1,$2,'POS collection test approver')",
      [role, `pos-collection-${role}`],
    );
    const permission = (
      await pool.query<{ id: string }>(
        `INSERT INTO iam.permissions(id,module,action) VALUES($1,'erp.finance','approve')
      ON CONFLICT(module,action) DO UPDATE SET module=excluded.module RETURNING id`,
        [randomUUID()],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO iam.role_permissions(role_id,permission_id) VALUES($1,$2)', [
      role,
      permission,
    ]);
    await pool.query('INSERT INTO iam.account_roles(account_id,role_id) VALUES($1,$2)', [
      fixtureId('account:manager'),
      role,
    ]);
  } finally {
    await pool.end();
  }
}
