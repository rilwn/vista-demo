import { expect, test, type Page, type Locator } from '@playwright/test';
import type { PosSale } from '@vista/contracts';
import { signIn } from './sign-in.js';

test.use({ baseURL: 'http://127.0.0.1:5374', actionTimeout: 15000 });
test.setTimeout(120000);

const basketFor = (page: Page) => page.getByRole('complementary', { name: 'Current sale basket' });
const navFor = (page: Page) => page.getByRole('navigation', { name: 'POS navigation' });
async function start(page: Page) {
  await page.goto('/');
  await signIn(page, 'pos.operator@vista.local');
  await navFor(page).getByRole('link', { name: 'Shifts', exact: true }).click();
  await page.getByLabel('Opening cash', { exact: false }).fill('100');
  await page.getByRole('button', { name: 'Open cashier shift', exact: true }).click();
}
async function customer(page: Page) {
  await basketFor(page)
    .getByRole('button', { name: /^(Add customer|Change)$/ })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('Company, UIC, or VAT number').fill('Alfa');
  await dialog.getByRole('button', { name: /Alfa Market Demo Ltd/ }).click();
  await dialog.getByRole('radio', { name: /Alfa Market.*Central Store/ }).check();
  await dialog.getByRole('button', { name: 'Use customer', exact: true }).click();
}
async function product(page: Page, code: string) {
  await page.getByLabel('Search or scan', { exact: true }).fill(code);
  await page.getByRole('button', { name: new RegExp(`^${code} `) }).click();
}
async function choose(page: Page, scope: Locator, field: string, option: RegExp | string) {
  await scope.getByRole('combobox', { name: `Search ${field}`, exact: true }).fill('');
  await page.getByRole('listbox').getByRole('option', { name: option, exact: true }).click();
}
async function number(page: Page) {
  return page
    .getByRole('dialog')
    .locator('.pos-receipt-summary > div')
    .filter({ has: page.getByText('Sale', { exact: true }) })
    .locator('dd')
    .innerText();
}
async function closeShift(page: Page, amount = '100') {
  await navFor(page).getByRole('link', { name: 'Shifts', exact: true }).click();
  await expect(
    page.locator('.pos-current-shift dl > div').filter({ hasText: 'Expected cash' }).locator('dd'),
  ).toHaveText(`${amount}.00 BGN`);
  await page.getByLabel('Counted cash', { exact: false }).fill(amount);
  await page.getByRole('button', { name: 'Close cashier shift', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open cashier shift', exact: true })).toBeVisible();
}
async function beginReturn(page: Page, saleNumber: string) {
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Start next sale', exact: true })
    .click();
  await navFor(page).getByRole('link', { name: 'Returns', exact: true }).click();
  await page
    .locator('.pos-returnable-list article')
    .filter({ hasText: saleNumber })
    .getByRole('button', { name: 'Start return', exact: true })
    .click();
}

test('card-paid bundle with a fixed discount restores earned and redeemed loyalty points on return', async ({
  page,
}) => {
  await start(page);
  await customer(page);
  await product(page, 'DEV-ROLL-80');
  const basket = basketFor(page);
  const startingPoints = Number(
    (await basket.getByRole('button', { name: /reward points/ }).innerText()).match(
      /(\d+) reward points/,
    )?.[1],
  );
  await choose(
    page,
    basket.locator('article').filter({ hasText: 'DEV-ROLL-80' }),
    'Batch',
    /DEMO-ROLL-2028/,
  );
  await product(page, 'DEV-PRINT-HEAD');
  await choose(
    page,
    basket.locator('article').filter({ hasText: 'DEV-PRINT-HEAD' }),
    'Batch',
    /DEMO-HEAD-2028/,
  );
  await expect(basket).toContainText('Print care bundle');
  await basket.getByRole('button', { name: /^Manual discount/ }).click();
  const dialog = page.getByRole('dialog');
  await choose(page, dialog, 'Discount type', 'Fixed amount');
  await dialog.getByRole('spinbutton', { name: 'Amount (BGN)', exact: true }).fill('2');
  await dialog
    .getByRole('textbox', { name: 'Reason', exact: true })
    .fill('Approved print care discount');
  await dialog.getByRole('textbox', { name: 'Email', exact: true }).fill('manager@vista.local');
  await dialog.getByLabel('Password', { exact: true }).fill('Vista-Browser-Test-7!');
  await dialog.getByRole('button', { name: 'Approve discount', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await basket.getByLabel('Points to use', { exact: true }).fill('100');
  await basket.getByRole('button', { name: 'Bank card', exact: true }).click();
  const complete = basket.getByRole('button', { name: /^Complete sale/ });
  await expect(complete).toContainText('83.40 BGN');
  await complete.click();
  await expect(dialog).toContainText('Sale complete');
  const saleNumber = await number(page);
  await expect(
    dialog
      .locator('.pos-receipt-summary > div')
      .filter({ has: page.getByText('Bank card', { exact: true }) })
      .locator('dd'),
  ).toHaveText('83.40 BGN');
  await beginReturn(page, saleNumber);
  await dialog.getByRole('checkbox', { name: /Demo Receipt Roll 80 mm/ }).check();
  await dialog.getByRole('checkbox', { name: /Demo Thermal Print Head/ }).check();
  await dialog
    .getByRole('textbox', { name: 'Reason for return', exact: true })
    .fill('Both unused items returned together.');
  await page.screenshot({ path: test.info().outputPath('discounted-return.png') });
  await dialog.getByRole('button', { name: /^Complete return/ }).click();
  await expect(dialog).toContainText('Return complete');
  await expect(dialog).toContainText('83.40 BGN');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await navFor(page).getByRole('link', { name: 'Sell', exact: true }).click();
  await page.reload();
  await customer(page);
  await product(page, 'DEV-ADAPTER-12V');
  await basket.getByRole('button', { name: /reward points/ }).click();
  await expect(dialog.locator('.pos-loyalty-balance')).toContainText(`${startingPoints} points`);
  const entries = dialog.locator('.pos-loyalty-history article');
  await expect(entries.filter({ hasText: saleNumber })).toHaveCount(2);
  await expect(entries.locator('.is-credit').filter({ hasText: /^\+100/ })).toHaveCount(1);
  await expect(entries.locator('.is-debit').filter({ hasText: /^-83/ })).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Close rewards', exact: true }).click();
  await closeShift(page);
});

test('repairable serial return moves to Service custody and remains linked in Operations', async ({
  page,
  browser,
}) => {
  await start(page);
  await customer(page);
  await product(page, 'DEV-FISCAL-X1');
  const basket = basketFor(page);
  await choose(page, basket, 'Serial number', 'DEMO-FR-STOCK-02');
  await basket.getByRole('button', { name: 'Bank card', exact: true }).click();
  await basket.getByRole('button', { name: /^Complete sale/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Sale complete');
  const saleNumber = await number(page);
  await beginReturn(page, saleNumber);
  await dialog.getByRole('checkbox', { name: /Demo Fiscal Register X1/ }).check();
  await choose(page, dialog, 'Send item to', 'Send to Service for inspection');
  await dialog
    .getByRole('textbox', { name: 'Reason for return', exact: true })
    .fill('Device display failed. Send for inspection.');
  await dialog.getByRole('button', { name: /^Complete return/ }).click();
  await expect(dialog).toContainText('Return complete');
  await expect(dialog).toContainText(saleNumber);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.pos-return-history').filter({ hasText: saleNumber })).toContainText(
    'Sent to Service',
  );
  await closeShift(page);
  const context = await browser.newContext();
  try {
    const operations = await context.newPage();
    await operations.goto('http://127.0.0.1:5373/');
    await signIn(operations, 'manager@vista.local');
    await operations
      .locator('.workspace-sidebar')
      .getByRole('link', { name: 'Warehouse', exact: true })
      .click();
    await operations.getByRole('link', { name: /Reservations & serial trace/ }).click();
    await operations.getByLabel('Serial number', { exact: true }).fill('DEMO-FR-STOCK-02');
    await operations.getByRole('button', { name: 'Trace serial', exact: true }).click();
    await expect(operations.locator('.trace-summary')).toContainText('Demo Service Warehouse');
    await expect(operations.locator('.trace-summary')).toContainText('Under repair');
    await expect(operations.locator('.trace-timeline')).toContainText(saleNumber);
    await operations.screenshot({ path: test.info().outputPath('service-serial-trace.png') });
  } finally {
    await context.close();
  }
});

test('lost sale acknowledgement survives reload and recovers one committed receipt', async ({
  page,
}) => {
  await start(page);
  await product(page, 'DEV-ADAPTER-12V');
  const basket = basketFor(page);
  await basket.getByLabel('Cash received', { exact: true }).fill('60');
  let committed: PosSale | undefined;
  let posts = 0;
  // The real server commits the sale. Only its response to the browser is lost.
  await page.route('**/api/v1/pos/sales', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    committed = (await response.json()) as PosSale;
    await route.abort('connectionfailed');
  });
  const lookup = '**/api/v1/pos/sales/by-transaction/*';
  await page.route(lookup, (route) => route.abort('connectionfailed'));
  await basket.getByRole('button', { name: /^Complete sale/ }).click();
  await expect(page.getByText('1 checkout awaiting confirmation', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('1 checkout awaiting confirmation', { exact: true })).toBeVisible();
  await navFor(page).getByRole('link', { name: 'Shifts', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Close cashier shift', exact: true }),
  ).toBeDisabled();
  await navFor(page).getByRole('link', { name: 'Recovery', exact: true }).click();
  await page.unroute(lookup);
  await page.reload();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(committed!.fiscalReceiptNumber);
  expect(posts).toBe(1);
  await page.screenshot({ path: test.info().outputPath('recovered-receipt.png') });
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByText('1 checkout awaiting confirmation', { exact: true })).toHaveCount(0);
  await navFor(page).getByRole('link', { name: 'Sale history', exact: true }).click();
  await page.reload();
  await expect(
    page.locator('.pos-sale-history article').filter({ hasText: committed!.saleNumber }),
  ).toHaveCount(1);
  await closeShift(page, '160');
});
