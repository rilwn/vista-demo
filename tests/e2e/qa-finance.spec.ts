import { expect, test, type Page } from '@playwright/test';
import { signIn } from './sign-in.js';

async function choose(page: Page, label: string, value: string | RegExp) {
  await page
    .getByRole('dialog')
    .getByRole('combobox', { name: `Search ${label}`, exact: true })
    .fill('');
  await page.getByRole('listbox').getByRole('option', { name: value, exact: true }).click();
}

test('foreign rates are explicit and credit notes start from the original invoice', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await signIn(page, 'manager@vista.local');
  await page
    .locator('.workspace-sidebar')
    .getByRole('link', { name: 'Finance', exact: true })
    .click();
  await page.getByRole('link', { name: /Financial documents/ }).click();
  await page.getByRole('button', { name: 'New financial document', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await choose(page, 'Document source', 'Manual document');
  await choose(page, 'Customer', 'Alfa Market Demo Ltd.');
  await choose(page, 'Product or service', /DEV-ADAPTER-12V/);
  await dialog.getByLabel('Unit price', { exact: true }).fill('100');
  await dialog.getByLabel('Currency', { exact: true }).fill('EUR');
  await expect(dialog.getByLabel('BGN exchange rate', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('Rate source', { exact: true })).toHaveValue('');
  await dialog.getByLabel('BGN exchange rate', { exact: true }).fill('1.95583');
  await dialog.getByLabel('Rate source', { exact: true }).fill('QA supplied rate');
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/finance/financial-documents') &&
      response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Prepare draft', exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const invoice = (await response.json()) as { number: string; bgnGrossTotal: string };
  expect(invoice.bgnGrossTotal).toBe('234.6996');
  await expect(dialog.getByText(invoice.number, { exact: true }).first()).toBeVisible();
  await dialog.locator('header').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'New financial document', exact: true }).click();
  await choose(page, 'Document type', 'Credit note');
  await choose(page, 'Original invoice draft', new RegExp(invoice.number));
  await expect(dialog.getByLabel('Unit price', { exact: true })).toHaveValue('100.0000');
  await expect(dialog.getByLabel('Quantity', { exact: true })).toHaveValue('1.0000');
  await expect(dialog.getByLabel('Currency', { exact: true })).toHaveValue('EUR');
  await expect(dialog.getByLabel('BGN exchange rate', { exact: true })).toHaveValue('');
  await dialog.getByLabel('Correction reason', { exact: true }).fill('Return verification');
  await dialog.getByLabel('BGN exchange rate', { exact: true }).fill('1.95583');
  await dialog.getByLabel('Rate source', { exact: true }).fill('QA supplied rate');
  await dialog.getByLabel('Unit price', { exact: true }).fill('1000');
  const rejected = page.waitForResponse(
    (result) =>
      result.url().endsWith('/finance/financial-documents') && result.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Prepare draft', exact: true }).click();
  expect((await rejected).status()).toBe(400);
  await expect(
    dialog.getByText(
      'The credit exceeds the amount remaining on the original invoice. Review earlier credit notes.',
    ),
  ).toBeVisible();
  await dialog.getByLabel('Unit price', { exact: true }).fill('100');
  await page.setViewportSize({ width: 900, height: 720 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('credit-note-tablet.png') });
  await dialog.locator('header').getByRole('button', { name: 'Close', exact: true }).click();

  // Delay, but do not mock, the original-document read. Switching away must
  // not leave a later manual invoice permanently waiting for that old request.
  let releaseRead!: () => void;
  let readStarted!: () => void;
  const heldRead = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const started = new Promise<void>((resolve) => {
    readStarted = resolve;
  });
  const originalUrl = `**/finance/financial-documents/*`;
  await page.route(originalUrl, async (route) => {
    readStarted();
    await heldRead;
    await route.continue();
  });
  try {
    await page.getByRole('button', { name: 'New financial document', exact: true }).click();
    await choose(page, 'Document type', 'Credit note');
    await started;
    await choose(page, 'Document type', 'Invoice');
    await dialog.getByRole('button', { name: 'Add line', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Prepare draft', exact: true })).toBeEnabled();
  } finally {
    releaseRead();
    await page.unrouteAll({ behavior: 'wait' });
  }
  await dialog.locator('header').getByRole('button', { name: 'Close', exact: true }).click();
});

test('notification bell reads the authenticated endpoint without a service error', async ({
  page,
}) => {
  await page.goto('/');
  await signIn(page, 'manager@vista.local');
  const notifications = page.waitForResponse((response) =>
    response.url().includes('/notifications?page=1'),
  );
  await page.getByRole('button', { name: /notifications/i }).click();
  expect((await notifications).status()).toBe(200);
});

test('manual Finance prices use the shared customer price and retain a manually entered price during a delayed lookup', async ({
  page,
}) => {
  await page.goto('/');
  await signIn(page, 'finance@vista.local');
  await page
    .locator('.workspace-sidebar')
    .getByRole('link', { name: 'Finance', exact: true })
    .click();
  await page.getByRole('link', { name: /Financial documents/ }).click();
  await page.getByRole('button', { name: 'New financial document', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await choose(page, 'Document source', 'Manual document');
  await choose(page, 'Customer', 'Alfa Market Demo Ltd.');
  await choose(page, 'Product or service', /DEV-FISCAL-X1/);
  await expect(dialog.getByLabel('Unit price', { exact: true })).toHaveValue('600.0000');
  await dialog.getByLabel('Unit price', { exact: true }).fill('650');
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route('**/finance/financial-documents/prices/resolve?**', async (route) => {
    started();
    await held;
    await route.continue();
  });
  try {
    const nextDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Sofia',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(Date.now() + 86400000));
    await dialog.getByLabel('Document date', { exact: true }).fill(nextDate);
    await requested;
    await dialog.getByLabel('Unit price', { exact: true }).fill('675');
    release();
    await expect(dialog.getByText('Finding customer price…', { exact: true })).toHaveCount(0);
    await expect(dialog.getByLabel('Unit price', { exact: true })).toHaveValue('675');
    await dialog.getByRole('button', { name: 'Use customer price', exact: true }).click();
    await expect(dialog.getByLabel('Unit price', { exact: true })).toHaveValue('600.0000');
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
  await dialog.getByLabel('Currency', { exact: true }).fill('EUR');
  await expect(
    dialog.getByText('No price matches this customer, date and currency. Enter the unit price.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog.getByLabel('Unit price', { exact: true })).toHaveValue('');
  await dialog.locator('header').getByRole('button', { name: 'Close', exact: true }).click();
});

test('a recurring billing period opens in Finance and cannot create a second active draft', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await signIn(page, 'manager@vista.local');
  await page
    .locator('.workspace-sidebar')
    .getByRole('link', { name: 'Sales', exact: true })
    .click();
  await page.getByRole('link', { name: /Service subscriptions/ }).click();
  await page.getByRole('button', { name: 'New contract', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await choose(page, 'Customer', 'Alfa Market Demo Ltd.');
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Sofia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  await dialog.getByLabel('Starts on', { exact: true }).fill(date);
  await dialog.getByLabel('Next invoice date', { exact: true }).fill(date);
  await dialog.getByLabel('Recurring amount', { exact: true }).fill('120');
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/sales/subscriptions') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Create contract', exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const contract = (await response.json()) as { number: string };
  const row = page.locator('.subscription-register-row').filter({ hasText: contract.number });
  // Reload from the UI until the real worker has generated this contract's period.
  await expect(async () => {
    await page.reload();
    await row.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: 'Open in Finance', exact: true }),
    ).toBeVisible();
  }).toPass({ timeout: 30000, intervals: [1500, 3000] });
  await dialog.getByRole('button', { name: 'Open in Finance', exact: true }).click();
  await expect(
    dialog.getByRole('heading', { name: 'New financial document', exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText('Subscription charge', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Currency', { exact: true })).toHaveValue('BGN');
  await page.setViewportSize({ width: 900, height: 720 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('subscription-review-tablet.png') });
  const prepared = page.waitForResponse(
    (result) =>
      result.url().endsWith('/finance/financial-documents') && result.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Prepare draft', exact: true }).click();
  const saved = await prepared;
  expect(saved.status()).toBe(201);
  const invoiceDraft = (await saved.json()) as {
    number: string;
    sourceSubscriptionDraftNumber: string;
    grossTotal: string;
  };
  expect(invoiceDraft.grossTotal).toBe('144.0000');
  await expect(
    dialog.getByText(invoiceDraft.sourceSubscriptionDraftNumber, { exact: true }),
  ).toBeVisible();
  await dialog.locator('header').getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  const billingRow = page.locator('.subscription-finance-row').filter({ hasText: contract.number });
  await expect(billingRow.getByRole('button', { name: 'Review billing', exact: true })).toHaveCount(
    0,
  );
  await billingRow.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(
    dialog.getByRole('heading', { name: invoiceDraft.number, exact: true }),
  ).toBeVisible();
  await dialog.locator('header').getByRole('button', { name: 'Close', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'BG', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Абонаментно фактуриране', exact: true }),
  ).toBeVisible();
  await expect(billingRow.locator('small').nth(1)).toContainText(
    new Intl.DateTimeFormat('bg-BG', {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(new Date(`${date}T00:00:00Z`)),
  );
  await billingRow.getByRole('button', { name: 'Преглед', exact: true }).click();
  await expect(dialog.getByText('Абонаментно фактуриране', { exact: true })).toBeVisible();
});

test('a customer advance can be applied to an open receivable and remains traceable in collections', async ({
  page,
}) => {
  await page.goto('/');
  await signIn(page, 'manager@vista.local');
  await page
    .locator('.workspace-sidebar')
    .getByRole('link', { name: 'Finance', exact: true })
    .click();
  await page.getByRole('link', { name: /^Customer payment accounts/ }).click();

  const customerRow = page
    .locator('.customer-account-row')
    .filter({ hasText: 'Alfa Market Demo Ltd.' });
  await customerRow.getByRole('button', { name: 'Preview', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Alfa Market Demo Ltd.' });
  const receivable = dialog
    .locator('.customer-open-receivable-list article')
    .filter({ hasText: 'DEV-FIN-REV-0001' });
  await receivable.getByRole('button', { name: 'Apply advance', exact: true }).click();

  dialog = page.getByRole('dialog', { name: 'Apply customer advance' });
  await expect(dialog.getByLabel('Amount to apply (BGN)', { exact: true })).toHaveValue('40.0000');
  const allocation = page.waitForResponse(
    (response) =>
      response.url().includes('/finance/documents/') &&
      response.url().endsWith('/advance-allocations') &&
      response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Apply advance', exact: true }).click();
  expect((await allocation).status()).toBe(201);
  await expect(
    page.getByText('DEV-ADV-ALFA-001 was allocated to DEV-FIN-REV-0001.', { exact: true }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Collections & payments', exact: true }).click();
  const collection = page.locator('.finance-register-row').filter({ hasText: 'DEV-FIN-REV-0001' });
  await expect(collection).toContainText('2 payments');
  await collection.getByRole('button', { name: 'Preview', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'DEV-FIN-REV-0001' });
  await expect(dialog.getByText('Advance from DEV-ADV-ALFA-001', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Paid', { exact: true }).first()).toBeVisible();
});

test('a Finance collection source opens its Sales invoice and returns to Finance', async ({
  page,
}) => {
  await page.goto('/');
  await signIn(page, 'manager@vista.local');
  await page
    .locator('.workspace-sidebar')
    .getByRole('link', { name: 'Finance', exact: true })
    .click();
  await page.getByRole('link', { name: /Collections & payments Track partial payments/ }).click();

  const collection = page.locator('.finance-register-row').filter({ hasText: 'DEV-FIN-REV-0001' });
  await collection.getByRole('button', { name: 'Preview', exact: true }).click();
  const financePreview = page.getByRole('dialog', { name: 'DEV-FIN-REV-0001' });
  await expect(financePreview.getByText('DEV-INV-DRAFT-0001', { exact: true })).toBeVisible();
  await financePreview.getByRole('button', { name: 'Open in Sales', exact: true }).click();

  const salesPreview = page.getByRole('dialog', { name: 'DEV-Q-0001' });
  await expect(
    salesPreview.getByRole('heading', { name: 'DEV-INV-DRAFT-0001', exact: true }),
  ).toBeVisible();
  await salesPreview.getByRole('button', { name: 'Back to Finance', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Collections & payments', exact: true }),
  ).toBeVisible();
});
