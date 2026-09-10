import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { signIn as submitSignIn } from './sign-in.js';

test.setTimeout(120000);

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await submitSignIn(page, email);
  await expect(page.locator('.workspace-sidebar')).toBeVisible();
}

test('Finance draft attachments survive replacement, download and reopening', async ({ page }) => {
  await signIn(page, 'manager@vista.local');
  await page
    .locator('.workspace-sidebar')
    .getByRole('link', { name: 'Finance', exact: true })
    .click();
  await page.getByRole('link', { name: /Financial documents/ }).click();
  await page.getByRole('button', { name: 'New financial document' }).click();
  await page.getByRole('button', { name: 'Prepare draft', exact: true }).click();
  const preview = page.getByRole('dialog');
  await expect(preview.getByText('No official number allocated')).toBeVisible();
  const title = await preview.locator('.financial-document-drawer-header h2').innerText();
  await preview.getByRole('button', { name: 'Add attachment' }).click();
  const first = Buffer.from('%PDF-1.4\nBrowser acceptance original\n');
  await preview
    .getByLabel('Choose file')
    .setInputFiles({ name: 'acceptance.pdf', mimeType: 'application/pdf', buffer: first });
  await preview.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(preview.getByText('acceptance.pdf', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: 'Replace', exact: true }).click();
  await preview.getByLabel('Choose file').setInputFiles({
    name: 'replacement.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\nBrowser acceptance replacement\n'),
  });
  await preview.getByRole('button', { name: 'Upload', exact: true }).click();
  await preview.getByRole('button', { name: '2 versions' }).click();
  const downloading = page.waitForEvent('download');
  await preview.getByRole('button', { name: /Version 1/ }).click();
  const path = await (await downloading).path();
  expect(path).not.toBeNull();
  expect(await readFile(path)).toEqual(first);
  await preview.getByRole('button', { name: 'Back to financial documents' }).click();
  await page
    .getByRole('article')
    .filter({ hasText: title })
    .getByRole('button', { name: 'Preview' })
    .click();
  await expect(page.getByText('replacement.pdf', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(page.getByLabel('Choose file')).toBeVisible();
  expect(
    await page.locator('.security-drawer-body').evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
});

test('platform manager reads monitoring through navigation', async ({ page }) => {
  await signIn(page, 'platform.manager@vista.local');
  await page
    .locator('.workspace-sidebar')
    .getByRole('link', { name: 'System activity', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Background processing' })).toBeVisible();
  await expect(page.locator('.job-monitor-status')).toContainText('Queue is not paused');
  await page.getByRole('button', { name: 'Refresh processing status' }).click();
  await expect(page.locator('.job-monitor-status')).toContainText('Queue is not paused');
});

test('viewer cannot enter platform monitoring', async ({ page }) => {
  await signIn(page, 'viewer@vista.local');
  await expect(
    page.locator('.workspace-sidebar').getByRole('link', { name: 'System activity', exact: true }),
  ).toHaveCount(0);
  await page.goto('/operations');
  await expect(
    page.getByText('This page does not exist or is not available to your account.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Background processing' })).toHaveCount(0);
});
