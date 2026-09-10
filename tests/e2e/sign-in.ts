import { expect, type Page } from '@playwright/test';
import { setTimeout } from 'node:timers/promises';

// Repeated isolated journeys can hit the real per-account login limit.
// Respect its advertised cooldown; never disable authentication protection.
export async function signIn(page: Page, email: string): Promise<void> {
  await page.getByLabel('Work email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Vista-Browser-Test-7!');
  await submitLogin(page, 'Sign in');
}

export async function submitLogin(
  page: Page,
  buttonName: string,
  prepare?: () => Promise<void>,
  expectedStatus = 200,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await prepare?.();
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith('/auth/login') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: buttonName, exact: true }).click();
    const response = await responsePromise;
    if (response.status() !== 429 || attempt === 1) {
      expect(response.status()).toBe(expectedStatus);
      return;
    }
    const seconds = Number(response.headers()['x-ratelimit-reset']);
    expect(Number.isFinite(seconds) && seconds >= 0 && seconds <= 60).toBe(true);
    await setTimeout(seconds * 1000 + 250);
  }
}
