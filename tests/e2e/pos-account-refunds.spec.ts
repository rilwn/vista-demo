import { expect, test } from '@playwright/test';
import type { FinancialDocument, PosReturn } from '@vista/contracts';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { fixtureId } from '../../apps/api/src/database/development-fixtures.js';
import { signIn } from './sign-in.js';

test('a collected POS return releases debt, links its credit note and repays once in English and Bulgarian', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120000);
  await approver();
  const pos = await context.newPage();
  await pos.goto('http://127.0.0.1:5374/');
  await signIn(pos, 'pos.operator@vista.local');
  const nav = pos.getByRole('navigation', { name: 'POS navigation' }),
    dialog = pos.getByRole('dialog');
  await nav.getByRole('link', { name: 'Shifts', exact: true }).click();
  await pos.getByLabel('Opening cash', { exact: false }).fill('100');
  await pos.getByRole('button', { name: 'Open cashier shift', exact: true }).click();
  await pos.getByLabel('Search or scan', { exact: true }).fill('DEV-ADAPTER-12V');
  await pos.getByRole('button', { name: /DEV-ADAPTER-12V.*Demo 12 V Power Adapter/ }).click();
  const basket = pos.getByRole('complementary', { name: 'Current sale basket' });
  await basket.getByRole('button', { name: 'Add customer', exact: true }).click();
  await dialog.getByPlaceholder('Company, UIC, or VAT number').fill('Alfa');
  await dialog.getByRole('button', { name: /Alfa Market Demo Ltd/ }).click();
  await dialog.getByRole('radio', { name: /Alfa Market.*Central Store/ }).check();
  await dialog.getByRole('button', { name: 'Use customer', exact: true }).click();
  await basket.getByRole('button', { name: 'Advance / account', exact: true }).click();
  const advance = basket.getByLabel('Use from advance', { exact: true });
  if (await advance.count()) await advance.fill('0');
  await basket.getByRole('button', { name: 'On account', exact: true }).click();
  await basket.getByRole('button', { name: /^Complete sale/ }).click();
  const saleNumber = await dialog
    .locator('.pos-receipt-summary > div')
    .filter({ has: pos.getByText('Sale', { exact: true }) })
    .locator('dd')
    .innerText();
  const prepared = pos.waitForResponse(
    (r) => r.url().endsWith('/invoice-draft') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Prepare invoice', exact: true }).click();
  const invoice = (await (await prepared).json()) as FinancialDocument;
  await dialog.getByRole('button', { name: 'Start next sale', exact: true }).click();
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
  await panel.getByRole('button', { name: 'Issue document', exact: true }).click();
  await panel.getByRole('button', { name: 'Open customer account', exact: true }).click();
  const row = panel.locator('.pos-account-sale').filter({ hasText: saleNumber });
  await row.getByRole('button', { name: 'Collect payment', exact: true }).click();
  await panel.getByLabel('Amount (EUR)', { exact: true }).fill('10');
  await panel
    .getByLabel('Payment reference (optional)', { exact: true })
    .fill('QA-RETURN-COLLECTION');
  await panel
    .getByRole('checkbox', {
      name: 'I have checked the amount, payment method and source sale.',
      exact: true,
    })
    .check();
  await panel.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(row).toContainText('QA-RETURN-COLLECTION');
  await nav.getByRole('link', { name: 'Returns', exact: true }).click();
  await pos
    .locator('.pos-returnable-list article')
    .filter({ hasText: saleNumber })
    .getByRole('button', { name: 'Start return', exact: true })
    .click();
  await dialog.getByRole('checkbox', { name: /Demo 12 V Power Adapter/ }).check();
  await expect(dialog).toContainText('Finance records any repayment');
  const returned = pos.waitForResponse(
    (r) => r.url().endsWith('/pos/returns') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: /^Complete return/ }).click();
  const result = (await (await returned).json()) as PosReturn;
  await page.reload();
  await page
    .locator('.customer-account-row')
    .filter({ hasText: 'Alfa Market Demo Ltd.' })
    .getByRole('button', { name: 'Preview', exact: true })
    .click();
  const credit = panel
    .locator('.pos-account-return-credit')
    .filter({ hasText: result.returnNumber });
  await expect(credit).toContainText('10.00 EUR');
  await expect(credit.getByRole('button', { name: 'Record repayment', exact: true })).toHaveCount(
    0,
  );
  await credit.getByRole('button', { name: 'Prepare credit note', exact: true }).click();
  await expect(panel).toContainText('Credit note');
  await panel
    .getByRole('checkbox', {
      name: 'I have checked the parties, dates, currency, amounts and VAT details.',
      exact: true,
    })
    .check();
  await panel.getByRole('button', { name: 'Issue document', exact: true }).click();
  await panel.locator('.panel-back-button').click();
  await expect(credit.getByRole('button', { name: 'Record repayment', exact: true })).toBeVisible();
  await credit.getByRole('button', { name: 'Record repayment', exact: true }).click();
  await panel.getByLabel('Repayment amount (EUR)', { exact: true }).fill('4');
  await panel.getByLabel('Repayment reference', { exact: true }).fill('QA-REPAY-4');
  await panel
    .getByRole('checkbox', {
      name: 'I confirm the customer has received this repayment and the reference is correct.',
      exact: true,
    })
    .check();
  const bounds = await panel.boundingBox(),
    footer = await panel.locator('.pos-account-payment-actions').boundingBox();
  expect(Math.abs(bounds!.x - footer!.x)).toBeLessThan(3);
  expect(Math.abs(bounds!.width - footer!.width)).toBeLessThan(4);
  await page.screenshot({ path: testInfo.outputPath('repayment-desktop-en.png') });
  let lose = true;
  const keys: string[] = [];
  await page.route('**/returns/*/refunds', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key'] ?? '');
    if (lose) {
      lose = false;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort('failed');
    } else await route.continue();
  });
  await panel.getByRole('button', { name: 'Record repayment', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('could not be saved');
  await panel.getByRole('button', { name: 'Record repayment', exact: true }).click();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await expect(credit).toContainText('6.00 EUR');
  await expect(credit.locator('.pos-account-history > article')).toHaveCount(1);
  await panel.locator('.panel-close-button').click();
  await page.getByRole('button', { name: 'BG', exact: true }).click();
  await page
    .locator('.customer-account-row')
    .filter({ hasText: 'Alfa Market Demo Ltd.' })
    .getByRole('button', { name: 'Преглед', exact: true })
    .click();
  await expect(page.getByText('The customer repayment was recorded.')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await credit.getByRole('button', { name: 'Запис на възстановена сума', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Запис на възстановена сума' })).toBeVisible();
  await panel.getByLabel('Основание за възстановяване', { exact: true }).fill('QA-REPAY-FINAL');
  await panel
    .getByRole('checkbox', {
      name: 'Потвърждавам, че клиентът е получил тази сума и основанието е правилно.',
      exact: true,
    })
    .check();
  const mobile = await panel.boundingBox(),
    actions = await panel.locator('.pos-account-payment-actions').boundingBox();
  expect(Math.abs(mobile!.width - actions!.width)).toBeLessThan(4);
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('repayment-mobile-bg.png') });
  await panel.getByRole('button', { name: 'Запиши възстановяването', exact: true }).click();
  await expect(credit).toContainText('Няма сума за възстановяване');
  await expect(credit.locator('.pos-account-history > article')).toHaveCount(2);
  await pos.getByRole('button', { name: 'Done', exact: true }).click();
  await nav.getByRole('link', { name: 'Shifts', exact: true }).click();
  await expect(pos.locator('.pos-current-shift')).toContainText('100.00 EUR');
  await pos.getByLabel('Counted cash', { exact: false }).fill('100');
  await pos.getByRole('button', { name: 'Close cashier shift', exact: true }).click();
});

async function approver() {
  const url = new URL(process.env['DATABASE_URL'] ?? '');
  if (
    process.env['VISTA_E2E_ISOLATED'] !== 'true' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '58432' ||
    url.pathname !== '/vista_e2e' ||
    url.username !== 'vista_e2e'
  )
    throw Error('Disposable database required');
  const db = new Pool({ connectionString: url.href });
  try {
    const role = randomUUID();
    await db.query('INSERT INTO iam.roles(id,code,name) VALUES($1,$2,$3)', [
      role,
      `refund-${role}`,
      'POS refund test approver',
    ]);
    const permission = (
      await db.query<{ id: string }>(
        `INSERT INTO iam.permissions(id,module,action) VALUES($1,'erp.finance','approve') ON CONFLICT(module,action) DO UPDATE SET module=excluded.module RETURNING id`,
        [randomUUID()],
      )
    ).rows[0].id;
    await db.query('INSERT INTO iam.role_permissions(role_id,permission_id) VALUES($1,$2)', [
      role,
      permission,
    ]);
    await db.query('INSERT INTO iam.account_roles(account_id,role_id) VALUES($1,$2)', [
      fixtureId('account:manager'),
      role,
    ]);
  } finally {
    await db.end();
  }
}
