import { expect, test, type Page } from '@playwright/test';
import { signIn } from './sign-in.js';

test.use({ actionTimeout: 15000 });

async function openCrm(page: Page) {
  await page.goto('/');
  await signIn(page, 'manager@vista.local');
  await page
    .locator('.workspace-sidebar')
    .getByRole('link', { name: 'Customers & CRM', exact: true })
    .click();
}

async function choose(page: Page, field: string, option: string | RegExp) {
  await page.getByRole('combobox', { name: `Search ${field}`, exact: true }).fill('');
  await page.getByRole('listbox').getByRole('option', { name: option, exact: true }).click();
}

test('qualified lead reuses a customer, links a quotation and retains its won opportunity', async ({
  page,
}) => {
  await openCrm(page);
  await page.getByRole('link', { name: /Leads & opportunities/ }).click();
  await page.getByRole('button', { name: 'New lead', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Company or prospect name', { exact: true }).fill('Browser CRM enquiry');
  await dialog.getByLabel('Contact person', { exact: true }).fill('Browser CRM Contact');
  await dialog.getByLabel('Email', { exact: true }).fill('crm-acceptance@example.invalid');
  await dialog.getByRole('button', { name: 'Save lead', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page
    .locator('.crm-lead-list')
    .getByRole('button', { name: /Browser CRM enquiry/ })
    .click();
  await dialog.getByRole('button', { name: 'Mark as qualified', exact: true }).click();
  await dialog.getByRole('button', { name: 'Convert lead', exact: true }).click();
  await dialog.getByRole('radio', { name: /Use existing/ }).check();
  await choose(page, 'Existing customer', 'Alfa Market Demo Ltd.');
  await dialog.getByRole('checkbox', { name: /Create a sales opportunity/ }).check();
  await dialog
    .getByLabel('Opportunity name', { exact: true })
    .fill('Browser CRM equipment opportunity');
  await dialog.getByLabel('Estimated value (BGN)', { exact: true }).fill('600');
  await dialog.getByRole('button', { name: 'Convert lead', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: /^Sales pipeline/ }).click();
  await page.getByRole('button', { name: /Browser CRM equipment opportunity/ }).click();
  await choose(page, 'Available customer quotation', /DEV-Q-0001/);
  await dialog.getByRole('button', { name: 'Link quotation', exact: true }).click();
  await expect(dialog.locator('.crm-opportunity-quotations')).toContainText('DEV-Q-0001');
  await dialog.getByRole('button', { name: 'Close panel', exact: true }).click();
  const opportunity = page.getByRole('button', { name: /Browser CRM equipment opportunity/ });
  await opportunity.dragTo(page.locator('.crm-kanban-column.is-negotiation'));
  await expect(page.locator('.crm-kanban-column.is-negotiation')).toContainText(
    'Browser CRM equipment opportunity',
  );
  await opportunity.click();
  await expect(dialog.locator('.crm-opportunity-preview-hero')).toContainText('Negotiation');
  await choose(page, 'Next stage', 'Won');
  await dialog.getByRole('button', { name: 'Update stage', exact: true }).click();
  await expect(dialog.locator('.crm-opportunity-preview-hero')).toContainText('Won');
  await dialog.getByRole('button', { name: 'Close panel', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: /^Sales pipeline/ }).click();
  await page.getByRole('button', { name: /Browser CRM equipment opportunity/ }).click();
  await expect(dialog.locator('.crm-opportunity-preview-hero')).toContainText('Won');
  await expect(dialog.locator('.crm-opportunity-quotations')).toContainText('DEV-Q-0001');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('ticket and Service round trips keep the same linked records', async ({ page }) => {
  await openCrm(page);
  await page.getByRole('link', { name: /Tickets/ }).click();
  await page.getByRole('button', { name: 'New ticket', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await choose(page, 'Customer', 'Alfa Market Demo Ltd.');
  await choose(page, 'Location (optional)', /Alfa Market.*Central Store/);
  await choose(page, 'Device (optional)', /DEMO-FR-ALFA-01/);
  await dialog.getByLabel('Subject', { exact: true }).fill('Browser ticket print quality');
  await dialog
    .getByLabel('Details', { exact: true })
    .fill('Printer output is faint. Please arrange a technician check.');
  await dialog.getByRole('button', { name: 'Create ticket', exact: true }).click();
  await dialog.getByRole('button', { name: 'Create Service request', exact: true }).click();
  await choose(page, 'Service type', 'Out of warranty');
  await dialog.getByRole('button', { name: 'Create & link', exact: true }).click();
  const ticketNumber = await dialog.locator('h2').innerText();
  const requestNumber = await dialog.locator('.crm-ticket-linked-record strong').innerText();
  for (let attempt = 0; attempt < 2; attempt++) {
    await dialog.getByRole('button', { name: 'Open Service', exact: true }).click();
    await expect(dialog.locator('h2')).toHaveText(requestNumber);
    await dialog.getByRole('button', { name: 'Create or open ticket', exact: true }).click();
    await dialog.getByRole('button', { name: 'Create or open ticket', exact: true }).click();
    await expect(dialog.locator('h2')).toHaveText(ticketNumber);
    await expect(dialog.locator('.crm-ticket-linked-record strong')).toHaveText(requestNumber);
    await expect(
      dialog.getByRole('button', { name: 'Create Service request', exact: true }),
    ).toHaveCount(0);
  }
  await dialog.getByRole('button', { name: 'Close panel', exact: true }).click();
  await page
    .locator('.workspace-sidebar')
    .getByRole('link', { name: 'Service', exact: true })
    .click();
  await page.getByRole('link', { name: /Service requests/ }).click();
  await page.getByRole('button', { name: 'New service request', exact: true }).click();
  await choose(page, 'Customer', 'Alfa Market Demo Ltd.');
  await choose(page, 'Service location', /Alfa Market.*Central Store/);
  await choose(page, 'Device and serial number', /DEMO-FR-ALFA-01/);
  await choose(page, 'Service type', 'Out of warranty');
  await dialog
    .getByLabel('Problem description', { exact: true })
    .fill('Browser Service-originated customer enquiry.');
  await dialog.getByRole('button', { name: 'Create request', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Create or open ticket', exact: true }),
  ).toBeVisible();
  const reverseRequest = await dialog.locator('h2').innerText();
  await dialog.getByRole('button', { name: 'Create or open ticket', exact: true }).click();
  await dialog.getByRole('button', { name: 'Create or open ticket', exact: true }).click();
  await expect(dialog.locator('.crm-ticket-linked-record strong')).toHaveText(reverseRequest);
  const reverseTicket = await dialog.locator('h2').innerText();
  expect(reverseTicket).not.toBe(ticketNumber);
  await dialog.getByRole('button', { name: 'Open Service', exact: true }).click();
  await dialog.getByRole('button', { name: 'Create or open ticket', exact: true }).click();
  await dialog.getByRole('button', { name: 'Create or open ticket', exact: true }).click();
  await expect(dialog.locator('h2')).toHaveText(reverseTicket);
  await expect(dialog.locator('.crm-ticket-linked-record strong')).toHaveText(reverseRequest);
});

async function newQualifiedLead(page: Page, name: string) {
  await page.getByRole('button', { name: 'New lead', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Company or prospect name', { exact: true }).fill(name);
  await dialog.getByLabel('Contact person', { exact: true }).fill('Mira Petrova');
  await dialog.getByLabel('Email', { exact: true }).fill('mira@example.invalid');
  await dialog.getByRole('button', { name: 'Save lead', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page
    .locator('.crm-lead-list')
    .getByRole('button', { name: new RegExp(name) })
    .click();
  await dialog.getByRole('button', { name: 'Mark as qualified', exact: true }).click();
  await dialog.getByRole('button', { name: 'Convert lead', exact: true }).click();
}

async function interruptedCommand(page: Page, endpoint: string, button: string) {
  const keys: string[] = [];
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key'] ?? '');
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    if (keys.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  const submit = page.getByRole('dialog').getByRole('button', { name: button, exact: true });
  await submit.click();
  await expect(page.getByRole('alert')).toBeVisible();
  const completed = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.ok() &&
      response.url().endsWith(endpoint.split('/').at(-1)!),
  );
  await submit.click();
  await completed;
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  await page.unroute(endpoint);
}

test('new-customer conversion and a Lost outcome recover safely and remain linked', async ({
  page,
}) => {
  await openCrm(page);
  await page.getByRole('link', { name: /Leads & opportunities/ }).click();
  await newQualifiedLead(page, 'Browser North Star Retail');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Opportunity name', { exact: true }).fill('North Star equipment enquiry');
  await dialog.getByLabel('Estimated value (BGN)', { exact: true }).fill('600');
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole('button', { name: 'Convert lead', exact: true }).scrollIntoViewIfNeeded();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('conversion-mobile.png') });
  await interruptedCommand(page, '**/api/v1/crm/leads/*/convert', 'Convert lead');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: /^Sales pipeline/ }).click();
  await page.getByRole('button', { name: /North Star equipment enquiry/ }).click();
  await choose(page, 'Next stage', 'Lost');
  await expect(dialog.getByRole('spinbutton', { name: 'Probability %', exact: true })).toHaveValue(
    '0',
  );
  await expect(
    dialog.getByRole('spinbutton', { name: 'Probability %', exact: true }),
  ).toBeDisabled();
  await dialog
    .getByLabel('Progress note (optional)', { exact: true })
    .fill('Customer postponed the purchase until next year.');
  await interruptedCommand(page, '**/api/v1/crm/opportunities/*/stage', 'Update stage');
  await expect(dialog.locator('.crm-opportunity-preview-hero')).toContainText('Lost');
  await expect(
    dialog.getByText('Customer postponed the purchase until next year.', { exact: true }),
  ).toHaveCount(1);
  await page.reload();
  await page.getByRole('button', { name: /^Sales pipeline/ }).click();
  await page.getByRole('button', { name: /North Star equipment enquiry/ }).click();
  await expect(dialog.locator('.crm-opportunity-preview-hero')).toContainText('Lost');
  await expect(
    dialog.getByText('Customer postponed the purchase until next year.', { exact: true }),
  ).toHaveCount(1);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('lost-opportunity-mobile.png') });
  await dialog.getByRole('button', { name: 'Close panel', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page
    .locator('.workspace-sidebar')
    .getByRole('link', { name: 'Customers & CRM', exact: true })
    .click();
  await page.getByRole('link', { name: /Partner registry/ }).click();
  await expect(page.getByRole('button', { name: /Browser North Star Retail/ })).toHaveCount(1);
  await page.getByRole('button', { name: /Browser North Star Retail/ }).click();
  await expect(dialog).toContainText('Mira Petrova');
});

test('duplicate conversion keeps the form and supports choosing the existing customer', async ({
  page,
}) => {
  await openCrm(page);
  await page.getByRole('link', { name: /Leads & opportunities/ }).click();
  await newQualifiedLead(page, 'Browser duplicate check');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Customer name', { exact: true }).fill('Alfa Market Demo Ltd.');
  await dialog.getByRole('checkbox', { name: /Create a sales opportunity/ }).uncheck();
  await dialog.getByRole('button', { name: 'Convert lead', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('matching partner already exists');
  await expect(dialog.getByLabel('Customer name', { exact: true })).toHaveValue(
    'Alfa Market Demo Ltd.',
  );
  await dialog.getByRole('radio', { name: /Use existing/ }).check();
  await choose(page, 'Existing customer', 'Alfa Market Demo Ltd.');
  await dialog.getByRole('button', { name: 'Convert lead', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page
    .locator('.crm-lead-list')
    .getByRole('button', { name: /Browser duplicate check/ })
    .click();
  await expect(dialog).toContainText('Converted to customer');
  await expect(dialog).toContainText('Alfa Market Demo Ltd.');
  await expect(dialog.getByRole('button', { name: 'Convert lead', exact: true })).toHaveCount(0);
});
