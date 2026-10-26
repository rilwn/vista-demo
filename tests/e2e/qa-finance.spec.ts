import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { signIn } from './sign-in.js';
import type { FinancialDocument, RecurringInvoiceContract } from '@vista/contracts';

test('issued corrections update one collection, preserve partial payments and show customer credit in English and Bulgarian', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await signIn(page, 'finance@vista.local');
  await page
    .locator('.workspace-sidebar')
    .getByRole('link', { name: 'Finance', exact: true })
    .click();
  await page.getByRole('link', { name: /Financial documents/ }).click();
  const dialog = page.getByRole('dialog');
  const close = async () =>
    dialog
      .locator('.panel-drawer-header')
      .getByRole('button', { name: /^Close(?: panel)?$/ })
      .click();
  const issue = async () => {
    await dialog
      .getByRole('checkbox', {
        name: 'I have checked the parties, dates, currency, amounts and VAT details.',
        exact: true,
      })
      .check();
    const response = page.waitForResponse(
      (result) => result.url().endsWith('/issue') && result.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Issue document', exact: true }).click();
    const result = await response;
    expect(result.status()).toBe(200);
    return (await result.json()) as FinancialDocument;
  };
  const pay = async (amount: string) => {
    await dialog.getByRole('button', { name: 'Record payment', exact: true }).click();
    await dialog.getByLabel('Amount (EUR)', { exact: true }).fill(amount);
    await dialog.getByRole('button', { name: 'Record payment', exact: true }).click();
    await expect(dialog.locator('.finance-payment-list')).toContainText(
      amount === '60' ? '60.00' : '48.00',
    );
  };
  await page.getByRole('button', { name: 'New financial document', exact: true }).click();
  await choose(page, 'Document source', 'Manual document');
  await choose(page, 'Customer', 'Alfa Market Demo Ltd.');
  await choose(page, 'Product or service', /DEV-ADAPTER-12V/);
  await dialog.getByLabel('Quantity', { exact: true }).fill('10');
  await dialog.getByLabel('Unit price', { exact: true }).fill('10');
  await dialog.getByRole('button', { name: 'Prepare draft', exact: true }).click();
  const original = await issue();
  expect(original.grossTotal).toBe('120.0000');
  await dialog.getByRole('button', { name: 'Collections & payments', exact: true }).click();
  await pay('60');
  await expect(dialog.locator('.finance-preview-hero')).toContainText('60.00');
  await close();
  const note = async (type: 'Credit note' | 'Debit note', quantity: string) => {
    await page.getByRole('link', { name: 'Financial documents', exact: true }).click();
    await page.getByRole('button', { name: 'New financial document', exact: true }).click();
    await choose(page, 'Document type', type);
    await choose(page, 'Original invoice', new RegExp(`^${original.officialNumber!} ·`));
    await expect(dialog.getByLabel('Quantity', { exact: true })).toHaveValue('10.0000');
    await expect(dialog.getByLabel('Unit price', { exact: true })).toHaveValue('10.0000');
    await dialog.getByLabel('Quantity', { exact: true }).fill(quantity);
    await dialog
      .getByLabel('Correction reason', { exact: true })
      .fill(type === 'Credit note' ? 'Returned items' : 'Additional charge for the original items');
    await dialog.getByRole('button', { name: 'Prepare draft', exact: true }).click();
    await expect(
      dialog.getByText('The original balance changes only when this note is issued.', {
        exact: true,
      }),
    ).toBeVisible();
    return issue();
  };
  const credit = await note('Credit note', '2');
  await expect(
    dialog.getByRole('button', { name: 'Open original invoice', exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Collections & payments', exact: true }).click();
  const values = () => dialog.locator('.finance-balance-grid dd');
  await expect(values()).toHaveText([
    '120.00 EUR',
    '60.00 EUR',
    '36.00 EUR',
    '24.00 EUR',
    '0.00 EUR',
    '96.00 EUR',
  ]);
  await expect(dialog.locator('.finance-correction-list')).toContainText(credit.officialNumber!);
  const previewHeader = await dialog.locator('.panel-drawer-header').boundingBox();
  const hero = await dialog.locator('.finance-preview-hero').boundingBox();
  expect(hero!.y - (previewHeader!.y + previewHeader!.height)).toBeGreaterThanOrEqual(14);
  await page.screenshot({ path: testInfo.outputPath('corrected-collection-desktop.png') });
  await dialog.getByRole('button', { name: 'Open note', exact: true }).click();
  await expect(
    dialog.getByRole('heading', { name: credit.officialNumber!, exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Open original invoice', exact: true }).click();
  await expect(
    dialog.getByRole('heading', { name: original.officialNumber!, exact: true }),
  ).toBeVisible();
  await close();
  await note('Debit note', '1');
  await dialog.getByRole('button', { name: 'Collections & payments', exact: true }).click();
  await expect(values()).toHaveText([
    '120.00 EUR',
    '60.00 EUR',
    '48.00 EUR',
    '24.00 EUR',
    '12.00 EUR',
    '108.00 EUR',
  ]);
  await pay('48');
  await expect(dialog.locator('.finance-status')).toHaveText('Paid');
  await close();
  await note('Credit note', '1');
  await dialog.getByRole('button', { name: 'Collections & payments', exact: true }).click();
  await expect(values()).toHaveText([
    '120.00 EUR',
    '108.00 EUR',
    '0.00 EUR',
    '36.00 EUR',
    '12.00 EUR',
    '96.00 EUR',
  ]);
  await expect(dialog.getByText(/Customer credit:.*12.00/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Record payment', exact: true })).toHaveCount(0);
  await expect(dialog.locator('.finance-payment-list > div')).toHaveCount(2);
  await close();
  await page.getByRole('button', { name: 'BG', exact: true }).click();
  await page
    .locator('.finance-register-row')
    .filter({ hasText: original.collection!.number })
    .getByRole('button', { name: 'Преглед', exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    dialog.getByRole('heading', { name: 'Приложени корекции', exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText(/Надплатена сума:.*12/)).toBeVisible();
  await expect(dialog.locator('.finance-preview-hero')).toContainText('Погасено');
  await expect(dialog.locator('.finance-preview-hero')).not.toContainText('Settled');
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.locator('.security-drawer-body').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: testInfo.outputPath('corrected-balances-bg-mobile.png') });
  await dialog.getByText(/Надплатена сума:.*12/).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('customer-credit-bg-mobile.png') });
  const header = await dialog.locator('.panel-drawer-header').boundingBox();
  await dialog
    .getByRole('button', { name: 'Отвори известието', exact: true })
    .last()
    .scrollIntoViewIfNeeded();
  expect((await dialog.locator('.panel-drawer-header').boundingBox())!.y).toBe(header!.y);
  await page.screenshot({ path: testInfo.outputPath('corrected-collection-bg-mobile.png') });
});

test('company images appear on issued PDFs and email, with a full-width Bulgarian settings panel on mobile', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await signIn(page, 'finance@vista.local');
  await page
    .locator('.workspace-sidebar')
    .getByRole('link', { name: 'Finance', exact: true })
    .click();
  await page.getByRole('link', { name: /Financial documents/ }).click();
  await page.getByRole('button', { name: 'Document settings', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', { name: 'Document settings', exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save settings', exact: true })).toBeVisible();
  // Clearly marked test assets, never a fabricated company logo or employee signature.
  const assetPage = await page.context().newPage();
  await assetPage.goto('about:blank');
  const assets = await assetPage.evaluate(() => {
    function png(text: string, italic = false, mediaType = 'image/png') {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 100;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 400, 100);
      ctx.fillStyle = '#17382f';
      ctx.font = `${italic ? 'italic' : 'bold'} 32px sans-serif`;
      ctx.fillText(text, 12, 60);
      return canvas.toDataURL(mediaType).split(',')[1];
    }
    return { logo: png('VISTA QA SAMPLE'), signature: png('Sample signature', true, 'image/jpeg') };
  });
  await assetPage.close();
  for (const [title, name, base64, mimeType] of [
    ['Company logo', 'qa-logo.png', assets.logo, 'image/png'],
    ['Signature image', 'qa-signature.jpg', assets.signature, 'image/jpeg'],
  ]) {
    const section = dialog.getByRole('region', { name: title, exact: true });
    await section
      .getByLabel(title, { exact: true })
      .setInputFiles({ name, mimeType, buffer: Buffer.from(base64, 'base64') });
    await expect(dialog.getByRole('button', { name: 'Save settings', exact: true })).toBeDisabled();
    await section.getByRole('button', { name: 'Upload image', exact: true }).click();
    await expect(section.getByRole('img', { name: title, exact: true })).toBeVisible();
  }
  await dialog.getByLabel('Signature name', { exact: true }).fill('QA Sample Signer');
  await dialog
    .getByRole('checkbox', {
      name: 'I am authorized to use this signature on this company’s financial documents.',
      exact: true,
    })
    .check();
  const saved = page.waitForResponse(
    (result) =>
      result.url().includes('/finance/document-branding/') && result.request().method() === 'PUT',
  );
  await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(dialog.getByLabel('Signature name', { exact: true })).toHaveValue(
    'QA Sample Signer',
  );
  await expect(dialog.getByRole('img', { name: 'Company logo', exact: true })).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'Signature image', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('document-settings-desktop.png') });
  await dialog
    .locator('.panel-drawer-header')
    .getByRole('button', { name: 'Back', exact: true })
    .click();
  await page.getByRole('button', { name: 'New financial document', exact: true }).click();
  await choose(page, 'Document source', 'Manual document');
  await choose(page, 'Customer', 'Alfa Market Demo Ltd.');
  await choose(page, 'Product or service', /DEV-ADAPTER-12V/);
  await dialog.getByLabel('Unit price', { exact: true }).fill('50');
  await dialog.getByRole('button', { name: 'Prepare draft', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Download PDF', exact: true })).toBeVisible();
  const draftDownloaded = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download PDF', exact: true }).click();
  await (await draftDownloaded).saveAs(testInfo.outputPath('branded-draft.pdf'));
  await dialog
    .getByRole('checkbox', {
      name: 'I have checked the parties, dates, currency, amounts and VAT details.',
      exact: true,
    })
    .check();
  const issued = page.waitForResponse(
    (result) => result.url().endsWith('/issue') && result.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Issue document', exact: true }).click();
  const issueResponse = await issued;
  expect(issueResponse.status()).toBe(200);
  const invoice = (await issueResponse.json()) as {
    id: string;
    officialNumber: string;
    branding: {
      version: number;
      logo: { id: string };
      signature: { id: string };
      signatoryName: string;
    };
  };
  expect(invoice.branding).toMatchObject({ version: 1, signatoryName: 'QA Sample Signer' });
  await testInfo.attach('issued-document.json', {
    body: JSON.stringify(invoice),
    contentType: 'application/json',
  });
  await testInfo.attach('qa-logo.png', {
    body: Buffer.from(assets.logo, 'base64'),
    contentType: 'image/png',
  });
  await testInfo.attach('qa-signature.jpg', {
    body: Buffer.from(assets.signature, 'base64'),
    contentType: 'image/jpeg',
  });
  const downloaded = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download PDF', exact: true }).click();
  await (await downloaded).saveAs(testInfo.outputPath('branded-issued.pdf'));
  await dialog.getByLabel('Recipient email', { exact: true }).fill('branding-demo@example.invalid');
  const queued = page.waitForResponse(
    (result) => result.url().endsWith('/email') && result.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Send email', exact: true }).click();
  expect((await queued).status()).toBe(202);
  await dialog
    .locator('.panel-drawer-header')
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await page.getByRole('button', { name: 'BG', exact: true }).click();
  await page.getByRole('button', { name: 'Настройки на документите', exact: true }).click();
  await expect(dialog.getByLabel('Име на подписващия', { exact: true })).toHaveValue(
    'QA Sample Signer',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const scroll = dialog.locator('.branding-scroll');
  expect(await scroll.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  );
  const header = await dialog.locator('.panel-drawer-header').boundingBox();
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect((await dialog.locator('.panel-drawer-header').boundingBox())!.y).toBe(header!.y);
  await expect(dialog.getByRole('checkbox')).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const footer = await dialog.locator('.financial-document-form-actions').boundingBox();
  const bounds = await dialog.boundingBox();
  expect(Math.abs(footer!.x - bounds!.x)).toBeLessThan(3);
  expect(Math.abs(bounds!.width - footer!.width)).toBeLessThan(4);
  expect(Math.abs(bounds!.y + bounds!.height - footer!.y - footer!.height)).toBeLessThan(3);
  await page.screenshot({ path: testInfo.outputPath('document-settings-bg-mobile.png') });
  // Remove only the current bindings. The invoice must retain both original image versions.
  for (const title of ['Фирмено лого', 'Изображение на подпис'])
    await dialog
      .getByRole('region', { name: title, exact: true })
      .getByRole('button', { name: 'Премахване', exact: true })
      .click();
  const cleared = page.waitForResponse(
    (result) =>
      result.url().includes('/finance/document-branding/') && result.request().method() === 'PUT',
  );
  await dialog.getByRole('button', { name: 'Запазване на настройките', exact: true }).click();
  expect((await cleared).status()).toBe(200);
  await dialog
    .locator('.panel-drawer-header')
    .getByRole('button', { name: 'Назад', exact: true })
    .click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page
    .getByRole('article')
    .filter({ hasText: invoice.officialNumber })
    .getByRole('button', { name: 'Preview', exact: true })
    .click();
  const savedPdf = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download PDF', exact: true }).click();
  await (await savedPdf).saveAs(testInfo.outputPath('branded-issued-after-settings-change.pdf'));
});

async function choose(page: Page, label: string, value: string | RegExp) {
  await page
    .getByRole('dialog')
    .getByRole('combobox', { name: `Search ${label}`, exact: true })
    .fill('');
  await page.getByRole('listbox').getByRole('option', { name: value, exact: true }).click();
}

async function seedUsdRate(rateDate: string) {
  const databaseUrl = new URL(process.env['DATABASE_URL'] ?? '');
  if (
    process.env['VISTA_E2E_ISOLATED'] !== 'true' ||
    databaseUrl.hostname !== '127.0.0.1' ||
    databaseUrl.port !== '58432' ||
    databaseUrl.pathname !== '/vista_e2e' ||
    databaseUrl.username !== 'vista_e2e'
  )
    throw Error('Exchange-rate fixtures require the disposable browser database.');
  const pool = new Pool({ connectionString: databaseUrl.href });
  try {
    await pool.query(
      `INSERT INTO finance.currency_rates (currency_code, rate_date, eur_per_unit, rate_source)
       VALUES ('USD', $1, 0.92000000, 'BNB')
       ON CONFLICT (currency_code, rate_date) DO UPDATE
       SET eur_per_unit = EXCLUDED.eur_per_unit, imported_at = now()`,
      [rateDate],
    );
  } finally {
    await pool.end();
  }
}

test('an approved recurring subscription issues once, opens a collection and keeps settings usable in Bulgarian on mobile', async ({
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
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Sofia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  await dialog.getByLabel('Starts on', { exact: true }).fill(today);
  await dialog.getByLabel('Next invoice date', { exact: true }).fill(today);
  await dialog.getByLabel('Recurring amount', { exact: true }).fill('50');
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/sales/subscriptions') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Create contract', exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const contract = (await response.json()) as { id: string; number: string };
  await page
    .locator('.workspace-sidebar')
    .getByRole('link', { name: 'Finance', exact: true })
    .click();
  await page.getByRole('link', { name: /^Recurring invoices/ }).click();
  const row = page.getByRole('row').filter({ hasText: contract.number });
  await expect(row).toContainText('Not enabled');
  await row.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(
    dialog.getByRole('heading', { name: 'Invoicing settings', exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel('Payment due in days', { exact: true })).toHaveValue('14');
  await dialog
    .getByRole('checkbox', {
      name: 'I have checked the subscription charge, issuing details, VAT and payment terms.',
      exact: true,
    })
    .check();
  await expect(dialog.getByRole('button', { name: 'Save settings', exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('recurring-invoice-settings.png') });
  const saved = page.waitForResponse(
    (result) =>
      result.url().includes('/finance/recurring-invoices/') && result.request().method() === 'PUT',
  );
  await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
  expect((await saved).status()).toBe(200);
  // Reproduce a scheduler race: the first read is still waiting, then the
  // real server result becomes visible without closing or rerunning the panel.
  let showWaitingOnce = true;
  await page.route(`**/finance/recurring-invoices/${contract.id}`, async (route) => {
    if (route.request().method() !== 'GET' || !showWaitingOnce) return route.continue();
    const result = await route.fetch();
    const record = (await result.json()) as RecurringInvoiceContract;
    if (!record.periods.length) return route.fulfill({ response: result });
    showWaitingOnce = false;
    record.periods = record.periods.map((period) => {
      const pending = { ...period, status: 'waiting' as const };
      delete pending.document;
      return pending;
    });
    await route.fulfill({ response: result, json: record });
  });
  await dialog.getByRole('button', { name: 'Run due invoice', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Run due invoice', exact: true })).toBeEnabled();
  await expect(dialog.locator('.recurring-periods li')).toHaveCount(1);
  await expect(dialog.locator('.recurring-periods .recurring-status')).toHaveText('Issued', {
    timeout: 20000,
  });
  expect(showWaitingOnce).toBe(false);
  const invoiceLink = dialog.getByRole('button', { name: /^Open document · \d{10}$/ });
  const number = (await invoiceLink.innerText()).split(' · ')[1];
  await dialog.getByRole('button', { name: 'Run due invoice', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Run due invoice', exact: true })).toBeEnabled();
  await expect(dialog.locator('.recurring-periods li')).toHaveCount(1);
  await expect(invoiceLink).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('recurring-invoice-issued.png') });
  await invoiceLink.click();
  await expect(dialog.getByRole('heading', { name: number, level: 2, exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Collections & payments', exact: true }).click();
  await expect(dialog.locator('.finance-balance-grid dd')).toHaveText([
    '60.00 EUR',
    '0.00 EUR',
    '60.00 EUR',
  ]);
  await dialog.getByRole('button', { name: 'Record payment', exact: true }).click();
  await dialog.getByLabel('Amount (EUR)', { exact: true }).fill('60');
  await dialog.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(dialog.locator('.finance-status')).toHaveText('Paid');
  await dialog.getByRole('button', { name: 'Close panel', exact: true }).click();
  await page.getByRole('link', { name: 'Recurring invoices', exact: true }).click();
  await row.getByRole('button', { name: 'Preview', exact: true }).click();
  await dialog.getByRole('button', { name: 'Edit settings', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Enable automatic invoices', exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Run due invoice', exact: true })).toHaveCount(0);
  await dialog.locator('header').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'BG', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Периодични фактури', exact: true }),
  ).toBeVisible();
  await row.getByRole('button', { name: 'Преглед', exact: true }).click();
  await expect(dialog.locator('.recurring-periods .recurring-status')).toHaveText('Издадена');
  await dialog.getByRole('button', { name: 'Промяна на настройките', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const scroll = dialog.locator('.recurring-drawer-scroll');
  expect(await scroll.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  );
  const header = await dialog.locator('.panel-drawer-header').boundingBox();
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    dialog.getByRole('checkbox', { name: 'Включване на автоматичното фактуриране', exact: true }),
  ).toBeVisible();
  expect((await dialog.locator('.panel-drawer-header').boundingBox())!.y).toBe(header!.y);
  await dialog
    .getByRole('button', { name: 'Запазване на настройките', exact: true })
    .scrollIntoViewIfNeeded();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const footer = await dialog.locator('.financial-document-form-actions').boundingBox();
  const bounds = await dialog.boundingBox();
  expect(footer!.x - bounds!.x).toBeLessThan(3);
  expect(bounds!.width - footer!.width).toBeLessThan(4);
  await page.screenshot({ path: testInfo.outputPath('recurring-invoice-settings-bg-mobile.png') });
});

test('an issued manual proforma opens its collection, converts after payment and keeps both links', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await signIn(page, 'finance@vista.local');
  await page
    .locator('.workspace-sidebar')
    .getByRole('link', { name: 'Finance', exact: true })
    .click();
  await page.getByRole('link', { name: /Financial documents/ }).click();
  await page.getByRole('button', { name: 'New financial document', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await choose(page, 'Document type', 'Proforma invoice');
  await choose(page, 'Document source', 'Manual document');
  await choose(page, 'Customer', 'Alfa Market Demo Ltd.');
  await choose(page, 'Product or service', /DEV-ADAPTER-12V/);
  await dialog.getByLabel('Unit price', { exact: true }).fill('50');
  await dialog.getByRole('button', { name: 'Prepare draft', exact: true }).click();
  await expect(
    dialog.getByRole('checkbox', {
      name: 'I have checked the parties, dates, currency, amounts and VAT details.',
      exact: true,
    }),
  ).toBeVisible();
  const number = await dialog.getByRole('heading', { name: /^DPRO-/ }).innerText();
  await dialog.getByRole('checkbox').check();
  const issued = page.waitForResponse(
    (response) => response.url().endsWith('/issue') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Issue document', exact: true }).click();
  expect((await issued).status()).toBe(200);
  await dialog.getByRole('button', { name: 'Collections & payments', exact: true }).click();
  await expect(dialog.locator('.finance-status')).toHaveText('Unpaid');
  await expect(dialog.locator('.finance-source-row')).toContainText(number);
  await expect(dialog.getByRole('button', { name: 'Cancel record', exact: true })).toHaveCount(0);
  const collectionNumber = await dialog.locator('h2').innerText();
  for (const [index, amount] of ['20', '40'].entries()) {
    await dialog.getByRole('button', { name: 'Record payment', exact: true }).click();
    await dialog.getByLabel('Amount (EUR)', { exact: true }).fill(amount);
    await dialog
      .getByLabel('Reference (optional)', { exact: true })
      .fill(`MANUAL-PROFORMA-${index + 1}`);
    await dialog.getByRole('button', { name: 'Record payment', exact: true }).click();
    await expect(dialog.locator('.finance-status')).toHaveText(
      index === 0 ? 'Partially paid' : 'Paid',
    );
  }
  await expect(dialog.locator('.finance-balance-grid dd')).toHaveText([
    '60.00 EUR',
    '60.00 EUR',
    '0.00 EUR',
  ]);
  await expect(dialog.locator('.finance-payment-list > div')).toHaveCount(2);
  const officialNumber = await dialog.locator('.finance-source-row strong').first().innerText();
  expect(officialNumber).toMatch(/^\d{10}$/u);
  await dialog.getByRole('button', { name: 'Open financial document', exact: true }).click();
  await expect(dialog.getByText(officialNumber, { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText(number, { exact: true }).first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Collections & payments', exact: true }).click();
  await expect(dialog.locator('h2')).toHaveText(collectionNumber);
  await expect(dialog.locator('.finance-status')).toHaveText('Paid');
  await dialog
    .getByRole('button', { name: 'Open financial document', exact: true })
    .scrollIntoViewIfNeeded();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('paid-manual-proforma-mobile.png') });
  await dialog.getByRole('button', { name: 'Close panel', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'BG', exact: true }).click();
  await page
    .getByRole('article')
    .filter({ hasText: collectionNumber })
    .getByRole('button', { name: 'Преглед', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Отвори финансовия документ', exact: true }).click();
  await expect(
    dialog.getByRole('heading', { name: 'Свързан документ', exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: new RegExp(number), exact: true }).click();
  await expect(
    dialog.getByText('Проформата е платена и е издадена фактура.', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('heading', { name: 'Данни за документа', exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText('Издадена проформа без номер на фактура', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText('Document context', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: officialNumber, exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('paid-manual-proforma-bulgarian.png') });
});

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
  const rateDate = await dialog.getByLabel('Document date', { exact: true }).inputValue();
  await seedUsdRate(rateDate);
  await dialog.getByLabel('Currency', { exact: true }).fill('USD');
  await expect(dialog.getByLabel('EUR exchange rate', { exact: true })).toHaveValue('0.92000000');
  await expect(dialog.getByLabel('Rate source', { exact: true })).toHaveValue('BNB');
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/finance/financial-documents') &&
      response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Prepare draft', exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const invoice = (await response.json()) as { number: string; eurGrossTotal: string };
  expect(invoice.eurGrossTotal).toBe('110.4000');
  await expect(dialog.getByText(invoice.number, { exact: true }).first()).toBeVisible();
  await dialog.locator('header').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'New financial document', exact: true }).click();
  await choose(page, 'Document type', 'Credit note');
  await choose(page, 'Original invoice', new RegExp(invoice.number));
  await expect(dialog.getByLabel('Unit price', { exact: true })).toHaveValue('100.0000');
  await expect(dialog.getByLabel('Quantity', { exact: true })).toHaveValue('1.0000');
  await expect(dialog.getByLabel('Currency', { exact: true })).toHaveValue('USD');
  await expect(dialog.getByLabel('EUR exchange rate', { exact: true })).toHaveValue('0.92000000');
  await dialog.getByLabel('Correction reason', { exact: true }).fill('Return verification');
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
  await expect(dialog.getByLabel('Unit price', { exact: true })).toHaveValue('306.7751');
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
  const nextDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Sofia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + 86400000));
  try {
    await dialog.getByLabel('Document date', { exact: true }).fill(nextDate);
    await requested;
    await dialog.getByLabel('Unit price', { exact: true }).fill('675');
    release();
    await expect(dialog.getByText('Finding customer price…', { exact: true })).toHaveCount(0);
    await expect(dialog.getByLabel('Unit price', { exact: true })).toHaveValue('675');
    await dialog.getByRole('button', { name: 'Use customer price', exact: true }).click();
    await expect(dialog.getByLabel('Unit price', { exact: true })).toHaveValue('306.7751');
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
  await seedUsdRate(nextDate);
  await dialog.getByLabel('Currency', { exact: true }).fill('USD');
  await expect(dialog.getByLabel('EUR exchange rate', { exact: true })).toHaveValue('0.92000000');
  await expect(dialog.getByLabel('Rate source', { exact: true })).toHaveValue('BNB');
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
  await expect(dialog.getByLabel('Currency', { exact: true })).toHaveValue('EUR');
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
  await expect(dialog.getByLabel('Amount to apply (EUR)', { exact: true })).toHaveValue('20.4517');
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
