import { expect, test } from '@playwright/test';

import { signIn } from './sign-in.js';

test('global search opens a customer, finance document, and serial record', async ({ page }) => {
  await page.goto('/');
  await signIn(page, 'manager@vista.local');

  const search = page.getByRole('combobox', {
    name: 'Search pages, customers, documents, or serials',
  });

  await search.fill('Alfa Market Demo Ltd.');
  const customer = page
    .getByRole('option')
    .filter({ hasText: 'Alfa Market Demo Ltd.' })
    .filter({ hasText: 'Customers and suppliers' });
  await expect(customer).toBeVisible();
  await customer.click();
  await expect(
    page.getByRole('heading', { name: 'Alfa Market Demo Ltd.', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await search.fill('DEV-FIN-REV-0001');
  const document = page.getByRole('option', { name: /DEV-FIN-REV-0001/u });
  await expect(document).toBeVisible();
  await document.click();
  await expect(page.getByRole('heading', { name: 'DEV-FIN-REV-0001', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await search.fill('DEMO-FR-ALFA-01');
  const serial = page.getByRole('option', { name: /DEMO-FR-ALFA-01/u });
  await expect(serial).toBeVisible();
  await serial.click();
  await expect(
    page.locator('.embedded-trace').getByText('DEMO-FR-ALFA-01', { exact: true }),
  ).toBeVisible();
});
