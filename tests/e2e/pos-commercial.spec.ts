import { expect, test, type Page } from '@playwright/test';
import { signIn } from './sign-in.js';

test.use({ baseURL: 'http://127.0.0.1:5374', actionTimeout: 15000 });
test.setTimeout(120000);

async function openShift(page: Page) {
  await page.goto('/');
  await signIn(page, 'pos.operator@vista.local');
  await page
    .getByRole('navigation', { name: 'POS navigation' })
    .getByRole('link', { name: 'Shifts', exact: true })
    .click();
  await page.getByLabel('Opening cash', { exact: false }).fill('100');
  await page.getByRole('button', { name: 'Open cashier shift', exact: true }).click();
}

async function chooseCustomer(page: Page) {
  await page
    .getByRole('complementary', { name: 'Current sale basket' })
    .getByRole('button', { name: /^(Add customer|Change)$/ })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('Company, UIC, or VAT number').fill('Alfa');
  await dialog.getByRole('button', { name: /Alfa Market Demo Ltd/ }).click();
  await dialog.getByRole('button', { name: 'Use customer', exact: true }).click();
}

async function addAdapter(page: Page) {
  await page.getByLabel('Search or scan', { exact: true }).fill('DEV-ADAPTER-12V');
  await page.getByRole('button', { name: /DEV-ADAPTER-12V.*Demo 12 V Power Adapter/ }).click();
}

