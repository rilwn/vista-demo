import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { parseEnvironment } from '@vista/config';
import { TotpService } from '../../apps/api/dist/auth/totp.service.js';
import { provisionInitialAdministrator } from '../../apps/api/dist/auth/initial-administrator-provisioning.js';
import { submitLogin } from './sign-in.js';

const password = 'Vista-Browser-Test-7!';
const keys = new Map<string, string>();
const factors: string[] = [];
let pool: Pool;
let totp: TotpService;

test.beforeAll(async () => {
  const url = new URL(process.env['DATABASE_URL'] ?? '');
  if (
    process.env['VISTA_E2E_ISOLATED'] !== 'true' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '58432' ||
    url.pathname !== '/vista_e2e' ||
    url.username !== 'vista_e2e'
  )
    throw Error('Authentication fixtures require the disposable browser database.');
  pool = new Pool({ connectionString: url.href });
  totp = new TotpService(parseEnvironment(process.env));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const account = await client.query<{ password_hash: string }>(
      `SELECT account.password_hash FROM identity.user_accounts account
       JOIN identity.employees employee ON employee.id = account.employee_id
       WHERE employee.email = 'manager@vista.local'`,
    );
    // Playwright starts a new worker after a failed journey. Reuse only this
    // isolated run's administrator rather than cascading provisioning errors.
    const existingAdmin = await client.query<{ encrypted_secret: Buffer }>(
      `SELECT factor.encrypted_secret FROM identity.authentication_factors factor
       JOIN identity.user_accounts account ON account.id = factor.account_id
       JOIN identity.employees employee ON employee.id = account.employee_id
       WHERE employee.email = 'browser.admin@vista.local' AND factor.enabled
         AND factor.factor_type = 'totp' AND factor.verified_at IS NOT NULL`,
    );
    if (existingAdmin.rows[0]) {
      keys.set(
        'browser.admin@vista.local',
        totp.decryptSecret(existingAdmin.rows[0].encrypted_secret),
      );
    } else {
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
      keys.set(admin.email, admin.enrollmentKey);
    }
    for (const [email, name] of [
      ['browser.factor@vista.local', 'Browser Authenticator'],
      ['browser.password@vista.local', 'Browser Password'],
      ['browser.recovery@vista.local', 'Browser Recovery Administrator'],
    ]) {
      const existing = await client.query('SELECT id FROM identity.employees WHERE email = $1', [
        email,
      ]);
      if (existing.rowCount) continue;
      const employeeId = randomUUID();
      await client.query(
        `INSERT INTO identity.employees (id, employee_number, display_name, email)
        VALUES ($1, $2, $3, $4)`,
        [employeeId, employeeId, name, email],
      );
      await client.query(
        `INSERT INTO identity.user_accounts (employee_id, password_hash, password_changed_at)
        VALUES ($1, $2, now())`,
        [employeeId, account.rows[0].password_hash],
      );
    }
    await client.query(`INSERT INTO iam.account_roles (account_id, role_id)
      SELECT target.id, assignment.role_id FROM identity.user_accounts target
      JOIN identity.employees employee ON employee.id = target.employee_id
      CROSS JOIN iam.account_roles assignment
      JOIN identity.user_accounts issuer ON issuer.id = assignment.account_id
      JOIN identity.employees administrator ON administrator.id = issuer.employee_id
      WHERE employee.email = 'browser.recovery@vista.local'
        AND administrator.email = 'browser.admin@vista.local'
      ON CONFLICT DO NOTHING`);
    for (const email of [
      'manager@vista.local',
      'pos.operator@vista.local',
      'backup.operator@vista.local',
      'browser.recovery@vista.local',
    ]) {
      const secret = totp.generateSecret();
      const factorId = randomUUID();
      const inserted = await client.query(
        `INSERT INTO identity.authentication_factors
         (id, account_id, factor_type, encrypted_secret, enabled, verified_at)
         SELECT $1, account.id, 'totp', $2, true, now()
         FROM identity.user_accounts account JOIN identity.employees employee
         ON employee.id = account.employee_id WHERE employee.email = $3`,
        [factorId, totp.encryptSecret(secret), email],
      );
      expect(inserted.rowCount).toBe(1);
      factors.push(factorId);
      keys.set(email, secret);
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
  if (!pool) return;
  try {
    // Only factors created above, in this disposable database; later cashier journeys stay independent.
    await pool.query('DELETE FROM identity.authentication_factors WHERE id = ANY($1::uuid[])', [
      factors,
    ]);
  } finally {
    await pool.end();
  }
});

async function credentials(page: Page, email: string) {
  await page.getByLabel('Work email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

async function sessionToken(page: Page, storageKey: string): Promise<string> {
  const token = await page.evaluate((key) => {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? '{}');
    if (typeof value !== 'object' || value === null || !('sessionToken' in value)) return null;
    return typeof value.sessionToken === 'string' ? value.sessionToken : null;
  }, storageKey);
  if (!token) throw Error('The signed-in browser must have a session');
  return token;
}

async function openAccess(page: Page) {
  await page.getByRole('button', { name: 'Open account menu' }).click();
  await page.getByRole('menuitem', { name: 'My access & security' }).click();
  await expect(page.getByRole('heading', { name: 'My access', exact: true })).toBeVisible();
}

async function signOutOperations(page: Page) {
  await page.getByRole('button', { name: 'Open account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
}

async function revoked(page: Page, token: string) {
  const response = await page.request.get('/api/v1/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(401);
}

test('employee enrolls and removes an authenticator with validation and session revocation', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const email = 'browser.factor@vista.local';
  await page.goto('/');
  await credentials(page, email);
  await openAccess(page);
  const other = await browser.newContext();
  try {
    const second = await other.newPage();
    await second.goto('http://127.0.0.1:5373/');
    await credentials(second, email);
    await expect(second.locator('.workspace-sidebar')).toBeVisible();
    const oldToken = await sessionToken(second, 'vista.erp-crm.session.v1');
    await page.getByRole('button', { name: 'Set up authenticator', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      dialog.getByRole('button', { name: 'Set up authenticator', exact: true }),
    ).toBeInViewport();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    const panelBox = await dialog.boundingBox();
    const footerBox = await dialog.locator('.security-drawer-actions').boundingBox();
    expect(panelBox).not.toBeNull();
    expect(footerBox).not.toBeNull();
    expect(
      Math.abs(footerBox!.y + footerBox!.height - panelBox!.y - panelBox!.height),
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(footerBox!.width - panelBox!.width)).toBeLessThanOrEqual(2);
    await page.screenshot({ path: test.info().outputPath('authenticator-setup-mobile.png') });
    await page.setViewportSize({ width: 1280, height: 720 });
    await dialog
      .getByLabel('Current password', { exact: true })
      .fill('Incorrect-Browser-Password-7!');
    await dialog.getByRole('button', { name: 'Set up authenticator', exact: true }).click();
    await expect(dialog.getByText('Enter the correct current password.')).toBeVisible();
    await dialog.getByLabel('Current password', { exact: true }).fill(password);
    await dialog.getByRole('button', { name: 'Set up authenticator', exact: true }).click();
    const secret = (await dialog.locator('.authenticator-setup-key code').innerText()).replace(
      /\s/g,
      '',
    );
    await dialog.getByLabel('Authentication code', { exact: true }).fill(invalidCode(secret));
    await dialog.getByRole('button', { name: 'Verify authenticator' }).click();
    await expect(
      dialog.getByText('Enter the current six-digit code from your authenticator app.'),
    ).toBeVisible();
    await dialog.getByLabel('Authentication code', { exact: true }).fill(totp.generateCode(secret));
    await dialog.getByRole('button', { name: 'Verify authenticator' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Remove authenticator', exact: true }),
    ).toBeVisible();
    await revoked(page, oldToken);
    await signOutOperations(page);
    await credentials(page, email);
    await page.getByLabel('Authentication code', { exact: true }).fill(totp.generateCode(secret));
    await page.getByRole('button', { name: 'Verify and continue' }).click();
    await openAccess(page);
    await page.getByRole('button', { name: 'Remove authenticator', exact: true }).click();
    await dialog.getByLabel('Current password', { exact: true }).fill(password);
    await dialog.getByLabel('Authentication code', { exact: true }).fill(totp.generateCode(secret));
    await dialog.getByRole('button', { name: 'Remove authenticator', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Set up authenticator', exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: test.info().outputPath('authenticator-removed-mobile.png') });
    await page.setViewportSize({ width: 1280, height: 720 });
    await signOutOperations(page);
    await credentials(page, email);
    await expect(page.locator('.workspace-sidebar')).toBeVisible();
    await expect(page.getByLabel('Authentication code', { exact: true })).toHaveCount(0);
  } finally {
    await other.close();
  }
});

test('password change, expiry and administrator recovery revoke sessions and reject code reuse', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const email = 'browser.password@vista.local';
  const changed = 'Vista-Changed-Browser-8!';
  const recovered = 'Vista-Recovered-Browser-9!';
  await page.goto('/');
  await credentials(page, email);
  await openAccess(page);
  const other = await browser.newContext();
  try {
    const second = await other.newPage();
    await second.goto('http://127.0.0.1:5373/');
    await credentials(second, email);
    await expect(second.locator('.workspace-sidebar')).toBeVisible();
    const oldToken = await sessionToken(second, 'vista.erp-crm.session.v1');
    await page.getByRole('button', { name: 'Change password', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Current password', { exact: true }).fill(password);
    await dialog.getByLabel('New password', { exact: true }).fill(changed);
    await dialog
      .getByLabel('Confirm new password', { exact: true })
      .fill('Not-The-Same-Password-8!');
    await dialog.getByRole('button', { name: 'Update password' }).click();
    await expect(dialog.getByText('The new passwords do not match.')).toBeVisible();
    await dialog.getByLabel('Confirm new password', { exact: true }).fill(changed);
    await dialog.getByRole('button', { name: 'Update password' }).click();
    await expect(dialog).toHaveCount(0);
    await revoked(page, oldToken);
    const remaining = await other.newPage();
    await remaining.goto('http://127.0.0.1:5373/');
    await remaining.getByLabel('Work email', { exact: true }).fill(email);
    await remaining.getByLabel('Password', { exact: true }).fill(changed);
    await remaining.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(remaining.locator('.workspace-sidebar')).toBeVisible();
    const currentToken = await sessionToken(remaining, 'vista.erp-crm.session.v1');
    await signOutOperations(page);
    // Simulate a policy expiry only on this new disposable fixture account.
    const expired = await pool.query(
      `UPDATE identity.user_accounts account SET password_expires_at = now() - interval '1 day'
      FROM identity.employees employee WHERE employee.id = account.employee_id AND employee.email = $1`,
      [email],
    );
    expect(expired.rowCount).toBe(1);
    await page.getByLabel('Work email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(changed);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(/expired/i);
    await page.getByRole('link', { name: 'Use a recovery code' }).click();
    await expect(page.getByRole('heading', { name: 'Recover your account' })).toBeVisible();
    // Administrator verifies the employee, then issues the handoff through Security.
    await second.goto('http://127.0.0.1:5373/');
    await credentials(second, 'browser.admin@vista.local');
    await second
      .getByLabel('Authentication code', { exact: true })
      .fill(totp.generateCode(keys.get('browser.admin@vista.local')!));
    await second.getByRole('button', { name: 'Verify and continue' }).click();
    await second
      .locator('.workspace-sidebar')
      .getByRole('link', { name: 'Security', exact: true })
      .click();
    await second.getByLabel('Find an employee').fill(email);
    await second.getByRole('button', { name: 'Manage', exact: true }).click();
    await second.getByRole('button', { name: 'Issue recovery handoff' }).click();
    await second
      .getByLabel('Identity verification note')
      .fill('Browser acceptance: employee identity confirmed in person.');
    await second.getByRole('button', { name: 'Issue recovery code', exact: true }).click();
    const recoveryCode = await second.locator('.security-recovery-code code').innerText();
    await page.getByLabel('Work email', { exact: true }).fill(email);
    await page.getByLabel('Recovery code', { exact: true }).fill(recoveryCode);
    await page.getByLabel('New password', { exact: true }).fill(recovered);
    await page.getByLabel('Confirm new password', { exact: true }).fill(recovered);
    await page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Account recovered' })).toBeVisible();
    await revoked(page, currentToken);
    await page.screenshot({ path: test.info().outputPath('account-recovered.png') });
    const replay = await page.request.post('/api/v1/auth/recovery/complete', {
      data: { email, newPassword: 'Vista-Replay-Browser-10!', recoveryCode },
    });
    expect(replay.status()).toBe(400);
    expect(await replay.json()).toMatchObject({ error: { code: 'RECOVERY_CODE_INVALID' } });
    await page.getByRole('link', { name: 'Back to sign in' }).click();
    await page.getByLabel('Work email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(recovered);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('.workspace-sidebar')).toBeVisible();
  } finally {
    await other.close();
  }
});

test('administrator recovery requires a new authenticator and safely retries the handoff', async ({
  page,
  browser,
}) => {
  const email = 'browser.recovery@vista.local';
  const recoveredPassword = 'Vista-Admin-Recovered-Browser-9!';
  await page.goto('/');
  await credentials(page, email);
  await page
    .getByLabel('Authentication code', { exact: true })
    .fill(totp.generateCode(keys.get(email)!));
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page.locator('.workspace-sidebar')).toBeVisible();
  const oldToken = await sessionToken(page, 'vista.erp-crm.session.v1');
  const issuerContext = await browser.newContext();
  try {
    const issuer = await issuerContext.newPage();
    await issuer.goto('http://127.0.0.1:5373/');
    await credentials(issuer, 'browser.admin@vista.local');
    await issuer
      .getByLabel('Authentication code', { exact: true })
      .fill(totp.generateCode(keys.get('browser.admin@vista.local')!));
    await issuer.getByRole('button', { name: 'Verify and continue' }).click();
    await issuer
      .locator('.workspace-sidebar')
      .getByRole('link', { name: 'Security', exact: true })
      .click();
    await issuer.getByLabel('Find an employee').fill(email);
    await issuer.getByRole('button', { name: 'Manage', exact: true }).click();
    await issuer.getByRole('button', { name: 'Issue recovery handoff' }).click();
    await issuer
      .getByLabel('Identity verification note')
      .fill('Administrator identity confirmed in person for browser acceptance.');
    const requestKeys: string[] = [];
    await issuer.route('**/recovery-handoff', async (route) => {
      requestKeys.push(route.request().headers()['idempotency-key'] ?? '');
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      if (requestKeys.length === 1) await route.abort('failed');
      else await route.fulfill({ response });
    });
    await issuer.getByRole('button', { name: 'Issue recovery code', exact: true }).click();
    await expect(issuer.getByRole('alert')).toBeVisible();
    await issuer.getByRole('button', { name: 'Issue recovery code', exact: true }).click();
    const code = await issuer.locator('.security-recovery-code code').innerText();
    expect(requestKeys).toHaveLength(2);
    expect(requestKeys[0]).toBeTruthy();
    expect(requestKeys[1]).toBe(requestKeys[0]);
    // Simulate a lost browser session without revoking the server session under test.
    await page.evaluate(() => sessionStorage.removeItem('vista.erp-crm.session.v1'));
    await page.goto('/login');
    await page.getByRole('link', { name: 'Use a recovery code' }).click();
    await page.getByLabel('Work email', { exact: true }).fill(email);
    await page.getByLabel('Recovery code', { exact: true }).fill(code);
    await page.getByLabel('New password', { exact: true }).fill(recoveredPassword);
    await page.getByLabel('Confirm new password', { exact: true }).fill(recoveredPassword);
    await page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'One more security step' })).toBeVisible();
    await revoked(page, oldToken);
    const blocked = await page.request.post('/api/v1/auth/login', {
      data: { email, password: recoveredPassword },
    });
    expect(blocked.status()).toBe(403);
    await page.getByRole('button', { name: 'Set up authenticator', exact: true }).click();
    const secret = (await page.locator('.authenticator-setup-key code').innerText()).replace(
      /\s/g,
      '',
    );
    await page.getByLabel('Authentication code', { exact: true }).fill(invalidCode(secret));
    await page.getByRole('button', { name: 'Verify and finish', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('current six-digit code');
    await page.getByLabel('Authentication code', { exact: true }).fill(totp.generateCode(secret));
    await page.getByRole('button', { name: 'Verify and finish', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Account recovered' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: test.info().outputPath('administrator-recovered-mobile.png') });
    const reused = await page.request.post('/api/v1/auth/recovery/totp/enrollment', {
      data: { email, recoveryCode: code },
    });
    expect(reused.status()).toBe(400);
    await page.getByRole('link', { name: 'Back to sign in' }).click();
    await page.getByLabel('Work email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(recoveredPassword);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByLabel('Authentication code', { exact: true }).fill(totp.generateCode(secret));
    await page.getByRole('button', { name: 'Verify and continue' }).click();
    await expect(page.locator('.workspace-sidebar')).toBeAttached();
    const token = await sessionToken(page, 'vista.erp-crm.session.v1');
    const me = await page.request.get('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await me.json()).toMatchObject({ isAdministrative: true, twoFactorVerified: true });
  } finally {
    await issuerContext.close();
  }
});

function invalidCode(secret: string): string {
  let code = '000000';
  while (totp.verify(code, totp.encryptSecret(secret)))
    code = String(Number(code) + 1).padStart(6, '0');
  return code;
}

for (const app of [
  {
    name: 'Operations',
    port: 5373,
    email: 'manager@vista.local',
    shell: '.workspace-sidebar',
    key: 'vista.erp-crm.session.v1',
  },
  {
    name: 'POS',
    port: 5374,
    email: 'pos.operator@vista.local',
    shell: '.pos-terminal',
    key: 'vista.pos.session.v1',
  },
  {
    name: 'Recovery',
    port: 5375,
    email: 'backup.operator@vista.local',
    shell: '.backup-console',
    key: 'vista.backup-control.session.v1',
  },
]) {
  test(`${app.name} rejects an incorrect MFA code, restores the verified session and revokes sign-out`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.goto(`http://127.0.0.1:${app.port}/`);
    await credentials(page, app.email);
    const code = page.getByLabel('Authentication code', { exact: true });
    await expect(code).toBeVisible();
    await expect(page.locator(app.shell)).toHaveCount(0);
    expect((await page.request.get(`http://127.0.0.1:${app.port}/api/v1/auth/me`)).status()).toBe(
      401,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(code).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: test.info().outputPath(`${app.name.toLowerCase()}-mfa-mobile.png`),
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    const secret = keys.get(app.email)!;
    // Choose a code outside every accepted clock window, avoiding a probabilistic failure.
    await submitLogin(
      page,
      'Verify and continue',
      async () => {
        await code.fill(invalidCode(secret));
      },
      401,
    );
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator(app.shell)).toHaveCount(0);
    // Earlier journeys use this same account. Honor its real cooldown and
    // regenerate the code after waiting, without changing security settings.
    await submitLogin(page, 'Verify and continue', async () => {
      await code.fill(totp.generateCode(secret));
    });
    await expect(page.locator(app.shell)).toBeVisible();
    await page.reload();
    await expect(page.locator(app.shell)).toBeVisible();
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    const help = page.getByRole('dialog', { name: 'How can we help?' });
    await expect(help).toBeVisible();
    await help.getByLabel('Search help').fill(app.name === 'Recovery' ? 'restore' : 'sign-in');
    await expect(help.locator('details').first()).toBeVisible();
    await page.setViewportSize({ width: 390, height: 640 });
    await expect(help.getByRole('button', { name: 'Back to work' })).toBeInViewport();
    expect(await help.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`${app.name.toLowerCase()}-help.png`) });
    await help.getByRole('button', { name: 'Back to work' }).click();
    await expect(help).not.toBeVisible();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.screenshot({
      path: test.info().outputPath(`${app.name.toLowerCase()}-verified.png`),
    });
    // Inspect the browser's own credential only to prove backend revocation, never print it.
    const token = await sessionToken(page, app.key);
    if (app.name === 'Operations')
      await page.getByRole('button', { name: /account menu/i }).click();
    if (app.name === 'POS') await page.getByRole('button', { name: /account menu/i }).click();
    await page
      .getByRole(app.name === 'Operations' ? 'menuitem' : 'button', {
        name: 'Sign out',
        exact: true,
      })
      .click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    const response = await page.request.get(`http://127.0.0.1:${app.port}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status()).toBe(401);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  });
}

test('unassigned employee cannot enter POS or Recovery and can return to sign-in', async ({
  page,
}) => {
  for (const [port, title] of [
    [5374, 'POS access is not assigned'],
    [5375, 'Backup access is not assigned'],
  ] as const) {
    await page.goto(`http://127.0.0.1:${port}/`);
    await credentials(page, 'viewer@vista.local');
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    const token = await sessionToken(
      page,
      port === 5374 ? 'vista.pos.session.v1' : 'vista.backup-control.session.v1',
    );
    const denied = await page.request.get(`http://127.0.0.1:${port}/api/v1/pos/terminal-context`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(denied.status()).toBe(403);
    await page.reload();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  }
});

test('Recovery blocks a password-only backup session and explains authenticator setup', async ({
  page,
}) => {
  // Remove only this suite's temporary backup factor in the isolated database.
  await pool.query(
    `DELETE FROM identity.authentication_factors factor USING identity.user_accounts account,
    identity.employees employee WHERE factor.account_id = account.id AND account.employee_id = employee.id
    AND employee.email = 'backup.operator@vista.local' AND factor.id = ANY($1::uuid[])`,
    [factors],
  );
  await page.goto('http://127.0.0.1:5375/');
  await credentials(page, 'backup.operator@vista.local');
  await expect(
    page.getByRole('heading', { name: 'Set up your authenticator first' }),
  ).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Backup control navigation' })).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Set up your authenticator first' }),
  ).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('recovery-mfa-required.png') });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
});
