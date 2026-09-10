import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { ServiceReferenceData } from '@vista/contracts';
import { signIn as submitSignIn } from './sign-in.js';

test.use({ actionTimeout: 15000 });

async function signIn(page: Page, email: string) {
  await page.goto('http://127.0.0.1:5373/');
  await submitSignIn(page, email);
  await page
    .locator('.workspace-sidebar')
    .getByRole('link', { name: 'Service', exact: true })
    .click();
}

async function choose(page: Page, field: string, option: string | RegExp) {
  await page.getByRole('combobox', { name: `Search ${field}`, exact: true }).fill('');
  await page.getByRole('listbox').getByRole('option', { name: option, exact: true }).click();
}

test('assigned technician completes a signed repair with parts and Finance prepares its linked draft', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120000);
  await signIn(page, 'manager@vista.local');
  await page.getByRole('link', { name: /Service requests/ }).click();
  await page.getByRole('button', { name: 'New service request', exact: true }).click();
  await choose(page, 'Customer', 'Alfa Market Demo Ltd.');
  await choose(page, 'Service location', /Alfa Market.*Central Store/);
  await choose(page, 'Device and serial number', /DEMO-FR-ALFA-01/);
  await choose(page, 'Service type', 'Out of warranty');
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Problem description', { exact: true })
    .fill('Browser acceptance: printer output is faint.');
  await dialog.getByRole('button', { name: 'Create request', exact: true }).click();
  await dialog.getByRole('button', { name: 'Dispatch request', exact: true }).click();
  await choose(page, 'Technician', /Vista Demo Service Technician/);
  const visit = new Date();
  visit.setUTCDate(visit.getUTCDate() + 7);
  while ([0, 6].includes(visit.getUTCDay())) visit.setUTCDate(visit.getUTCDate() + 1);
  const day = visit.toISOString().slice(0, 10);
  await dialog.getByLabel('Scheduled start', { exact: true }).fill(`${day}T14:00`);
  await dialog.getByLabel('Scheduled end', { exact: true }).fill(`${day}T15:00`);
  await dialog.getByRole('button', { name: 'Assign visit', exact: true }).click();
  await dialog.getByRole('button', { name: 'Open work order', exact: true }).click();
  const workNumber = await dialog.locator('h2').innerText();
  await dialog.getByRole('button', { name: 'Close panel', exact: true }).click();

  const technicianContext = await browser.newContext();
  try {
    const technician = await technicianContext.newPage();
    await signIn(technician, 'technician@vista.local');
    const stockBefore = technician.waitForResponse(
      (response) => response.url().endsWith('/service/reference-data') && response.ok(),
    );
    await technician.getByRole('link', { name: /Work orders/ }).click();
    const before = (await (await stockBefore).json()) as ServiceReferenceData;
    const partBefore = before.parts.find((part) => part.productName === 'Demo Thermal Print Head');
    expect(partBefore?.availableQuantity).toBe('5.0000');
    await technician.getByRole('button', { name: new RegExp(workNumber) }).click();
    const work = technician.getByRole('dialog');
    await work.getByRole('button', { name: 'Start work', exact: true }).click();
    await expect(work.getByLabel('Service photo', { exact: true })).toBeEnabled();
    const photoBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=',
      'base64',
    );
    await work.getByLabel('Service photo', { exact: true }).setInputFiles({
      name: 'not-a-photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from('Not an image'),
    });
    const invalid = technician.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/photos'),
    );
    await work.getByRole('button', { name: 'Upload photo', exact: true }).click();
    expect((await invalid).status()).toBe(400);
    await work
      .getByLabel('Service photo', { exact: true })
      .setInputFiles({ name: 'repair-photo.png', mimeType: 'image/png', buffer: photoBytes });
    let committedId = '';
    await technician.route(
      '**/service/work-orders/*/photos',
      async (route) => {
        const result = await route.fetch();
        expect(result.status()).toBe(201);
        committedId = ((await result.json()) as { id: string }).id;
        await route.abort('failed');
      },
      { times: 1 },
    );
    await work.getByRole('button', { name: 'Upload photo', exact: true }).click();
    await expect.poll(() => committedId).not.toBe('');
    await expect(work.getByRole('button', { name: 'Upload photo', exact: true })).toBeEnabled();
    let blockPhoto = true;
    await technician.route('**/service/work-orders/*/photos/*', (route) =>
      blockPhoto ? route.abort('failed') : route.continue(),
    );
    const retryUpload = technician.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/photos'),
    );
    await work.getByRole('button', { name: 'Upload photo', exact: true }).click();
    expect(((await (await retryUpload).json()) as { id: string }).id).toBe(committedId);
    const gallery = work.locator('.service-evidence-gallery');
    await expect(gallery.getByRole('alert')).toBeVisible();
    blockPhoto = false;
    await gallery.getByRole('button', { name: 'Try again' }).click();
    const image = gallery.getByRole('img', { name: 'Service photo: repair-photo.png' });
    await expect(image).toBeVisible();
    expect(await image.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1);
    await expect(gallery.locator('figure')).toHaveCount(1);
    const downloading = technician.waitForEvent('download');
    await gallery.getByRole('link', { name: 'Download' }).click();
    expect(await readFile(await (await downloading).path())).toEqual(photoBytes);
    await work.getByRole('button', { name: 'Complete work', exact: true }).click();
    await technician.setViewportSize({ width: 390, height: 844 });
    await work
      .getByLabel('Completion notes', { exact: true })
      .fill('Replaced print head and checked clear test receipts.');
    await work.getByLabel('Minutes', { exact: true }).fill('45');
    await work.getByLabel('Labour cost (BGN)', { exact: true }).fill('50');
    await work.getByLabel('Transport cost (BGN)', { exact: true }).fill('10');
    await work.getByRole('button', { name: 'Add used part', exact: true }).click();
    await choose(technician, 'Part', /Demo Thermal Print Head/);
    await work.getByLabel('Quantity', { exact: true }).fill('1');
    await work.getByLabel('Batch number', { exact: true }).fill('DEMO-HEAD-2028');
    await work
      .getByLabel('Customer representative', { exact: true })
      .fill('Browser Service Customer');
    await work.getByRole('button', { name: 'Complete work', exact: true }).click();
    await expect(
      work.getByText('Capture the customer signature before completing the work order.'),
    ).toBeVisible();
    const canvas = work.getByLabel('Customer signature pad', { exact: true });
    await canvas.scrollIntoViewIfNeeded();
    const bounds = await canvas.boundingBox();
    if (!bounds) throw Error('Signature canvas is not visible');
    await technician.mouse.move(bounds.x + 20, bounds.y + 35);
    await technician.mouse.down();
    await technician.mouse.move(bounds.x + 65, bounds.y + 70, { steps: 8 });
    await technician.mouse.move(bounds.x + 120, bounds.y + 25, { steps: 8 });
    await technician.mouse.up();
    expect(await work.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await work.getByRole('button', { name: 'Complete work', exact: true }).click();
    await expect(work.getByText('Completed', { exact: true }).first()).toBeVisible();
    await expect(work.getByText('Browser Service Customer', { exact: true })).toBeVisible();
    await expect(work.locator('.service-cost-grid dd')).toHaveText([
      'BGN 50.00',
      'BGN 46.00',
      'BGN 10.00',
      'BGN 106.00',
    ]);
    await expect(work.locator('.service-part-list')).toContainText(
      '1.0000 from Demo Technician Warehouse',
    );
    await expect(
      work.getByRole('img', { name: 'Signature from Browser Service Customer' }),
    ).toBeVisible();
    await expect(work.getByRole('img', { name: 'Service photo: repair-photo.png' })).toBeVisible();
    await work.locator('.service-evidence-gallery').scrollIntoViewIfNeeded();
    await technician.screenshot({ path: testInfo.outputPath('completed-service-mobile.png') });
    const stockAfter = technician.waitForResponse(
      (response) => response.url().endsWith('/service/reference-data') && response.ok(),
    );
    await technician.reload();
    const after = (await (await stockAfter).json()) as ServiceReferenceData;
    expect(
      after.parts.find((part) => part.productId === partBefore?.productId)?.availableQuantity,
    ).toBe('4.0000');
  } finally {
    await technicianContext.close();
  }

  await page.getByRole('link', { name: 'Work orders', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(workNumber) }).click();
  await expect(dialog.getByText('Browser Service Customer', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'Service photo: repair-photo.png' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Prepare invoice draft', exact: true }).click();
  await dialog.getByRole('button', { name: 'Prepare draft', exact: true }).click();
  await expect(dialog.getByText('No official number allocated')).toBeVisible();
  await expect(dialog.getByText(/Prepared from completed Service work/)).toContainText(workNumber);
});
