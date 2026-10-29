import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { parseEnvironment } from '@vista/config';
import { TotpService } from '../../apps/api/dist/auth/totp.service.js';
import { provisionInitialAdministrator } from '../../apps/api/dist/auth/initial-administrator-provisioning.js';
import { submitLogin } from './sign-in.js';

let pool: Pool;
let totp: TotpService;
let secret: string;
test.setTimeout(120000);

test.beforeAll(async () => {
  const url = new URL(process.env['DATABASE_URL'] ?? '');
  if (
    process.env['VISTA_E2E_ISOLATED'] !== 'true' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '58432' ||
    url.pathname !== '/vista_e2e' ||
    url.username !== 'vista_e2e'
  )
    throw Error('Security UI tests require the disposable browser database.');
  pool = new Pool({ connectionString: url.href });
  totp = new TotpService(parseEnvironment(process.env));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query<{ encrypted_secret: Buffer }>(
      `SELECT factor.encrypted_secret FROM identity.authentication_factors factor
       JOIN identity.user_accounts account ON account.id = factor.account_id
       JOIN identity.employees employee ON employee.id = account.employee_id
       WHERE employee.email = 'browser.admin@vista.local' AND factor.enabled
       AND factor.factor_type = 'totp' AND factor.verified_at IS NOT NULL`,
    );
    if (existing.rows[0]) secret = totp.decryptSecret(existing.rows[0].encrypted_secret);
    else {
      const account = await client.query<{ password_hash: string }>(
        `SELECT account.password_hash FROM identity.user_accounts account
         JOIN identity.employees employee ON employee.id = account.employee_id
         WHERE employee.email = 'manager@vista.local'`,
      );
      const admin = await provisionInitialAdministrator(
        client,
        {
          email: 'browser.admin@vista.local',
          displayName: 'Browser Administrator',
          employeeNumber: 'BROWSER-ADMIN',
          passwordHash: account.rows[0].password_hash,
          passwordExpiresAt: null,
        },
        totp,
      );
      secret = admin.enrollmentKey;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});
test.afterAll(async () => {
  await pool?.end();
});

async function openSecurity(page: Page) {
  await page.goto('/');
  await page.getByLabel('Work email', { exact: true }).fill('browser.admin@vista.local');
  await page.getByLabel('Password', { exact: true }).fill('Vista-Browser-Test-7!');
  await submitLogin(page, 'Sign in', undefined, 401);
  await submitLogin(page, 'Verify and continue', async () => {
    await page.getByLabel('Authentication code', { exact: true }).fill(totp.generateCode(secret));
  });
  await page
    .locator('.workspace-sidebar')
    .getByRole('link', { name: 'Security', exact: true })
    .click();
  await expect(page.getByLabel('Find an employee')).toBeVisible();
}

test('employee access scrolls independently with aligned actions and retained role choices', async ({
  page,
}) => {
  await openSecurity(page);
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.getByLabel('Find an employee').fill('crm@vista.local');
  const trigger = page.getByRole('button', { name: 'Manage', exact: true });
  await expect(trigger).toHaveCount(1);
  await trigger.click();
  const panel = page.getByRole('dialog');
  await expect(panel.getByRole('heading', { name: 'Employee access' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Back to security' })).toBeFocused();
  expect(
    await page.locator('#root').evaluate((node) => node instanceof HTMLElement && node.inert),
  ).toBe(true);
  const bounds = (await panel.boundingBox())!;
  expect(bounds.x + bounds.width).toBe(1920);
  expect(bounds.y).toBe(0);
  expect(bounds.width).toBeLessThanOrEqual(640);
  const avatar = (await panel.locator('.security-account-avatar').boundingBox())!;
  const identity = (await panel.locator('.security-account-detail > div').boundingBox())!;
  const status = (await panel
    .locator('.security-account-detail > .security-status')
    .boundingBox())!;
  expect(identity.x).toBeGreaterThanOrEqual(avatar.x + avatar.width);
  expect(status.x).toBeGreaterThanOrEqual(identity.x + identity.width);
  expect(status.y).toBeGreaterThanOrEqual(avatar.y);
  await page.screenshot({ path: test.info().outputPath('employee-access-details-desktop.png') });
  const selected = await panel.getByRole('checkbox', { checked: true }).count();
  await panel.getByLabel('Find a role').fill('Warehouse');
  const warehouse = panel.getByRole('checkbox', { name: /Warehouse/u });
  await expect(warehouse).toHaveCount(1);
  await warehouse.check();
  await panel.getByLabel('Find a role').clear();
  expect(await panel.getByRole('checkbox', { checked: true }).count()).toBe(selected + 1);
  await panel.locator('.admin-drawer-body').evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(panel.getByRole('button', { name: 'Save roles' })).toBeInViewport();
  const footer = (await panel.locator('footer').boundingBox())!;
  expect(footer.x).toBe(bounds.x);
  expect(footer.width).toBe(bounds.width);
  expect(footer.y + footer.height).toBe(1000);
  await page.screenshot({ path: test.info().outputPath('employee-access-desktop.png') });
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('role access saves real permissions and fits Bulgarian phone layouts', async ({ page }) => {
  await openSecurity(page);
  await page.getByRole('tab', { name: /^Roles/u }).click();
  await page.getByRole('button', { name: 'Add role', exact: true }).click();
  const panel = page.getByRole('dialog');
  const name = `Service desk ${Date.now()}`;
  await panel.getByLabel('Role name', { exact: true }).fill(name);
  await panel.getByLabel('Role code', { exact: true }).fill(`ui.service.${Date.now()}`);
  await panel.getByRole('checkbox', { name: 'Service View', exact: true }).check();
  await panel.getByRole('button', { name: 'Add role', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByLabel('Find a role').fill(name);
  await page.getByRole('button', { name: 'Edit access', exact: true }).click();
  await expect(panel.getByRole('checkbox', { name: 'Service View', exact: true })).toBeChecked();
  await page.screenshot({ path: test.info().outputPath('role-access-desktop.png') });
  await panel.getByLabel('Find a module').fill('Warehouse');
  await panel.getByRole('checkbox', { name: 'Warehouse View', exact: true }).check();
  await panel.getByRole('button', { name: 'Save access', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: 'BG', exact: true }).click();
  await expect(page.getByText('Достъпът на ролята е актуализиран.', { exact: true })).toBeVisible();
  await page.locator('.vista-toast button').click();
  await page.setViewportSize({ width: 390, height: 640 });
  await page
    .locator('.security-role-list article')
    .filter({ hasText: name })
    .getByRole('button')
    .click();
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(panel.getByRole('checkbox', { name: 'Сервиз Преглед', exact: true })).toBeChecked();
  await expect(panel.getByRole('checkbox', { name: 'Склад Преглед', exact: true })).toBeChecked();
  const search = (await panel.getByLabel('Намиране на модул').boundingBox())!;
  const count = (await panel.locator('.security-selection-count').boundingBox())!;
  expect(count.y).toBeGreaterThanOrEqual(search.y + search.height);
  await page.screenshot({ path: test.info().outputPath('role-access-bulgarian-phone-top.png') });
  await panel.locator('.admin-drawer-body').evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(panel.locator('footer button').last()).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('role-access-bulgarian-phone.png') });
  await page.keyboard.press('Escape');
});

test('account creation and recovery forms keep their actions visible on short screens', async ({
  page,
}) => {
  await openSecurity(page);
  await page.setViewportSize({ width: 390, height: 640 });
  await page.getByRole('button', { name: 'Add employee', exact: true }).click();
  const panel = page.getByRole('dialog');
  await expect(panel.getByLabel('Work email')).toBeVisible();
  await panel.locator('.admin-drawer-body').evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(panel.locator('footer button').last()).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('add-employee-phone.png') });
  await page.keyboard.press('Escape');
  await page.getByLabel('Find an employee').fill('crm@vista.local');
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('employee-access-phone.png') });
  await panel.getByRole('button', { name: 'Issue code', exact: true }).click();
  await expect(panel.getByLabel('Identity verification note')).toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'Issue recovery code', exact: true }),
  ).toBeInViewport();
  expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('recovery-handoff-phone.png') });
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});
