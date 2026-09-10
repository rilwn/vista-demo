import { expect, test } from '@playwright/test';
import { signIn } from './sign-in.js';

test('Operations help follows access, searches and returns focus without navigation', async ({
  page,
}) => {
  await page.goto('/');
  await signIn(page, 'warehouse@vista.local');
  const trigger = page.getByRole('button', { name: 'Help', exact: true });
  await trigger.click();
  const help = page.getByRole('dialog', { name: 'How can we help?' });
  await expect(help.getByText('Products, stock and serial numbers', { exact: true })).toBeVisible();
  await expect(help.getByText('Payments and financial documents', { exact: true })).toHaveCount(0);
  await help.getByLabel('Search help').fill('reservations');
  await expect(help.locator('details')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 640 });
  await expect(help.getByRole('button', { name: 'Back to work' })).toBeInViewport();
  expect(await help.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('help-mobile.png') });
  await help.getByLabel('Search help').fill('zzzz-no-match');
  await expect(help.getByRole('status')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).not.toBeVisible();
  await expect(trigger).toBeFocused();
});
