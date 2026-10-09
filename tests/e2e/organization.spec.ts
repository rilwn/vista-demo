import { expect, test, type Page } from '@playwright/test';
import { signIn as submitSignIn } from './sign-in.js';

test.setTimeout(120000);

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await submitSignIn(page, email);
  await expect(page.locator('.workspace-sidebar')).toBeVisible();
}

test('manager edits, deactivates and restores a business structure record', async ({ page }) => {
  await signIn(page, 'manager@vista.local');
  await page
    .locator('.workspace-sidebar')
    .getByRole('link', { name: 'Business structure', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Business structure' })).toBeVisible();

  const suffix = Date.now().toString(36).toUpperCase();
  const code = `QA-${suffix}`;
  const name = `QA Structure ${suffix} Ltd.`;
  const updatedName = `${name} Updated`;
  await page.getByRole('button', { name: 'Legal entity', exact: true }).click();
  await page.getByLabel('Legal entity code').fill(code);
  await page.getByLabel('Legal entity name').fill(name);
  await page.getByRole('button', { name: 'Add legal entity', exact: true }).click();

  const entity = page.locator('.organization-entity').filter({ hasText: name });
  await expect(entity.getByRole('heading', { name })).toBeVisible();
  await entity.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Legal entity name').fill(updatedName);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();

  const updatedEntity = page.locator('.organization-entity').filter({ hasText: updatedName });
  await expect(updatedEntity.getByRole('heading', { name: updatedName })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await updatedEntity.getByRole('button', { name: 'Deactivate', exact: true }).click();
  await expect(updatedEntity.getByText('Inactive', { exact: true })).toBeVisible();
  await updatedEntity.getByRole('button', { name: 'Reactivate', exact: true }).click();
  await expect(
    updatedEntity.getByRole('button', { name: 'Deactivate', exact: true }),
  ).toBeVisible();
});
