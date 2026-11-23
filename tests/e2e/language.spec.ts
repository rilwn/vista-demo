import { expect, test } from '@playwright/test';
import { signIn } from './sign-in.js';

for (const [app, port] of [
  ['Operations', 5373],
  ['POS', 5374],
  ['Recovery', 5375],
] as const) {
  test(`${app} sign-in switches languages, preserves input and remembers the choice`, async ({
    page,
  }) => {
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.getByLabel('Work email', { exact: true }).fill('language-check@example.invalid');
    await page.getByRole('button', { name: 'BG', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'bg');
    await expect(page.getByLabel('Служебен имейл', { exact: true })).toHaveValue(
      'language-check@example.invalid',
    );
    await expect(page.getByRole('button', { name: 'Вход', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Вход', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  });
}

test('Operations translates the nested product form and generated dropdown prompts', async ({
  page,
}) => {
  await page.goto('/');
  await signIn(page, 'warehouse@vista.local');
  await expect(page.locator('.workspace-sidebar')).toBeVisible();
  await page.goto('/catalog');
  await expect(page.getByRole('heading', { name: 'Product catalog' })).toBeVisible();
  await expect(page.getByText('Demo 12 V Power Adapter', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'BG', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Продуктов каталог' })).toBeVisible();
  const add = page.getByRole('button', { name: 'Добавяне на продукт', exact: true });
  await expect(add).toBeVisible();
  await add.click();
  const form = page.getByRole('dialog');
  await expect(form.getByRole('heading', { name: 'Добавяне на продукт' })).toBeVisible();
  const category = form.getByRole('combobox', { name: 'Търсене: Категория' });
  await expect(category).toBeVisible();
  await category.fill('zzzz-no-choice');
  await expect(form.getByText('Няма съвпадения')).toBeVisible();
});
