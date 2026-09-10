import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { signIn } from './sign-in.js';
import type { ManagedFile } from '@vista/contracts';

const original = Buffer.from('%PDF-1.4\nAttachment acceptance original\n');
const file = { name: 'attachment-acceptance.pdf', mimeType: 'application/pdf', buffer: original };

async function checkReader(page: Page, record: ManagedFile) {
  const browser = page.context().browser();
  if (!browser) throw Error('Browser is required');
  const reader = await browser.newPage({ baseURL: 'http://127.0.0.1:5373' });
  try {
    await reader.goto('/');
    await signIn(reader, 'viewer@vista.local');
    await expect(reader.locator('.workspace-sidebar')).toBeVisible();
    const token = await reader.evaluate(() => {
      const session = JSON.parse(sessionStorage.getItem('vista.erp-crm.session.v1') ?? '{}') as {
        sessionToken?: string;
      };
      return session.sessionToken;
    });
    expect(token).toBeTruthy();
    const headers = { Authorization: `Bearer ${token}` };
    const content = await reader.request.get(`/api/v1/files/${record.id}/content`, { headers });
    expect(content.status()).toBe(200);
    expect(await content.body()).toEqual(original);
    const denied = await reader.request.post('/api/v1/files', {
      headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
      multipart: { parentType: record.parentType, parentId: record.parentId, file },
    });
    expect(denied.status()).toBe(403);
  } finally {
    await reader.close();
  }
}

async function login(page: Page) {
  await page.goto('/');
  await signIn(page, 'manager@vista.local');
}

async function download(page: Page, name: string | RegExp) {
  const pending = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name, exact: true }).click();
  const path = await (await pending).path();
  expect(await readFile(path)).toEqual(original);
}

async function loseUploadResponse(page: Page) {
  const keys: string[] = [];
  await page.route('**/api/v1/files', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key'] ?? '');
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    if (keys.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  return keys;
}

async function sharedUpload(page: Page, add: string) {
  const panel = page.getByRole('dialog');
  await panel.getByRole('button', { name: add, exact: true }).click();
  await panel.getByLabel('Choose file').setInputFiles(file);
  const keys = await loseUploadResponse(page);
  await panel.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/files') &&
      response.request().method() === 'POST' &&
      response.ok(),
  );
  await panel.getByRole('button', { name: 'Upload', exact: true }).click();
  const record = (await (await saved).json()) as ManagedFile;
  await expect(panel.getByText(file.name, { exact: true })).toHaveCount(1);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[0]).toBe(keys[1]);
  await panel.getByRole('button', { name: 'Replace', exact: true }).click();
  await panel.getByLabel('Choose file').setInputFiles({
    ...file,
    name: 'replacement.pdf',
    buffer: Buffer.from('%PDF-1.4\nReplacement\n'),
  });
  await panel.getByRole('button', { name: 'Upload', exact: true }).click();
  await panel.getByRole('button', { name: '2 versions' }).click();
  await download(page, /Version 1/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('attachments-mobile.png') });
  await checkReader(page, record);
}

test('partner documents retry safely and preserve the original version', async ({ page }) => {
  await login(page);
  await page
    .locator('.workspace-sidebar')
    .getByRole('link', { name: 'Customers & CRM', exact: true })
    .click();
  await page.getByRole('link', { name: /Partner registry/ }).click();
  await page.getByRole('button', { name: /Alfa Market Demo Ltd/ }).click();
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  let unavailable = true;
  await page.route('**/api/v1/files?*', (route) =>
    unavailable ? route.abort('failed') : route.continue(),
  );
  // Reopen to exercise failed list loading rather than a successful empty result.
  await page.getByRole('dialog').getByRole('button', { name: /Back/ }).click();
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  unavailable = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await sharedUpload(page, 'Add document');
  await page.reload();
  await page.getByRole('button', { name: /Alfa Market Demo Ltd/ }).click();
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByText('replacement.pdf', { exact: true }),
  ).toBeVisible();
});

test('CRM interaction attachments retain versions after a retry', async ({ page }) => {
  await login(page);
  await page
    .locator('.workspace-sidebar')
    .getByRole('link', { name: 'Customers & CRM', exact: true })
    .click();
  await page.getByRole('link', { name: /Timeline|Interactions/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Interactions & tasks', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Search Customer', exact: true })).toHaveValue(
    'Alfa Market Demo Ltd.',
  );
  await page.getByRole('button', { name: 'Log interaction', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Subject', { exact: true })
    .fill('Attachment acceptance call');
  await page
    .getByRole('dialog')
    .getByLabel('Notes', { exact: true })
    .fill('Customer asked for the equipment instructions.');
  await page.getByRole('button', { name: 'Save interaction', exact: true }).click();
  await page.getByRole('button', { name: /Attachment acceptance call/ }).click();
  await sharedUpload(page, 'Add attachment');
  await page.reload();
  await page.getByRole('button', { name: /Attachment acceptance call/ }).click();
  await expect(
    page.getByRole('dialog').getByText('replacement.pdf', { exact: true }),
  ).toBeVisible();
});

test('warranty evidence survives a lost upload response without duplication', async ({ page }) => {
  await login(page);
  await page
    .locator('.workspace-sidebar')
    .getByRole('link', { name: 'Customers & CRM', exact: true })
    .click();
  await page.getByRole('link', { name: /Warranty, feedback & referrals/ }).click();
  await expect(page.getByRole('heading', { name: 'Warranty register', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New warranty claim', exact: true }).click();
  await page
    .getByLabel('Description', { exact: true })
    .fill('Attachment acceptance: faded print after replacing the receipt roll.');
  await page.getByRole('button', { name: 'Create claim', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('.crm-care-claim-grid > button').first().click();
  const panel = page.getByRole('dialog');
  const number = await panel.locator('h2').innerText();
  await panel.getByLabel('Supporting file').setInputFiles(file);
  const keys = await loseUploadResponse(page);
  await panel.getByRole('button', { name: 'Upload file', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/files') &&
      response.request().method() === 'POST' &&
      response.ok(),
  );
  await panel.getByRole('button', { name: 'Upload file', exact: true }).click();
  const record = (await (await saved).json()) as ManagedFile;
  await expect(panel.getByText(file.name, { exact: true })).toHaveCount(1);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[0]).toBe(keys[1]);
  await download(page, 'Download');
  await page.reload();
  await page.getByRole('button', { name: new RegExp(number) }).click();
  await expect(panel.getByText(file.name, { exact: true })).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('warranty-attachment-mobile.png') });
  await checkReader(page, record);
});
