import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { signIn } from './sign-in.js';

test.use({ baseURL: 'http://127.0.0.1:5374', actionTimeout: 15000 });

test('cashier sells a serialised device, reopens its documents, returns it and balances the shift', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto('/');
  await signIn(page, 'pos.operator@vista.local');
  const nav = page.getByRole('navigation', { name: 'POS navigation' });
  await nav.getByRole('link', { name: 'Shifts', exact: true }).click();
  await page.getByLabel('Opening cash', { exact: false }).fill('100');
  await page.getByRole('button', { name: 'Open cashier shift', exact: true }).click();
  await page.getByLabel('Search or scan', { exact: true }).fill('DEV-FISCAL-X1');
  const stockBefore = (
    await page.getByRole('button', { name: /DEV-FISCAL-X1.*Demo Fiscal Register X1/ }).innerText()
  ).match(/(\d+) PCS available/)?.[1];
  expect(stockBefore).toBeTruthy();
  await page.getByRole('button', { name: /DEV-FISCAL-X1.*Demo Fiscal Register X1/ }).click();
  const basket = page.getByRole('complementary', { name: 'Current sale basket' });
  const complete = basket.getByRole('button', { name: /^Complete sale/ });
  await expect(complete).toBeDisabled();
  await basket.getByRole('button', { name: 'Add customer', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('Company, UIC, or VAT number').fill('Alfa');
  await dialog.getByRole('button', { name: /Alfa Market Demo Ltd/ }).click();
  await dialog.getByRole('radio', { name: /Alfa Market.*Central Store/ }).check();
  await dialog.getByRole('button', { name: 'Use customer', exact: true }).click();
  await basket
    .getByRole('combobox', { name: 'Search Serial number', exact: true })
    .fill('DEMO-FR-STOCK-01');
  await page
    .getByRole('listbox')
    .getByRole('option', { name: 'DEMO-FR-STOCK-01', exact: true })
    .click();
  await basket.getByLabel('Cash received', { exact: true }).fill('750');
  await expect(complete).toContainText('720.00');
  await complete.scrollIntoViewIfNeeded();
  await expect(complete).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await complete.click();
  await expect(dialog).toContainText('No certified fiscal receipt was issued.');
  const saleNumber = await dialog
    .locator('.pos-receipt-summary > div')
    .filter({ has: page.getByText('Sale', { exact: true }) })
    .locator('dd')
    .innerText();
  await expect(dialog.locator('.pos-receipt-summary')).toContainText('30.00');
  await expect(dialog.getByRole('region', { name: 'Warranty cards' })).toContainText(
    'DEMO-FR-STOCK-01',
  );
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const download = await downloadPromise;
  expect(await download.failure()).toBeNull();
  const file = await download.path();
  expect(file).toBeTruthy();
  expect((await readFile(file)).subarray(0, 5).toString()).toBe('%PDF-');
  await dialog.getByRole('button', { name: 'Prepare invoice', exact: true }).click();
  const invoiceNumber = await dialog.locator('.pos-receipt-document-ready strong').innerText();
  await dialog.getByRole('button', { name: 'Start next sale', exact: true }).click();
  await nav.getByRole('link', { name: 'Sale history', exact: true }).click();
  await page.reload();
  const sale = page.locator('.pos-sale-history article').filter({ hasText: saleNumber });
  await sale.getByRole('button', { name: 'View receipt', exact: true }).click();
  await expect(dialog.locator('.pos-receipt-document-ready strong')).toHaveText(invoiceNumber);
  await expect(dialog.getByRole('button', { name: 'Prepare invoice', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await nav.getByRole('link', { name: 'Returns', exact: true }).click();
  await page
    .locator('.pos-returnable-list article')
    .filter({ hasText: saleNumber })
    .getByRole('button', { name: 'Start return', exact: true })
    .click();
  await dialog.getByRole('checkbox', { name: /Demo Fiscal Register X1/ }).check();
  await expect(
    dialog.getByRole('checkbox', { name: 'DEMO-FR-STOCK-01', exact: true }),
  ).toBeChecked();
  await dialog
    .getByRole('textbox', { name: 'Reason for return', exact: true })
    .fill('Customer returned the unused device.');
  await dialog.getByRole('button', { name: /^Complete return/ }).click();
  await expect(dialog).toContainText('Return complete');
  await expect(dialog).toContainText(saleNumber);
  await expect(dialog).toContainText('720.00');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.pos-return-history')).toContainText('Restocked');
  await nav.getByRole('link', { name: 'Sale history', exact: true }).click();
  await expect(sale).toContainText('Fully returned');
  await nav.getByRole('link', { name: 'Sell', exact: true }).click();
  await page.getByLabel('Search or scan', { exact: true }).fill('DEV-FISCAL-X1');
  await expect(
    page.getByRole('button', { name: /DEV-FISCAL-X1.*Demo Fiscal Register X1/ }),
  ).toContainText(`${stockBefore} PCS available`);
  await nav.getByRole('link', { name: 'Shifts', exact: true }).click();
  await expect(
    page.locator('.pos-current-shift dl > div').filter({ hasText: 'Expected cash' }).locator('dd'),
  ).toHaveText('100.00 BGN');
  await page.getByLabel('Counted cash', { exact: false }).fill('100');
  await page.getByRole('button', { name: 'Close cashier shift', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open cashier shift', exact: true })).toBeVisible();
});
