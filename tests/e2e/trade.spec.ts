import { expect, test, type Page } from '@playwright/test';
import { signIn } from './sign-in.js';

test.use({ actionTimeout: 15000 });

async function choose(page: Page, field: string, option: string | RegExp) {
  await page.getByRole('combobox', { name: `Search ${field}`, exact: true }).fill('');
  await page.getByRole('listbox').getByRole('option', { name: option, exact: true }).click();
}

test('received serial reaches handover and its collection is settled in two payments', async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await page.goto('/');
  await signIn(page, 'manager@vista.local');
  const sidebar = page.locator('.workspace-sidebar');
  await sidebar.getByRole('link', { name: 'Procurement', exact: true }).click();
  await page.getByRole('link', { name: /Purchase orders/ }).click();
  await page.getByRole('button', { name: 'New purchase order', exact: true }).click();
  await choose(page, 'Supplier', 'TechSupply Demo Ltd.');
  await choose(page, 'Receiving warehouse', 'Demo Central Warehouse');
  await choose(page, 'Product', /Demo Fiscal Register X1/);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Quantity', { exact: true }).fill('2');
  await dialog.getByLabel('Unit price', { exact: true }).fill('500');
  await dialog
    .getByLabel('Expected delivery', { exact: true })
    .fill(new Date().toISOString().slice(0, 10));
  await dialog.getByRole('button', { name: 'Save order', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const order = page
    .locator('.procurement-order-card')
    .filter({ hasText: 'Demo Fiscal Register X1' });
  await expect(order).toHaveCount(1);
  const orderRef = (await order.locator('.procurement-order-id').innerText()).replace('PO · ', '');
  for (const [index, serial] of ['BROWSER-FR-001', 'BROWSER-FR-002'].entries()) {
    await order.getByRole('button', { name: 'Receive delivery' }).click();
    const included = dialog.getByRole('checkbox', { name: /Demo Fiscal Register X1/ });
    await included.uncheck();
    await expect(dialog.getByLabel('Quantity', { exact: true })).toBeDisabled();
    await included.check();
    await dialog.getByLabel('Quantity', { exact: true }).fill('1');
    await dialog.getByLabel('Supplier delivery reference').fill(`BROWSER-DELIVERY-${index + 1}`);
    await dialog.getByLabel('Serial numbers, one per line').fill(serial);
    await dialog.getByRole('button', { name: 'Receive delivery', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(order.locator('.procurement-status')).toHaveText(
      index === 0 ? 'Part received' : 'Received',
    );
  }
  await page.getByRole('link', { name: 'Goods receipts', exact: true }).click();
  await expect(page.getByText(/BROWSER-DELIVERY-1/)).toBeVisible();
  await expect(page.getByText(/BROWSER-DELIVERY-2/)).toBeVisible();
  await page.getByRole('link', { name: 'Supplier invoices', exact: true }).click();
  await page.getByRole('button', { name: 'Record supplier invoice', exact: true }).click();
  await choose(page, 'Purchase order', new RegExp(orderRef));
  await dialog.getByLabel('Supplier invoice number').fill('BROWSER-SUPPLIER-001');
  await dialog.getByRole('button', { name: 'Record invoice', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole('article')
    .filter({ hasText: 'BROWSER-SUPPLIER-001' })
    .getByRole('button', { name: /Preview/ })
    .click();
  await expect(dialog.getByText('Matched', { exact: true })).toBeVisible();
  await expect(dialog.locator('.supplier-invoice-preview-quantities strong')).toHaveText([
    '2.0000',
    '2.0000',
    '2.0000',
  ]);
  await expect(dialog.getByText('VAT details are complete', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Back to procurement list' }).click();

  await sidebar.getByRole('link', { name: 'Sales', exact: true }).click();
  await page.getByRole('link', { name: /Quotations/ }).click();
  await page.getByRole('button', { name: 'New quotation', exact: true }).click();
  await choose(page, 'Customer', 'Alfa Market Demo Ltd.');
  await choose(page, 'Warehouse', 'Demo Central Warehouse');
  await choose(page, 'Product', /Demo Fiscal Register X1/);
  await dialog.getByLabel('Quantity', { exact: true }).fill('1');
  await dialog.getByLabel('Unit price (BGN)', { exact: true }).fill('600');
  await dialog.getByRole('button', { name: 'Create quotation', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page
    .locator('.sales-register-row')
    .filter({ has: page.locator('[aria-label="Current stage: Quotation"]') })
    .getByRole('button', { name: 'Preview' })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Confirm order and reserve stock' }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'BROWSER-FR-001', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'BROWSER-FR-001', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await dialog.getByRole('button', { name: 'Confirm order and reserve stock' }).click();
  await dialog.getByRole('button', { name: 'Complete shipment' }).click();
  await choose(page, 'Receiving location', /Alfa Market.*Central Store/);
  await dialog.getByLabel('Customer representative', { exact: true }).fill('Browser Test Customer');
  await dialog.getByRole('button', { name: 'Record customer acceptance' }).click();
  await expect(dialog.getByText('Accepted by Browser Test Customer')).toBeVisible();
  await expect(dialog.getByText(/Serial BROWSER-FR-001/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Prepare invoice draft' }).click();
  await expect(dialog.getByText('Ready for final review and issuance in Finance.')).toBeVisible();
  const quotation = await dialog.locator('h2').innerText();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('sales-handover-mobile.png') });
  await dialog.getByRole('button', { name: 'Back to sales list' }).click();
  await page.reload();
  await page
    .getByRole('article')
    .filter({ hasText: quotation })
    .getByRole('button', { name: 'Preview' })
    .click();
  await expect(dialog.getByText('Accepted by Browser Test Customer')).toBeVisible();
  await expect(dialog.getByText('Ready for final review and issuance in Finance.')).toBeVisible();
  const invoiceNumber = await dialog.getByRole('heading', { name: /^INV-DRAFT-/ }).innerText();
  await dialog.getByRole('button', { name: 'Back to sales list' }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await sidebar.getByRole('link', { name: 'Finance', exact: true }).click();
  await page.getByRole('link', { name: /Collections & payments/ }).click();
  await page.getByRole('button', { name: 'Add to collections', exact: true }).click();
  await choose(page, 'Invoice draft', new RegExp(invoiceNumber));
  const due = new Date();
  due.setUTCDate(due.getUTCDate() + 14);
  await dialog.getByLabel('Due date', { exact: true }).fill(due.toISOString().slice(0, 10));
  await dialog.getByRole('button', { name: 'Add record', exact: true }).click();
  await expect(dialog.locator('.finance-status')).toHaveText('Unpaid');
  const collectionNumber = await dialog.locator('h2').innerText();
  await expect(dialog.locator('.finance-balance-grid dd')).toHaveText([
    'BGN 720.00',
    'BGN 0.00',
    'BGN 720.00',
  ]);
  await expect(dialog.locator('.finance-source-row')).toContainText(invoiceNumber);

  for (const [index, amount] of ['200', '520'].entries()) {
    await dialog.getByRole('button', { name: 'Record payment', exact: true }).click();
    const amountField = dialog.getByLabel('Amount (BGN)', { exact: true });
    if (index === 0) {
      await amountField.fill('721');
      await dialog.getByRole('button', { name: 'Record payment', exact: true }).click();
      expect(await amountField.evaluate((el: HTMLInputElement) => el.validity.rangeOverflow)).toBe(
        true,
      );
      await expect(
        dialog.getByRole('heading', { name: 'Record payment', exact: true }),
      ).toBeVisible();
    }
    await amountField.fill(amount);
    await choose(page, 'Method', 'Bank transfer');
    await dialog
      .getByLabel('Reference (optional)', { exact: true })
      .fill(`BROWSER-PAYMENT-${index + 1}`);
    if (index === 0) {
      await page.context().setOffline(true);
      try {
        await dialog.getByRole('button', { name: 'Record payment', exact: true }).click();
        await expect(dialog.getByText('The service is unavailable', { exact: true })).toBeVisible();
        await expect(amountField).toHaveValue('200');
        await expect(dialog.getByLabel('Reference (optional)', { exact: true })).toHaveValue(
          'BROWSER-PAYMENT-1',
        );
      } finally {
        await page.context().setOffline(false);
      }
    }
    await dialog.getByRole('button', { name: 'Record payment', exact: true }).click();
    await expect(dialog.locator('.finance-status')).toHaveText(
      index === 0 ? 'Partially paid' : 'Paid',
    );
    await expect(dialog.locator('.finance-balance-grid dd')).toHaveText(
      index === 0
        ? ['BGN 720.00', 'BGN 200.00', 'BGN 520.00']
        : ['BGN 720.00', 'BGN 720.00', 'BGN 0.00'],
    );
  }
  await expect(dialog.getByRole('button', { name: 'Record payment', exact: true })).toHaveCount(0);
  await expect(dialog.locator('.finance-payment-list > div')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Back to finance list' }).click();
  await page.reload();
  await page
    .getByRole('article')
    .filter({ hasText: collectionNumber })
    .getByRole('button', { name: 'Preview', exact: true })
    .click();
  await expect(dialog.locator('.finance-status')).toHaveText('Paid');
  await expect(dialog.locator('.finance-payment-list > div')).toHaveCount(2);
  await expect(dialog.getByText('Ref. BROWSER-PAYMENT-1', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Ref. BROWSER-PAYMENT-2', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('paid-collection-mobile.png') });
});
