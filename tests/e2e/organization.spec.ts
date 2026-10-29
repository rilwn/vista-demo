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
  await expect(page.getByRole('dialog', { name: 'Add a legal business entity' })).toBeVisible();
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

test('business structure panels stay separate, scroll internally and fit Bulgarian phone layouts', async ({
  page,
}) => {
  await signIn(page, 'manager@vista.local');
  await page
    .locator('.workspace-sidebar')
    .getByRole('link', { name: 'Business structure', exact: true })
    .click();
  await expect(page.locator('.organization-entity').first()).toBeVisible();
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.screenshot({
    path: test.info().outputPath('organization-desktop.png'),
    fullPage: true,
  });
  const edit = page
    .locator('.organization-entity')
    .first()
    .locator('> header')
    .getByRole('button', { name: 'Edit', exact: true });
  await edit.click();
  const panel = page.getByRole('dialog', { name: 'Edit legal entity' });
  await expect(panel).toBeVisible();
  expect(
    await page.locator('#root').evaluate((root) => root instanceof HTMLElement && root.inert),
  ).toBe(true);
  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x + bounds!.width).toBeCloseTo(page.viewportSize()!.width, 0);
  expect(bounds!.y).toBe(0);
  expect(bounds!.width).toBeLessThanOrEqual(672);
  await expect(panel.getByLabel('Legal entity code')).toBeFocused();
  await expect(panel.getByRole('button', { name: 'Back to business structure' })).toHaveCSS(
    'display',
    'flex',
  );
  await page.screenshot({ path: test.info().outputPath('organization-edit-desktop.png') });
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(edit).toBeFocused();
  expect(
    await page.locator('#root').evaluate((root) => root instanceof HTMLElement && root.inert),
  ).toBe(false);

  const resources = page.locator('.organization-resources').first();
  await resources.locator('summary').click();
  await expect(resources).toHaveAttribute('open', '');
  await expect(resources.locator('.organization-record-row').first()).toBeVisible();

  await page.setViewportSize({ width: 390, height: 640 });
  await page.getByRole('button', { name: 'BG', exact: true }).click();
  await page.getByRole('button', { name: 'Обект', exact: true }).click();
  const phonePanel = page.getByRole('dialog', { name: 'Добавяне на работен обект' });
  await expect(phonePanel).toBeVisible();
  const body = phonePanel.locator('.organization-drawer-body');
  expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await body.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    phonePanel.getByRole('heading', { name: 'Добавяне на работен обект' }),
  ).toBeVisible();
  const footer = phonePanel.locator('footer');
  await expect(
    footer.getByRole('button', { name: 'Добавяне: обект', exact: true }),
  ).toBeInViewport();
  const footerBounds = await footer.boundingBox();
  expect(footerBounds!.x).toBe(0);
  expect(footerBounds!.width).toBe(390);
  expect(footerBounds!.y + footerBounds!.height).toBeCloseTo(640, 0);
  expect(await phonePanel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  expect(
    await page.locator('body').evaluate((element) => element.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.screenshot({ path: test.info().outputPath('organization-location-bg-phone.png') });
  await phonePanel.getByRole('button', { name: 'Отказ', exact: true }).click();
  await expect(phonePanel).toHaveCount(0);

  await page.getByRole('button', { name: 'Касов апарат', exact: true }).click();
  const registerPanel = page.getByRole('dialog', { name: 'Добавяне на касов апарат' });
  await expect(registerPanel).toBeVisible();
  const locationChoice = registerPanel.getByRole('combobox');
  await locationChoice.click();
  await expect(registerPanel.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(registerPanel).toBeVisible();
  await expect(locationChoice).toHaveAttribute('aria-expanded', 'false');
  await locationChoice.click();
  await expect(registerPanel.getByRole('listbox')).toBeVisible();
  await registerPanel.getByRole('option').first().click();
  await expect(registerPanel.getByRole('listbox')).toBeHidden();
  const checkbox = registerPanel.getByRole('checkbox').first();
  await checkbox.scrollIntoViewIfNeeded();
  await expect(checkbox).toBeVisible();
  expect((await checkbox.boundingBox())!.width).toBe(16);
  await page.screenshot({ path: test.info().outputPath('organization-register-bg-phone.png') });
  await registerPanel.getByRole('button', { name: 'Отказ', exact: true }).click();
});

test('partner register and record drawer stay contained at tablet width', async ({ page }) => {
  await signIn(page, 'manager@vista.local');
  await page.goto('/partners');
  await expect(page.locator('.partner-table')).toBeVisible();
  await page.setViewportSize({ width: 768, height: 720 });

  expect(await page.locator('body').evaluate((el) => el.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const table = page.locator('.partner-table-wrap');
  expect(await table.evaluate((el) => el.scrollWidth >= el.clientWidth)).toBe(true);
  await table.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  expect(await table.evaluate((el) => el.scrollLeft + el.clientWidth >= el.scrollWidth - 1)).toBe(
    true,
  );

  await page.getByRole('button', { name: /Alfa Market Demo Ltd\./ }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await drawer.evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((animation) => animation.finished));
  });
  expect(
    await drawer.evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth + 1),
  ).toBe(true);
  expect(await drawer.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await drawer.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await drawer.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(await drawer.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1)).toBe(
    true,
  );
  await page.screenshot({
    path: test.info().outputPath('partner-drawer-tablet.png'),
    animations: 'disabled',
  });
});