async function closeShift(page: Page, cash: string) {
  await page
    .getByRole('navigation', { name: 'POS navigation' })
    .getByRole('link', { name: 'Shifts', exact: true })
    .click();
  await expect(
    page.locator('.pos-current-shift dl > div').filter({ hasText: 'Expected cash' }).locator('dd'),
  ).toHaveText(`${cash}.00 BGN`);
  await page.getByLabel('Counted cash', { exact: false }).fill(cash);
  await page.getByRole('button', { name: 'Close cashier shift', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open cashier shift', exact: true })).toBeVisible();
}

test('quantity offer, separately approved discount and loyalty settle through split payment', async ({
  page,
}) => {
  await openShift(page);
  await chooseCustomer(page);
  await addAdapter(page);
  const basket = page.getByRole('complementary', { name: 'Current sale basket' });
  const rewards = basket.getByRole('button', { name: /reward points/ });
  const startingPoints = Number((await rewards.innerText()).match(/(\d+) reward points/)?.[1]);
  expect(startingPoints).toBeGreaterThanOrEqual(100);
  await basket
    .getByRole('button', { name: 'Increase Demo 12 V Power Adapter quantity', exact: true })
    .click();
  await expect(basket).toContainText('Two adapters save 10%');
  await basket.getByRole('button', { name: /^Manual discount/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('spinbutton', { name: 'Percentage', exact: true }).fill('10');
  await dialog
    .getByRole('textbox', { name: 'Reason', exact: true })
    .fill('Approved customer goodwill discount');
  await dialog
    .getByRole('textbox', { name: 'Email', exact: true })
    .fill('pos.operator@vista.local');
  await dialog.getByLabel('Password', { exact: true }).fill('Vista-Browser-Test-7!');
  await dialog.getByRole('button', { name: 'Approve discount', exact: true }).click();
  await expect(dialog).toContainText('A different authorized employee must approve this discount');
  await dialog.getByRole('textbox', { name: 'Email', exact: true }).fill('manager@vista.local');
  await dialog.getByRole('button', { name: 'Approve discount', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(basket).toContainText('Manual discount approved');
  await basket.getByLabel('Points to use', { exact: true }).fill('100');
  const complete = basket.getByRole('button', { name: /^Complete sale/ });
  await expect(complete).toContainText('96.00 BGN');
  await basket.getByRole('button', { name: 'Split', exact: true }).click();
  await basket.getByLabel('Cash portion', { exact: true }).fill('40');
  await basket.getByLabel('Cash received', { exact: true }).fill('30');
  await expect(complete).toBeDisabled();
  await basket.getByLabel('Cash received', { exact: true }).fill('50');
  await expect(basket.locator('.pos-split-summary')).toContainText('56.00 BGN');
  await complete.click();
  await expect(dialog).toContainText('Sale complete');
  const summary = dialog.locator('.pos-receipt-summary');
  await expect(
    summary
      .locator(':scope > div')
      .filter({ has: page.getByText('Cash', { exact: true }) })
      .locator('dd'),
  ).toHaveText('40.00 BGN');
  await expect(
    summary
      .locator(':scope > div')
      .filter({ has: page.getByText('Bank card', { exact: true }) })
      .locator('dd'),
  ).toHaveText('56.00 BGN');
  await expect(summary).toContainText('10.00 BGN');
  const saleNumber = await summary
    .locator(':scope > div')
    .filter({ has: page.getByText('Sale', { exact: true }) })
    .locator('dd')
    .innerText();
  await dialog.getByRole('button', { name: 'Start next sale', exact: true }).click();
  await page.reload();
  await chooseCustomer(page);
  await addAdapter(page);
  await basket.getByRole('button', { name: /reward points/ }).click();
  await expect(dialog.locator('.pos-loyalty-balance')).toContainText(
    `${startingPoints - 100 + 96} points`,
  );
  const entries = dialog.locator('.pos-loyalty-history article').filter({ hasText: saleNumber });
  await expect(entries).toHaveCount(2);
  await expect(entries.filter({ hasText: '+96' })).toHaveCount(1);
  await expect(entries.filter({ hasText: '-100' })).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Close rewards', exact: true }).click();
  await closeShift(page, '140');
});

test('customer advance and contracted credit retain their separate balances after reload', async ({
  page,
}, testInfo) => {
  await openShift(page);
  await chooseCustomer(page);
  await addAdapter(page);
  const basket = page.getByRole('complementary', { name: 'Current sale basket' });
  await basket.getByRole('button', { name: 'Advance / account', exact: true }).click();
  await basket.getByLabel('Use from advance', { exact: true }).fill('81');
  const complete = basket.getByRole('button', { name: /^Complete sale/ });
  await expect(complete).toBeDisabled();
  await expect(basket.getByLabel('Use from advance', { exact: true })).toHaveValue('81');
  await expect(basket.locator('#customer-advance-amount-error')).toHaveText(
    'The amount is higher than the available advance.',
  );
  await basket.getByLabel('Use from advance', { exact: true }).fill('61');
  await expect(complete).toBeDisabled();
  await expect(basket.locator('#customer-advance-amount-error')).toHaveText(
    'The advance amount cannot exceed the sale total.',
  );
  await expect(basket.getByText('The advance covers the full sale.')).toHaveCount(0);
  await basket.locator('#customer-advance-amount-error').scrollIntoViewIfNeeded();
  await expect(basket.locator('#customer-advance-amount-error')).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('advance-validation.png') });
  await basket.getByLabel('Use from advance', { exact: true }).fill('20');
  await basket.getByRole('button', { name: 'On account', exact: true }).click();
  await expect(basket).toContainText('Pay remaining 40.00 BGN by');
  await complete.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Sale complete');
  await expect(
    dialog
      .locator('.pos-receipt-summary > div')
      .filter({ has: page.getByText('Customer advance', { exact: true }) })
      .locator('dd'),
  ).toHaveText('20.00 BGN');
  await expect(
    dialog
      .locator('.pos-receipt-summary > div')
      .filter({ has: page.getByText('On account', { exact: true }) })
      .locator('dd'),
  ).toHaveText('40.00 BGN');
  await dialog.getByRole('button', { name: 'Start next sale', exact: true }).click();
  await page.reload();
  await chooseCustomer(page);
  await addAdapter(page);
  await basket.getByRole('button', { name: 'Advance / account', exact: true }).click();
  await expect(basket.locator('.pos-customer-payment')).toContainText('60.00 BGN');
  await basket.getByLabel('Use from advance', { exact: true }).fill('0');
  await expect(basket.locator('.pos-customer-payment')).toContainText('1,960.00 BGN');
  await basket.getByRole('button', { name: 'Remove Demo 12 V Power Adapter', exact: true }).click();
  await closeShift(page, '100');
});
