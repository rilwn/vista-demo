import { expect, test } from '@playwright/test';
import type { FinancialDocument } from '@vista/contracts';
import { signIn } from './sign-in.js';

test('POS receipts reconcile on Finance invoices without another collection, including returns and deferred credit', async ({
  page,
  context,
}, testInfo) => {
  const pos = await context.newPage();
  await pos.goto('http://127.0.0.1:5374/');
  await signIn(pos, 'pos.operator@vista.local');
  const nav = pos.getByRole('navigation', { name: 'POS navigation' });
  await nav.getByRole('link', { name: 'Shifts', exact: true }).click();
  await pos.getByLabel('Opening cash', { exact: false }).fill('100');
  await pos.getByRole('button', { name: 'Open cashier shift', exact: true }).click();
  const receipt = pos.getByRole('dialog');
  const basket = pos.getByRole('complementary', { name: 'Current sale basket' });
  async function sell(onAccount = false) {
    await nav.getByRole('link', { name: 'Sell', exact: true }).click();
    await pos.getByLabel('Search or scan', { exact: true }).fill('DEV-ADAPTER-12V');
    await pos.getByRole('button', { name: /DEV-ADAPTER-12V.*Demo 12 V Power Adapter/ }).click();
    await basket.getByRole('button', { name: /^(Add customer|Change)$/ }).click();
    await receipt.getByPlaceholder('Company, UIC, or VAT number').fill('Alfa');
    await receipt.getByRole('button', { name: /Alfa Market Demo Ltd/ }).click();
    await receipt.getByRole('radio', { name: /Alfa Market.*Central Store/ }).check();
    await receipt.getByRole('button', { name: 'Use customer', exact: true }).click();
    if (onAccount) {
      await basket.getByRole('button', { name: 'Advance / account', exact: true }).click();
      const advanceAmount = basket.getByLabel('Use from advance', { exact: true });
      if (await advanceAmount.count()) await advanceAmount.fill('0');
      await basket.getByRole('button', { name: 'On account', exact: true }).click();
    } else await basket.getByLabel('Cash received', { exact: true }).fill('50');
    await basket.getByRole('button', { name: /^Complete sale/ }).click();
    await expect(receipt).toContainText('Sale complete');
    const saleNumber = await receipt
      .locator('.pos-receipt-summary > div')
      .filter({ has: pos.getByText('Sale', { exact: true }) })
      .locator('dd')
      .innerText();
    const prepared = pos.waitForResponse(
      (result) => result.url().endsWith('/invoice-draft') && result.request().method() === 'POST',
    );
    await receipt.getByRole('button', { name: 'Prepare invoice', exact: true }).click();
    const response = await prepared;
    expect(response.status()).toBe(201);
    const invoice = (await response.json()) as FinancialDocument;
    await receipt.getByRole('button', { name: 'Start next sale', exact: true }).click();
    return { invoice, saleNumber };
  }
  async function returnSale(saleNumber: string) {
    await nav.getByRole('link', { name: 'Returns', exact: true }).click();
    await pos
      .locator('.pos-returnable-list article')
      .filter({ hasText: saleNumber })
      .getByRole('button', { name: 'Start return', exact: true })
      .click();
    await receipt.getByRole('checkbox', { name: /Demo 12 V Power Adapter/ }).check();
    await receipt
      .getByRole('textbox', { name: 'Reason for return', exact: true })
      .fill('Returned for invoice payment review');
    await receipt.getByRole('button', { name: /^Complete return/ }).click();
    await expect(receipt).toContainText('Return complete');
    await receipt.getByRole('button', { name: 'Done', exact: true }).click();
  }
  await page.goto('/');
  await signIn(page, 'finance@vista.local');
  await page
    .locator('.workspace-sidebar')
    .getByRole('link', { name: 'Finance', exact: true })
    .click();
  await page.getByRole('link', { name: /^Financial documents/ }).click();
  const panel = page.getByRole('dialog');
  const section = panel.getByRole('region', { name: 'POS payments', exact: true });
  const open = async (number: string) =>
    page
      .locator('.financial-document-register-row')
      .filter({ hasText: number })
      .getByRole('button', { name: 'Preview', exact: true })
      .click();
  const close = async () =>
    panel
      .locator('.panel-drawer-header')
      .getByRole('button', { name: 'Close', exact: true })
      .click();
  const issue = async () => {
    await panel
      .getByRole('checkbox', {
        name: 'I have checked the parties, dates, currency, amounts and VAT details.',
        exact: true,
      })
      .check();
    const issued = page.waitForResponse(
      (result) => result.url().endsWith('/issue') && result.request().method() === 'POST',
    );
    await panel.getByRole('button', { name: 'Issue document', exact: true }).click();
    const response = await issued;
    expect(response.status()).toBe(200);
    return (await response.json()) as FinancialDocument;
  };
  const cash = await sell();
  await page.reload();
  await open(cash.invoice.number);
  await expect(section.locator('.finance-status')).toHaveText('Paid');
  await expect(section.locator('.pos-invoice-balances dd')).toHaveText([
    '30.68 EUR',
    '30.68 EUR',
    '0.00 EUR',
    '0.00 EUR',
  ]);
  const issued = await issue();
  await expect(
    panel.getByRole('button', { name: 'Collections & payments', exact: true }),
  ).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Record payment', exact: true })).toHaveCount(0);
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('pos-invoice-paid-desktop.png') });
  await pos.reload();
  await nav.getByRole('link', { name: 'Sale history', exact: true }).click();
  await pos
    .locator('.pos-sale-history article')
    .filter({ hasText: cash.saleNumber })
    .getByRole('button', { name: 'View receipt', exact: true })
    .click();
  await expect(receipt.locator('.pos-receipt-document-ready strong')).toHaveText(
    issued.officialNumber!,
  );
  await expect(
    receipt.getByRole('region', { name: 'Receipt documents', exact: true }),
  ).toContainText('Issued');
  await receipt.getByRole('button', { name: 'Back', exact: true }).click();
  await returnSale(cash.saleNumber);
  await page.reload();
  await open(issued.officialNumber!);
  await expect(section).toContainText('Returned in full');
  await expect(section.locator('.pos-invoice-balances dd')).toHaveText([
    '30.68 EUR',
    '30.68 EUR',
    '0.00 EUR',
    '0.00 EUR',
    '30.68 EUR',
    '0.00 EUR',
    '0.00 EUR',
    '0.00 EUR',
    '0.00 EUR',
  ]);
  await expect(panel.locator('.financial-document-preview-hero h3')).toContainText('30.68 EUR');
  await close();
  const credit = await sell(true);
  await page.reload();
  await open(credit.invoice.number);
  await expect(section.locator('.finance-status')).toHaveText('Unpaid');
  await expect(section.locator('.pos-invoice-balances dd')).toHaveText([
    '30.68 EUR',
    '0.00 EUR',
    '30.68 EUR',
    '30.68 EUR',
  ]);
  const creditIssued = await issue();
  await section.getByRole('button', { name: 'Open customer account', exact: true }).click();
  await expect(
    panel.getByRole('heading', { name: 'Alfa Market Demo Ltd.', exact: true }),
  ).toBeVisible();
  await expect(panel).toContainText('30.68 EUR');
  await panel.locator('.panel-drawer-header .panel-back-button').click();
  await expect(
    panel.getByRole('heading', { name: creditIssued.officialNumber!, exact: true }),
  ).toBeVisible();
  await close();
  await page.getByRole('button', { name: 'BG', exact: true }).click();
  await page.getByRole('link', { name: 'Финансови документи', exact: true }).click();
  await page
    .locator('.financial-document-register-row')
    .filter({ hasText: creditIssued.officialNumber! })
    .getByRole('button', { name: 'Преглед', exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  const bg = panel.getByRole('region', { name: 'POS плащания', exact: true });
  await bg.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await expect(bg.locator('.finance-status')).toHaveText('Неплатено');
  await expect(
    bg.getByRole('button', { name: 'Отвори клиентската сметка', exact: true }),
  ).toBeVisible();
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const mobilePayments = bg.locator('.pos-invoice-mobile-payments');
  await expect(mobilePayments).toBeVisible();
  await expect(mobilePayments.locator('dd')).toHaveText(['30,68 EUR', '0,00 EUR']);
  const paymentValues = await mobilePayments
    .locator('dd')
    .evaluateAll((values) => values.map((value) => value.getBoundingClientRect().y));
  expect(Math.abs(paymentValues[0] - paymentValues[1])).toBeLessThan(2);
  expect(
    await mobilePayments.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('pos-invoice-credit-bg-mobile.png') });
  await returnSale(credit.saleNumber);
  await nav.getByRole('link', { name: 'Shifts', exact: true }).click();
  await pos.getByLabel('Counted cash', { exact: false }).fill('100');
  await pos.getByRole('button', { name: 'Close cashier shift', exact: true }).click();
  await expect(pos.getByRole('button', { name: 'Open cashier shift', exact: true })).toBeVisible();
  await pos.close();
});
