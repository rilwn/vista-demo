import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ProcurementSupplierRecord } from '@vista/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';
import { messages, moduleMessages } from './messages';
import { RouterProvider } from './routing/Router';

const loginResponse = {
  account: {
    displayName: 'Mila Petrova',
    email: 'mila@example.invalid',
    id: '5dcb6f47-617d-473d-864e-2c5f3fd3c7cb',
    isAdministrative: false,
  },
  expiresAt: '2099-08-06T12:00:00.000Z',
  sessionToken: 'opaque-test-session',
};

const authenticationContext = {
  accountId: loginResponse.account.id,
  displayName: loginResponse.account.displayName,
  email: loginResponse.account.email,
  employeeId: '1390f07a-927d-475c-a598-47af5d2f8ceb',
  isAdministrative: false,
  permissions: [
    { action: 'view', module: 'erp.warehouse' },
    { action: 'view', module: 'crm' },
  ],
  sessionId: '0385d837-2d1d-490c-b560-865867fa67ac',
  twoFactorVerified: true,
};

const partner = {
  active: true,
  companyRepresentative: 'Elena Stoyanova',
  createdAt: '2026-08-06T12:00:00.000Z',
  displayName: 'Vista Retail Partner Ltd.',
  id: '72d8eca0-6b36-4eae-a7a6-5fffe54a3bbf',
  kind: 'legal_entity',
  roles: ['customer', 'supplier'],
  uic: '204000001',
  updatedAt: '2026-08-06T12:00:00.000Z',
  vatNumber: 'BG204000001',
  version: 1,
};

const partnerPage = {
  items: [partner],
  page: 1,
  pageSize: 25,
  total: 1,
  totalPages: 1,
};

const partnerProfile = {
  addresses: [
    {
      active: true,
      addressLine1: '12 Hristo Botev Blvd.',
      city: 'Vratsa',
      countryCode: 'BG',
      id: 'd4cf3191-8f1c-443a-86b1-6e4a0b032c50',
      postalCode: '3000',
      type: 'billing',
    },
  ],
  bankAccounts: [
    {
      active: true,
      bankName: 'Example Bank',
      bic: 'WESTGB22',
      currencyCode: 'BGN',
      iban: 'GB82WEST12345698765432',
      id: 'f8912828-81dd-491e-a12c-377d5bc97b68',
    },
  ],
  contacts: [
    {
      active: true,
      contactRole: 'accountant',
      displayName: 'Maria Petrova',
      email: 'maria.petrova@example.invalid',
      id: 'ab283413-55f5-4ee6-b2b3-6e19d9a2a905',
      jobTitle: 'Chief accountant',
      telephone: '+359 88 123 4567',
    },
  ],
  partner: { ...partner, version: 4 },
};

const productCategories = [
  {
    active: true,
    createdAt: '2026-08-07T10:00:00.000Z',
    id: 'bfa1dd2b-d7df-4e52-958a-5ad30dbf6c3c',
    name: 'Fiscal devices',
    updatedAt: '2026-08-07T10:00:00.000Z',
    version: 1,
  },
  {
    active: true,
    createdAt: '2026-08-07T10:01:00.000Z',
    id: 'a7d398ab-d4ae-43ea-9288-6141ac9db646',
    name: 'Cash registers',
    parentId: 'bfa1dd2b-d7df-4e52-958a-5ad30dbf6c3c',
    updatedAt: '2026-08-07T10:01:00.000Z',
    version: 1,
  },
];

const warehouseFixture = {
  active: true,
  code: 'CENTRAL',
  id: 'd86941e7-b55d-4026-9d31-bbf454646794',
  name: 'Central warehouse',
  type: 'standard',
  version: 1,
};

const technicianWarehouseFixture = {
  active: true,
  code: 'TECH-01',
  id: '465017e9-5c3b-4bca-93aa-1ad9a6595f8d',
  name: 'Technician warehouse 01',
  type: 'technician',
  version: 1,
};

const inventoryProductFixture = {
  active: true,
  barcodes: [],
  categoryId: productCategories[0]!.id,
  createdAt: '2026-08-10T08:00:00.000Z',
  id: 'b6149dcf-bf8f-44fb-b012-92321b0fd257',
  name: 'Fiscal device Alpha',
  productCode: 'FDA-01',
  trackingMode: 'serial',
  unitId: '73b41a0e-9a9d-49c1-90df-0c0c7792c26a',
  updatedAt: '2026-08-10T08:00:00.000Z',
  version: 1,
};

describe('ERP and CRM authenticated workspace', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends an anonymous employee to the sign-in page', async () => {
    renderApplication(['/']);

    expect(
      await screen.findByRole('heading', { name: messages.auth.credentialsTitle }),
    ).toBeTruthy();
    expect(screen.getByLabelText(messages.auth.emailLabel)).toBeTruthy();
    expect(screen.getByLabelText(messages.auth.passwordLabel)).toBeTruthy();
  });

  it('creates a session and shows only modules granted by the backend', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(loginResponse))
      .mockResolvedValueOnce(jsonResponse(authenticationContext));
    vi.stubGlobal('fetch', fetchMock);
    renderApplication(['/login']);

    fireEvent.change(screen.getByLabelText(messages.auth.emailLabel), {
      target: { value: loginResponse.account.email },
    });
    fireEvent.change(screen.getByLabelText(messages.auth.passwordLabel), {
      target: { value: 'ValidPassword!42' },
    });
    fireEvent.submit(screen.getByRole('button', { name: messages.auth.signIn }).closest('form')!);

    expect(
      await screen.findByRole('heading', {
        name: `${messages.home.title}, Mila.`,
      }),
    ).toBeTruthy();
    expect(screen.getAllByText(moduleMessages['erp.warehouse'].label).length).toBeGreaterThan(0);
    expect(screen.getAllByText(moduleMessages.crm.label).length).toBeGreaterThan(0);
    expect(screen.queryByText(moduleMessages['erp.finance'].label)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const currentAccountRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(currentAccountRequest.headers).get('Authorization')).toBe(
      `Bearer ${loginResponse.sessionToken}`,
    );
  });

  it('uses a focused second step when the API requires TOTP', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 'TWO_FACTOR_REQUIRED',
              correlationId: 'totp-test-correlation',
              message: 'A second-factor code is required',
              timestamp: '2026-08-06T12:00:00.000Z',
            },
          },
          401,
        ),
      )
      .mockResolvedValueOnce(jsonResponse(loginResponse))
      .mockResolvedValueOnce(jsonResponse(authenticationContext));
    vi.stubGlobal('fetch', fetchMock);
    renderApplication(['/login']);

    fireEvent.change(screen.getByLabelText(messages.auth.emailLabel), {
      target: { value: loginResponse.account.email },
    });
    fireEvent.change(screen.getByLabelText(messages.auth.passwordLabel), {
      target: { value: 'ValidPassword!42' },
    });
    fireEvent.submit(screen.getByRole('button', { name: messages.auth.signIn }).closest('form')!);

    expect(await screen.findByRole('heading', { name: messages.auth.totpTitle })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(messages.auth.totpLabel), {
      target: { value: '123 456extra' },
    });
    expect(screen.getByLabelText<HTMLInputElement>(messages.auth.totpLabel).value).toBe('123456');
    fireEvent.submit(screen.getByRole('button', { name: messages.auth.verify }).closest('form')!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(await screen.findByText(messages.home.twoFactor)).toBeTruthy();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/auth/login',
      expect.objectContaining({
        body: JSON.stringify({
          email: loginResponse.account.email,
          password: 'ValidPassword!42',
          totpCode: '123456',
        }),
      }),
    );
  });

  it('validates a stored bearer session with the server before restoring the workspace', async () => {
    sessionStorage.setItem(
      'vista.erp-crm.session.v1',
      JSON.stringify({ ...loginResponse, context: authenticationContext }),
    );
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(authenticationContext));
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/']);

    expect(screen.getByText(messages.states.loadingDetail)).toBeTruthy();
    expect(
      await screen.findByRole('heading', { name: `${messages.home.title}, Mila.` }),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/auth/me');
  });

  it('changes the signed-in employee password from My access and keeps policy-driven validation visible', async () => {
    storeAuthenticatedSession(authenticationContext);
    const policy = {
      expirationDays: 0,
      historyCount: 5,
      minimumLength: 12,
      requireLowercase: true,
      requireNumber: true,
      requireSymbol: true,
      requireUppercase: true,
    };
    let passwordAttempts = 0;
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(authenticationContext));
      if (input.endsWith('/auth/me/password-policy')) return Promise.resolve(jsonResponse(policy));
      if (input.endsWith('/auth/me/password') && options?.method === 'POST') {
        passwordAttempts += 1;
        if (passwordAttempts === 1) {
          return Promise.resolve(
            jsonResponse(
              {
                error: {
                  code: 'CURRENT_PASSWORD_INVALID',
                  correlationId: 'password-change-test',
                  details: [{ field: 'currentPassword', message: 'Server field message' }],
                  message: 'The current password is incorrect',
                  timestamp: '2026-08-11T12:00:00.000Z',
                },
              },
              400,
            ),
          );
        }
        return Promise.resolve(
          jsonResponse({
            changedAt: '2026-08-11T12:00:00.000Z',
            revokedOtherSessionCount: 2,
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/access']);
    await screen.findByRole('heading', { name: messages.access.title });
    fireEvent.click(screen.getByRole('button', { name: messages.access.changePassword }));

    expect(await screen.findByText(messages.access.passwordRequirementLength(12))).toBeTruthy();
    expect(screen.getByText(messages.access.passwordRequirementHistory(5))).toBeTruthy();
    fireEvent.change(screen.getByLabelText(messages.access.currentPassword), {
      target: { value: 'Current-Password-7!' },
    });
    fireEvent.change(screen.getByLabelText(messages.access.newPassword), {
      target: { value: 'Updated-Password-8!' },
    });
    fireEvent.change(screen.getByLabelText(messages.access.confirmPassword), {
      target: { value: 'Different-Password-9!' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: messages.access.savePassword }).closest('form')!,
    );
    expect(await screen.findByText(messages.access.passwordMismatch)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(messages.access.confirmPassword), {
      target: { value: 'Updated-Password-8!' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: messages.access.savePassword }).closest('form')!,
    );
    expect(await screen.findByText(messages.access.currentPasswordInvalid)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(messages.access.currentPassword).value).toBe('');
    expect(screen.getByLabelText<HTMLInputElement>(messages.access.newPassword).value).toBe(
      'Updated-Password-8!',
    );
    fireEvent.change(screen.getByLabelText(messages.access.currentPassword), {
      target: { value: 'Current-Password-7!' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: messages.access.savePassword }).closest('form')!,
    );
    expect(await screen.findByText(messages.access.passwordChangedWithSessions(2))).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: messages.access.passwordTitle })).toBeNull();

    const command = fetchMock.mock.calls
      .filter(([url, options]) => url.endsWith('/auth/me/password') && options?.method === 'POST')
      .at(-1);
    expect(command).toBeTruthy();
    expect(JSON.parse((command?.[1] as RequestInit).body as string)).toEqual({
      currentPassword: 'Current-Password-7!',
      newPassword: 'Updated-Password-8!',
    });
  });

  it('opens delivered notifications and marks an unread update as read', async () => {
    storeAuthenticatedSession(authenticationContext);
    const notification = {
      channel: 'in_system' as const,
      createdAt: '2026-08-10T10:00:00.000Z',
      deliveredAt: '2026-08-10T10:01:00.000Z',
      id: '91a64e88-d89e-4f1f-aafa-d98f9e157bb1',
      payload: { availableQuantity: '2.0000', minimumQuantity: '3.0000' },
      templateKey: 'inventory.low_stock',
      templateVersion: 1,
    };
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(authenticationContext));
      if (input.includes('/notifications?'))
        return Promise.resolve(jsonResponse({ items: [notification], unreadCount: 1 }));
      if (input.endsWith(`/notifications/${notification.id}/read`) && options?.method === 'POST')
        return Promise.resolve(
          jsonResponse({ ...notification, readAt: '2026-08-10T10:02:00.000Z' }),
        );
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/']);
    await screen.findByRole('heading', { name: `${messages.home.title}, Mila.` });
    fireEvent.click(screen.getByRole('button', { name: 'Open notifications' }));
    expect(await screen.findByText('Low stock needs attention')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Low stock needs attention/u }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/notifications/${notification.id}/read`,
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('shows a safe API error and shortened correlation reference', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 'AUTHENTICATION_FAILED',
              correlationId: '12345678-90ab-cdef-1234-567890abcdef',
              message: 'The supplied credentials are invalid',
              timestamp: '2026-08-06T12:00:00.000Z',
            },
          },
          401,
        ),
      ),
    );
    renderApplication(['/login']);

    fireEvent.change(screen.getByLabelText(messages.auth.emailLabel), {
      target: { value: loginResponse.account.email },
    });
    fireEvent.change(screen.getByLabelText(messages.auth.passwordLabel), {
      target: { value: 'WrongPassword!42' },
    });
    fireEvent.submit(screen.getByRole('button', { name: messages.auth.signIn }).closest('form')!);

    expect(await screen.findByText(messages.errors.AUTHENTICATION_FAILED)).toBeTruthy();
    expect(screen.getByText(`${messages.auth.errorReference}: 12345678-90a`)).toBeTruthy();
  });

  it('loads the canonical partner registry and keeps create controls permission-aware', async () => {
    storeAuthenticatedSession(authenticationContext);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(authenticationContext))
      .mockResolvedValueOnce(jsonResponse(partnerPage))
      .mockResolvedValueOnce(jsonResponse(partnerProfile));
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/partners']);

    const partnerButton = await screen.findByRole('button', {
      name: /Vista Retail Partner Ltd\./u,
    });
    expect(screen.getByText(messages.partners.results(1))).toBeTruthy();
    expect(screen.queryByRole('button', { name: messages.partners.create })).toBeNull();
    fireEvent.click(partnerButton);
    expect(screen.getByRole('dialog', { name: messages.partners.detailsTitle })).toBeTruthy();
    expect(screen.getAllByText(partner.uic).length).toBeGreaterThan(0);
    expect(await screen.findByText('Maria Petrova')).toBeTruthy();
    expect(screen.getByText('GB82WEST12345698765432')).toBeTruthy();

    const listRequest = fetchMock.mock.calls[1];
    expect(listRequest?.[0]).toContain('/api/v1/master-data/partners?');
    expect(new Headers((listRequest?.[1] as RequestInit).headers).get('Authorization')).toBe(
      `Bearer ${loginResponse.sessionToken}`,
    );
  });

  it('shows the warehouse catalog hierarchy and makes category creation permission-aware', async () => {
    const contextWithCatalogCreate = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'create', module: 'erp.warehouse' },
      ],
    };
    storeAuthenticatedSession(contextWithCatalogCreate);
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me'))
        return Promise.resolve(jsonResponse(contextWithCatalogCreate));
      if (input.endsWith('/master-data/product-categories') && options?.method === 'POST') {
        return Promise.resolve(jsonResponse(productCategories[1], 201));
      }
      return Promise.resolve(jsonResponse(productCategories));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/catalog/categories']);
    expect(await screen.findByRole('heading', { name: messages.categories.title })).toBeTruthy();
    expect(await screen.findByText('Fiscal devices')).toBeTruthy();
    expect(screen.getByText('Cash registers')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: messages.categories.create }));
    const dialog = screen.getByRole('dialog', { name: messages.categories.createTitle });
    fireEvent.change(screen.getByLabelText(messages.categories.name), {
      target: { value: 'Electronic scales' },
    });
    fireEvent.submit(
      within(dialog).getByRole('button', { name: messages.categories.save }).closest('form')!,
    );

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            url.endsWith('/master-data/product-categories') && options?.method === 'POST',
        ),
      ).toBe(true);
    });
    const request = fetchMock.mock.calls.find(
      ([url, options]) =>
        url.endsWith('/master-data/product-categories') && options?.method === 'POST',
    );
    const requestOptions = request?.[1] as RequestInit;
    expect(new Headers(requestOptions.headers).get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/u);
    expect(JSON.parse(requestOptions.body as string)).toEqual({ name: 'Electronic scales' });
  });

  it('loads the product catalog and submits a retry-safe product command', async () => {
    const contextWithCatalogCreate = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'create', module: 'erp.warehouse' },
      ],
    };
    const unit = {
      active: true,
      code: 'PCS',
      id: '73b41a0e-9a9d-49c1-90df-0c0c7792c26a',
      name: 'Pieces',
      version: 1,
    };
    const createdProduct = {
      active: true,
      barcodes: [],
      categoryId: productCategories[0]!.id,
      createdAt: '2026-08-07T12:00:00.000Z',
      id: 'df51474c-3955-4f85-b9d0-26e4e5f2b5c5',
      name: 'Receipt printer',
      productCode: 'PRINTER-01',
      trackingMode: 'serial',
      unitId: unit.id,
      updatedAt: '2026-08-07T12:00:00.000Z',
      version: 1,
    };
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me'))
        return Promise.resolve(jsonResponse(contextWithCatalogCreate));
      if (input.endsWith('/master-data/catalog/products') && options?.method === 'POST') {
        return Promise.resolve(jsonResponse(createdProduct, 201));
      }
      if (input.endsWith('/master-data/catalog/products')) return Promise.resolve(jsonResponse([]));
      if (input.endsWith('/master-data/catalog/units'))
        return Promise.resolve(jsonResponse([unit]));
      if (input.endsWith('/master-data/product-categories'))
        return Promise.resolve(jsonResponse(productCategories));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    storeAuthenticatedSession(contextWithCatalogCreate);

    renderApplication(['/catalog']);

    expect(await screen.findByRole('heading', { name: 'Product catalog' })).toBeTruthy();
    expect(await screen.findByText('No products configured')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Add product' })[0]!);
    const dialog = screen.getByRole('dialog', { name: 'Add product' });
    fireEvent.change(screen.getByLabelText('Product code'), { target: { value: 'printer-01' } });
    fireEvent.change(screen.getByLabelText('Product name'), {
      target: { value: 'Receipt printer' },
    });
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Add product' }).closest('form')!);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            url.endsWith('/master-data/catalog/products') && options?.method === 'POST',
        ),
      ).toBe(true);
    });
    const request = fetchMock.mock.calls.find(
      ([url, options]) =>
        url.endsWith('/master-data/catalog/products') && options?.method === 'POST',
    );
    const requestOptions = request?.[1] as RequestInit;
    expect(new Headers(requestOptions.headers).get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/u);
    expect(JSON.parse(requestOptions.body as string)).toMatchObject({
      categoryId: productCategories[0]!.id,
      name: 'Receipt printer',
      productCode: 'printer-01',
      unitId: unit.id,
    });
  });

  it('creates a partner with a stable retry key and refreshes the shared registry', async () => {
    const contextWithCreate = {
      ...authenticationContext,
      permissions: [...authenticationContext.permissions, { action: 'create', module: 'crm' }],
    };
    storeAuthenticatedSession(contextWithCreate);
    const emptyPage = { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 };
    let listCalls = 0;
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      const url = input;
      if (url.endsWith('/auth/me')) return Promise.resolve(jsonResponse(contextWithCreate));
      if (options?.method === 'POST') return Promise.resolve(jsonResponse(partner, 201));
      if (url.endsWith(`/partners/${partner.id}/profile`)) {
        return Promise.resolve(jsonResponse(partnerProfile));
      }
      listCalls += 1;
      return Promise.resolve(jsonResponse(listCalls === 1 ? emptyPage : partnerPage));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/partners']);
    await screen.findByText(messages.partners.emptyTitle);
    fireEvent.click(await screen.findByRole('button', { name: messages.partners.create }));
    const createDialog = screen.getByRole('dialog', { name: messages.partners.createTitle });
    fireEvent.change(screen.getByLabelText(messages.partners.name), {
      target: { value: partner.displayName },
    });
    fireEvent.change(screen.getByLabelText(messages.partners.uic), {
      target: { value: partner.uic },
    });
    fireEvent.click(screen.getByLabelText(messages.partners.roleSupplier));
    fireEvent.submit(
      within(createDialog).getByRole('button', { name: messages.partners.save }).closest('form')!,
    );

    expect(await screen.findByText(messages.partners.created)).toBeTruthy();
    const createRequest = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST');
    expect(createRequest?.[0]).toBe('/api/v1/master-data/partners');
    const createOptions = createRequest?.[1] as RequestInit;
    expect(createOptions.method).toBe('POST');
    expect(new Headers(createOptions.headers).get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/u);
    expect(typeof createOptions.body).toBe('string');
    const submittedBody: unknown =
      typeof createOptions.body === 'string' ? JSON.parse(createOptions.body) : null;
    expect(submittedBody).toMatchObject({
      displayName: partner.displayName,
      kind: 'legal_entity',
      roles: ['customer', 'supplier'],
      uic: partner.uic,
    });
  });

  it('stops on a duplicate warning and shows the existing record reference', async () => {
    const contextWithCreate = {
      ...authenticationContext,
      permissions: [...authenticationContext.permissions, { action: 'create', module: 'crm' }],
    };
    storeAuthenticatedSession(contextWithCreate);
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      const url = input;
      if (url.endsWith('/auth/me')) return Promise.resolve(jsonResponse(contextWithCreate));
      if (options?.method !== 'POST') {
        return Promise.resolve(
          jsonResponse({ items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 }),
        );
      }
      return Promise.resolve(
        jsonResponse(
          {
            error: {
              code: 'PARTNER_DUPLICATE_CANDIDATE',
              correlationId: 'duplicate-test-correlation',
              details: [
                { field: 'displayName', message: `${partner.displayName} (${partner.id})` },
              ],
              message: 'A possible duplicate partner already exists',
              timestamp: '2026-08-06T12:00:00.000Z',
            },
          },
          409,
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/partners']);
    await screen.findByText(messages.partners.emptyTitle);
    fireEvent.click(await screen.findByRole('button', { name: messages.partners.create }));
    const createDialog = screen.getByRole('dialog', { name: messages.partners.createTitle });
    fireEvent.change(screen.getByLabelText(messages.partners.name), {
      target: { value: partner.displayName },
    });
    fireEvent.submit(
      within(createDialog).getByRole('button', { name: messages.partners.save }).closest('form')!,
    );

    expect(await screen.findByText(messages.partners.duplicateTitle)).toBeTruthy();
    expect(screen.getByText(`${partner.displayName} (${partner.id})`)).toBeTruthy();
    expect(screen.getByRole('dialog', { name: messages.partners.createTitle })).toBeTruthy();
  });

  it('lets employees with crm edit add a profile contact using an idempotent command', async () => {
    const contextWithEdit = {
      ...authenticationContext,
      permissions: [...authenticationContext.permissions, { action: 'edit', module: 'crm' }],
    };
    storeAuthenticatedSession(contextWithEdit);
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      const url = input;
      if (url.endsWith('/auth/me')) return Promise.resolve(jsonResponse(contextWithEdit));
      if (
        url.endsWith('/master-data/partners?direction=asc&page=1&pageSize=25&sortBy=displayName')
      ) {
        return Promise.resolve(jsonResponse(partnerPage));
      }
      if (url.endsWith(`/partners/${partner.id}/profile`))
        return Promise.resolve(jsonResponse(partnerProfile));
      if (url.endsWith(`/partners/${partner.id}/contacts`) && options?.method === 'POST') {
        return Promise.resolve(jsonResponse(partnerProfile.contacts[0], 201));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/partners']);
    fireEvent.click(await screen.findByRole('button', { name: /Vista Retail Partner Ltd\./u }));
    expect(await screen.findByText('Maria Petrova')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: messages.partners.addContact }));
    fireEvent.change(screen.getByLabelText(messages.partners.contactName), {
      target: { value: 'New contact' },
    });
    fireEvent.change(screen.getByLabelText(messages.partners.email), {
      target: { value: 'new.contact@example.invalid' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: messages.partners.saveContact }).closest('form')!,
    );

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            url.endsWith(`/partners/${partner.id}/contacts`) && options?.method === 'POST',
        ),
      ).toBe(true);
    });
    const createRequest = fetchMock.mock.calls.find(
      ([url, options]) =>
        url.endsWith(`/partners/${partner.id}/contacts`) && options?.method === 'POST',
    );
    const createOptions = createRequest?.[1] as RequestInit;
    expect(new Headers(createOptions.headers).get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/u);
    expect(JSON.parse(createOptions.body as string)).toMatchObject({
      displayName: 'New contact',
      email: 'new.contact@example.invalid',
    });
  });

  it('edits and reversibly deactivates a partner through versioned commands', async () => {
    const contextWithMaintenance = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'edit', module: 'crm' },
        { action: 'delete', module: 'crm' },
      ],
    };
    storeAuthenticatedSession(contextWithMaintenance);
    const updated = {
      ...partnerProfile.partner,
      displayName: 'Vista Retail & Service Ltd.',
      roles: ['customer', 'partner'],
      version: 5,
    };
    const deactivated = { ...updated, active: false, version: 6 };
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(contextWithMaintenance));
      if (input.includes('/master-data/partners?'))
        return Promise.resolve(jsonResponse(partnerPage));
      if (input.endsWith(`/partners/${partner.id}/profile`))
        return Promise.resolve(jsonResponse(partnerProfile));
      if (input.endsWith(`/partners/${partner.id}/locations`))
        return Promise.resolve(jsonResponse([]));
      if (input.endsWith(`/partners/${partner.id}`) && options?.method === 'PUT')
        return Promise.resolve(jsonResponse(updated));
      if (input.endsWith(`/partners/${partner.id}/deactivate`) && options?.method === 'POST')
        return Promise.resolve(jsonResponse(deactivated));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/partners']);
    fireEvent.click(await screen.findByRole('button', { name: /Vista Retail Partner Ltd\./u }));
    expect(await screen.findByText('Maria Petrova')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit partner' }));
    fireEvent.change(screen.getByLabelText('Partner name'), {
      target: { value: updated.displayName },
    });
    fireEvent.click(screen.getByLabelText('Supplier'));
    fireEvent.click(screen.getByLabelText('Business partner'));
    fireEvent.submit(screen.getByRole('button', { name: 'Save partner changes' }).closest('form')!);
    expect(await screen.findByText(`${updated.displayName} was updated.`)).toBeTruthy();
    const updateRequest = fetchMock.mock.calls.find(
      ([url, options]) => url.endsWith(`/partners/${partner.id}`) && options?.method === 'PUT',
    );
    const updateOptions = updateRequest?.[1] as RequestInit;
    expect(new Headers(updateOptions.headers).get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/u);
    expect(JSON.parse(updateOptions.body as string)).toMatchObject({
      displayName: updated.displayName,
      expectedVersion: partnerProfile.partner.version,
      roles: ['customer', 'partner'],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate partner' }));
    expect(await screen.findByText('Inactive')).toBeTruthy();
    const statusRequest = fetchMock.mock.calls.find(
      ([url, options]) =>
        url.endsWith(`/partners/${partner.id}/deactivate`) && options?.method === 'POST',
    );
    expect(JSON.parse(statusRequest?.[1]?.body as string)).toEqual({ expectedVersion: 5 });
  });

  it('adds a customer location and installed device without fabricating catalog linkage', async () => {
    const contextWithEdit = {
      ...authenticationContext,
      permissions: [...authenticationContext.permissions, { action: 'edit', module: 'crm' }],
    };
    storeAuthenticatedSession(contextWithEdit);
    const location = {
      active: true,
      addressLine1: '1 Industrial Road',
      city: 'Vratsa',
      countryCode: 'BG',
      id: 'e3996ca2-f924-4da7-82bf-b90ce9f0758f',
      locationType: 'Fuel station',
      name: 'North site',
      partnerId: partner.id,
      responsibleContact: partnerProfile.contacts[0],
      version: 1,
    };
    const equipment = {
      active: true,
      customerLocationId: location.id,
      deviceName: 'Fiscal device Alpha',
      id: '28e7f8f5-74e9-44a7-8fbe-c6c0c1b9265c',
      purchaseDate: '2025-01-15',
      serialNumber: 'FDA-EXT-0001',
      status: 'active',
      version: 1,
      warrantyEndsOn: '2027-01-15',
      warrantyStartsOn: '2025-01-15',
    };
    const maintainedEquipment = {
      ...equipment,
      deviceName: 'Fiscal device Alpha serviced',
      status: 'under_repair',
      version: 2,
    };
    let locationCreated = false;
    let equipmentCreated = false;
    let equipmentUpdated = false;
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(contextWithEdit));
      if (input.includes('/master-data/partners?'))
        return Promise.resolve(jsonResponse(partnerPage));
      if (input.endsWith(`/partners/${partner.id}/profile`))
        return Promise.resolve(jsonResponse(partnerProfile));
      if (input.endsWith(`/locations/${location.id}/equipment`) && options?.method === 'POST') {
        equipmentCreated = true;
        return Promise.resolve(jsonResponse(equipment, 201));
      }
      if (input.endsWith(`/equipment/${equipment.id}`) && options?.method === 'PUT') {
        equipmentUpdated = true;
        return Promise.resolve(jsonResponse(maintainedEquipment));
      }
      if (input.endsWith(`/partners/${partner.id}/locations`) && options?.method === 'POST') {
        locationCreated = true;
        return Promise.resolve(jsonResponse(location, 201));
      }
      if (input.endsWith(`/partners/${partner.id}/locations`)) {
        return Promise.resolve(
          jsonResponse(
            locationCreated
              ? [
                  {
                    equipment: equipmentCreated
                      ? [equipmentUpdated ? maintainedEquipment : equipment]
                      : [],
                    location,
                  },
                ]
              : [],
          ),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/partners']);
    fireEvent.click(await screen.findByRole('button', { name: /Vista Retail Partner Ltd\./u }));
    expect(await screen.findByText('No customer locations yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add location' }));
    fireEvent.change(screen.getByLabelText('Location name'), { target: { value: location.name } });
    fireEvent.change(screen.getByLabelText('Location type'), {
      target: { value: location.locationType },
    });
    fireEvent.change(screen.getByLabelText('Address line 1'), {
      target: { value: location.addressLine1 },
    });
    fireEvent.change(screen.getByLabelText('City'), { target: { value: location.city } });
    fireEvent.change(screen.getByLabelText('Responsible contact'), {
      target: { value: partnerProfile.contacts[0]!.id },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Save location' }).closest('form')!);
    expect(await screen.findByText(location.name)).toBeTruthy();
    expect(screen.getAllByText(partnerProfile.contacts[0]!.displayName).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Register equipment' }));
    fireEvent.change(screen.getByLabelText('Device'), { target: { value: equipment.deviceName } });
    fireEvent.change(screen.getByLabelText('Serial number'), {
      target: { value: equipment.serialNumber },
    });
    fireEvent.change(screen.getByLabelText('Purchase date'), {
      target: { value: equipment.purchaseDate },
    });
    fireEvent.change(screen.getByLabelText('Warranty ends (if known)'), {
      target: { value: equipment.warrantyEndsOn },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Register equipment' }).closest('form')!);
    expect(await screen.findByText(equipment.serialNumber)).toBeTruthy();
    expect(screen.getByText('Under warranty')).toBeTruthy();

    const equipmentRow = screen.getByText(equipment.serialNumber).closest('.equipment-row');
    if (!equipmentRow) throw new Error('Equipment row missing');
    fireEvent.click(within(equipmentRow as HTMLElement).getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Device'), {
      target: { value: maintainedEquipment.deviceName },
    });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'under_repair' } });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Save equipment changes' }).closest('form')!,
    );
    expect(await screen.findByText(maintainedEquipment.deviceName)).toBeTruthy();
    const updateEquipmentRequest = fetchMock.mock.calls.find(
      ([url, options]) => url.endsWith(`/equipment/${equipment.id}`) && options?.method === 'PUT',
    );
    expect(JSON.parse(updateEquipmentRequest?.[1]?.body as string)).toMatchObject({
      deviceName: maintainedEquipment.deviceName,
      expectedVersion: equipment.version,
      status: 'under_repair',
    });

    const commands = fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(commands.map(([url]) => url)).toEqual([
      `/api/v1/master-data/partners/${partner.id}/locations`,
      `/api/v1/master-data/partners/${partner.id}/locations/${location.id}/equipment`,
    ]);
    for (const [, options] of commands) {
      expect(new Headers((options as RequestInit).headers).get('Idempotency-Key')).toMatch(
        /^[0-9a-f-]{36}$/u,
      );
    }
    expect(JSON.parse((commands[1]?.[1] as RequestInit).body as string)).not.toHaveProperty(
      'productId',
    );
  });

  it('renders live stock valuation and saves reservation-aware replenishment settings', async () => {
    const contextWithWarehouseEdit = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'edit', module: 'erp.warehouse' },
      ],
    };
    storeAuthenticatedSession(contextWithWarehouseEdit);
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me'))
        return Promise.resolve(jsonResponse(contextWithWarehouseEdit));
      if (input.endsWith('/warehouse/warehouses'))
        return Promise.resolve(jsonResponse([warehouseFixture]));
      if (input.endsWith('/master-data/catalog/products'))
        return Promise.resolve(jsonResponse([inventoryProductFixture]));
      if (input.endsWith('/warehouse/stock-balances'))
        return Promise.resolve(
          jsonResponse([
            {
              availableQuantity: '3.0000',
              averageUnitCostBgn: '200.0000',
              inventoryValueBgn: '1000.0000',
              productId: inventoryProductFixture.id,
              quantity: '5.0000',
              reservedQuantity: '2.0000',
              warehouseId: warehouseFixture.id,
            },
          ]),
        );
      if (input.endsWith('/warehouse/replenishment'))
        return Promise.resolve(
          jsonResponse([
            {
              availableQuantity: '3.0000',
              lowStock: true,
              minimumQuantity: '4.0000',
              physicalQuantity: '5.0000',
              productId: inventoryProductFixture.id,
              recommendedQuantity: '7.0000',
              reservedQuantity: '2.0000',
              targetQuantity: '10.0000',
              warehouseId: warehouseFixture.id,
            },
          ]),
        );
      if (input.endsWith('/warehouse/stock-settings') && options?.method === 'POST')
        return Promise.resolve(
          jsonResponse({
            alertRecipientAccountIds: [authenticationContext.accountId],
            minimumQuantity: '6',
            productId: inventoryProductFixture.id,
            targetQuantity: '12',
            version: 2,
            warehouseId: warehouseFixture.id,
          }),
        );
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/erp.warehouse/stock']);

    expect(await screen.findByRole('heading', { name: 'Stock overview' })).toBeTruthy();
    expect((await screen.findAllByText('Fiscal device Alpha')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('1,000.00 BGN').length).toBeGreaterThan(0);
    expect(screen.getAllByText('7').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Set stock thresholds' }));
    fireEvent.change(screen.getByLabelText('Minimum quantity'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Target quantity'), { target: { value: '12' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save thresholds' }).closest('form')!);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            url.endsWith('/warehouse/stock-settings') && options?.method === 'POST',
        ),
      ).toBe(true);
    });
    const request = fetchMock.mock.calls.find(
      ([url, options]) => url.endsWith('/warehouse/stock-settings') && options?.method === 'POST',
    );
    const options = request?.[1] as RequestInit;
    expect(new Headers(options.headers).get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/u);
    expect(JSON.parse(options.body as string)).toEqual({
      alertRecipientAccountIds: [authenticationContext.accountId],
      minimumQuantity: '6',
      productId: inventoryProductFixture.id,
      targetQuantity: '12',
      warehouseId: warehouseFixture.id,
    });
  });

  it('posts a serial-controlled warehouse receipt with a stable command key', async () => {
    const contextWithWarehouseCreate = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'create', module: 'erp.warehouse' },
      ],
    };
    storeAuthenticatedSession(contextWithWarehouseCreate);
    const movementId = '29f3c3fc-27f8-4c4f-ab19-390755634bec';
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me'))
        return Promise.resolve(jsonResponse(contextWithWarehouseCreate));
      if (input.endsWith('/warehouse/warehouses'))
        return Promise.resolve(jsonResponse([warehouseFixture, technicianWarehouseFixture]));
      if (input.endsWith('/master-data/catalog/products'))
        return Promise.resolve(jsonResponse([inventoryProductFixture]));
      if (input.endsWith('/warehouse/stock-receipts') && options?.method === 'POST')
        return Promise.resolve(
          jsonResponse(
            {
              id: movementId,
              productId: inventoryProductFixture.id,
              quantity: '1.0000',
              serialItemIds: ['77886c8d-5812-413d-a93c-c2bcbb4f27df'],
              totalCostBgn: '250.0000',
              unitCostBgn: '250.0000',
              warehouseId: warehouseFixture.id,
            },
            201,
          ),
        );
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/erp.warehouse/movements']);

    expect(await screen.findByRole('heading', { name: 'Stock movements' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Source reference'), {
      target: { value: 'GR-2026-0042' },
    });
    fireEvent.change(screen.getByLabelText('Unit cost (BGN)'), { target: { value: '250' } });
    fireEvent.change(screen.getByLabelText('Serial numbers'), {
      target: { value: 'FDA-ALPHA-0001' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Post receipt' }).closest('form')!);

    expect(await screen.findByText(/Transaction 29F3C3FC posted/u)).toBeTruthy();
    const request = fetchMock.mock.calls.find(
      ([url, options]) => url.endsWith('/warehouse/stock-receipts') && options?.method === 'POST',
    );
    const options = request?.[1] as RequestInit;
    expect(new Headers(options.headers).get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/u);
    expect(JSON.parse(options.body as string)).toMatchObject({
      productId: inventoryProductFixture.id,
      referenceId: 'GR-2026-0042',
      serialNumbers: ['FDA-ALPHA-0001'],
      unitCostBgn: '250',
      warehouseId: warehouseFixture.id,
    });
  });

  it('posts a return only through its original issue and explicit destination', async () => {
    const contextWithWarehouseCreate = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'create', module: 'erp.warehouse' },
      ],
    };
    storeAuthenticatedSession(contextWithWarehouseCreate);
    const originalIssueId = '77fe8dab-55ec-4164-88df-d1e139b4b137';
    const returnMovementId = 'a589a3c9-7027-4562-8606-bccfabf55f39';
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me'))
        return Promise.resolve(jsonResponse(contextWithWarehouseCreate));
      if (input.endsWith('/warehouse/warehouses'))
        return Promise.resolve(jsonResponse([warehouseFixture, technicianWarehouseFixture]));
      if (input.endsWith('/master-data/catalog/products'))
        return Promise.resolve(jsonResponse([inventoryProductFixture]));
      if (input.endsWith('/warehouse/stock-returns') && options?.method === 'POST')
        return Promise.resolve(
          jsonResponse(
            {
              destinationWarehouseId: technicianWarehouseFixture.id,
              disposition: 'service',
              id: returnMovementId,
              originalIssueId,
              productId: inventoryProductFixture.id,
              quantity: '1.0000',
              serialItemIds: ['77886c8d-5812-413d-a93c-c2bcbb4f27df'],
              totalCostBgn: '250.0000',
              unitCostBgn: '250.0000',
            },
            201,
          ),
        );
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/erp.warehouse/movements']);
    expect(await screen.findByRole('heading', { name: 'Stock movements' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Return' }));
    fireEvent.change(screen.getByLabelText('Original issue ID'), {
      target: { value: originalIssueId },
    });
    fireEvent.change(screen.getByLabelText('Destination warehouse'), {
      target: { value: technicianWarehouseFixture.id },
    });
    fireEvent.change(screen.getByLabelText('Return disposition'), {
      target: { value: 'service' },
    });
    fireEvent.change(screen.getByLabelText('Return reference'), {
      target: { value: 'RMA-2026-0042' },
    });
    fireEvent.change(screen.getByLabelText('Returned serial numbers (when applicable)'), {
      target: { value: 'FDA-ALPHA-0001' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Post linked return' }).closest('form')!);

    expect(await screen.findByText(/Return A589A3C9 restored inventory/u)).toBeTruthy();
    const request = fetchMock.mock.calls.find(
      ([url, options]) => url.endsWith('/warehouse/stock-returns') && options?.method === 'POST',
    );
    const options = request?.[1] as RequestInit;
    expect(new Headers(options.headers).get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/u);
    expect(JSON.parse(options.body as string)).toEqual({
      destinationWarehouseId: technicianWarehouseFixture.id,
      disposition: 'service',
      originalIssueId,
      quantity: '1',
      referenceId: 'RMA-2026-0042',
      serialNumbers: ['FDA-ALPHA-0001'],
    });
  });

  it('creates and releases an exact-serial reservation from the connected workspace', async () => {
    const contextWithReservationControl = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'create', module: 'erp.warehouse' },
        { action: 'edit', module: 'erp.warehouse' },
      ],
    };
    storeAuthenticatedSession(contextWithReservationControl);
    const reservation = {
      id: 'cb023ff5-70d9-48d7-a51b-b90a55b72b58',
      initialQuantity: '1.0000',
      productId: inventoryProductFixture.id,
      referenceId: 'SO-2026-0091',
      referenceType: 'sales_order',
      remainingQuantity: '1.0000',
      serialItemIds: ['77886c8d-5812-413d-a93c-c2bcbb4f27df'],
      status: 'active',
      warehouseId: warehouseFixture.id,
    };
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me'))
        return Promise.resolve(jsonResponse(contextWithReservationControl));
      if (input.endsWith('/warehouse/warehouses'))
        return Promise.resolve(jsonResponse([warehouseFixture]));
      if (input.endsWith('/master-data/catalog/products'))
        return Promise.resolve(jsonResponse([inventoryProductFixture]));
      if (input.endsWith('/warehouse/stock-reservations') && options?.method === 'POST')
        return Promise.resolve(jsonResponse(reservation, 201));
      if (input.endsWith(`/warehouse/stock-reservations/${reservation.id}/release`))
        return Promise.resolve(
          jsonResponse({ ...reservation, remainingQuantity: '0.0000', status: 'released' }),
        );
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/erp.warehouse/reservations']);
    expect(
      await screen.findByRole('heading', { name: 'Reservations & serial trace' }),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Reference'), {
      target: { value: reservation.referenceId },
    });
    fireEvent.change(screen.getByLabelText('Specific serial numbers'), {
      target: { value: 'FDA-ALPHA-0001' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Create reservation' }).closest('form')!);
    expect(await screen.findByText('active')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));
    expect(await screen.findByText('released')).toBeTruthy();

    const commands = fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(commands.map(([url]) => url)).toEqual([
      '/api/v1/warehouse/stock-reservations',
      `/api/v1/warehouse/stock-reservations/${reservation.id}/release`,
    ]);
    const createOptions = commands[0]?.[1] as RequestInit;
    expect(new Headers(createOptions.headers).get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/u);
    expect(JSON.parse(createOptions.body as string)).toMatchObject({
      referenceId: reservation.referenceId,
      referenceType: 'sales_order',
      serialNumbers: ['FDA-ALPHA-0001'],
    });
  });

  it('keeps stocktake counting and approval as separate permission-backed commands', async () => {
    const contextWithStocktakeApproval = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'create', module: 'erp.warehouse' },
        { action: 'approve', module: 'erp.warehouse' },
      ],
    };
    storeAuthenticatedSession(contextWithStocktakeApproval);
    const stocktake = {
      id: '9e3d6a8a-a5cf-4c84-9925-07e94c93fbc7',
      referenceId: 'ST-2026-CENTRAL',
      status: 'open',
      warehouseId: warehouseFixture.id,
    };
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me'))
        return Promise.resolve(jsonResponse(contextWithStocktakeApproval));
      if (input.endsWith('/warehouse/warehouses'))
        return Promise.resolve(jsonResponse([warehouseFixture]));
      if (input.endsWith('/master-data/catalog/products'))
        return Promise.resolve(jsonResponse([inventoryProductFixture]));
      if (input.endsWith('/warehouse/stocktakes') && options?.method === 'POST')
        return Promise.resolve(jsonResponse(stocktake, 201));
      if (input.endsWith(`/warehouse/stocktakes/${stocktake.id}/counts`))
        return Promise.resolve(jsonResponse(stocktake, 201));
      if (input.endsWith(`/warehouse/stocktakes/${stocktake.id}/complete`))
        return Promise.resolve(jsonResponse({ ...stocktake, status: 'completed' }, 201));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/erp.warehouse/stocktakes']);
    expect(await screen.findByRole('heading', { name: 'Stocktakes' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Count reference'), {
      target: { value: stocktake.referenceId },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Open stocktake' }).closest('form')!);
    expect(await screen.findByText(stocktake.referenceId)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Counted quantity'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Observed serial numbers'), {
      target: { value: 'FDA-ALPHA-0001' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Record product count' }).closest('form')!);
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          url.endsWith(`/warehouse/stocktakes/${stocktake.id}/counts`),
        ),
      ).toBe(true);
    });
    expect(screen.getByText('products counted')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve & complete' }));
    expect(await screen.findByText('Stocktake completed')).toBeTruthy();

    const commandPaths = fetchMock.mock.calls
      .filter(([, options]) => options?.method === 'POST')
      .map(([url]) => url);
    expect(commandPaths).toEqual([
      '/api/v1/warehouse/stocktakes',
      `/api/v1/warehouse/stocktakes/${stocktake.id}/counts`,
      `/api/v1/warehouse/stocktakes/${stocktake.id}/complete`,
    ]);
  });

  it('guides organization setup from legal entity through branch and operating location', async () => {
    const organizationContext = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'view', module: 'platform.organization' },
        { action: 'create', module: 'platform.organization' },
      ],
    };
    storeAuthenticatedSession(organizationContext);
    const entity = {
      active: true,
      code: 'VISTA',
      id: '4a6c8732-a7c6-4dac-997c-147bed55b868',
      name: 'Vista Service Ltd.',
      version: 1,
    };
    const branch = {
      active: true,
      code: 'VRC',
      id: '9e3b0322-0ed0-4a5d-83df-0a88cd134dbd',
      legalEntityId: entity.id,
      name: 'Vratsa operations',
      version: 1,
    };
    const location = {
      active: true,
      addressLine1: '1 Operations Blvd.',
      branchId: branch.id,
      city: 'Vratsa',
      code: 'VRC-01',
      countryCode: 'BG',
      id: 'da10c811-fd75-46ea-95f8-fcfceef83a30',
      locationType: 'Service and retail center',
      name: 'Vratsa center',
      version: 1,
    };
    const topology = {
      branches: [] as (typeof branch)[],
      cashRegisters: [],
      legalEntities: [] as (typeof entity)[],
      locations: [] as (typeof location)[],
      operators: [],
    };
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(organizationContext));
      if (input.endsWith('/organization/members'))
        return Promise.resolve(
          jsonResponse([
            {
              accountId: authenticationContext.accountId,
              displayName: authenticationContext.displayName,
              email: authenticationContext.email,
            },
          ]),
        );
      if (input.endsWith('/organization/topology')) return Promise.resolve(jsonResponse(topology));
      if (input.endsWith('/organization/legal-entities') && options?.method === 'POST') {
        topology.legalEntities = [entity];
        return Promise.resolve(jsonResponse(entity, 201));
      }
      if (
        input.endsWith(`/organization/legal-entities/${entity.id}/branches`) &&
        options?.method === 'POST'
      ) {
        topology.branches = [branch];
        return Promise.resolve(jsonResponse(branch, 201));
      }
      if (
        input.endsWith(`/organization/branches/${branch.id}/locations`) &&
        options?.method === 'POST'
      ) {
        topology.locations = [location];
        return Promise.resolve(jsonResponse(location, 201));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/organization']);
    expect(await screen.findByText('No business structure configured')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add legal entity' }));
    fireEvent.change(screen.getByLabelText('Legal entity code'), {
      target: { value: entity.code },
    });
    fireEvent.change(screen.getByLabelText('Legal entity name'), {
      target: { value: entity.name },
    });
    fireEvent.submit(
      screen.getByRole('heading', { name: 'Add a legal business entity' }).closest('form')!,
    );
    expect(await screen.findByRole('heading', { name: entity.name })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Branch' }));
    fireEvent.change(screen.getByLabelText('Branch code'), { target: { value: branch.code } });
    fireEvent.change(screen.getByLabelText('Branch name'), { target: { value: branch.name } });
    fireEvent.submit(screen.getByRole('heading', { name: 'Add a branch' }).closest('form')!);
    expect(await screen.findByText(branch.name)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Location' }));
    fireEvent.change(screen.getByLabelText('Location code'), { target: { value: location.code } });
    fireEvent.change(screen.getByLabelText('Location name'), { target: { value: location.name } });
    fireEvent.change(screen.getByLabelText('Location type'), {
      target: { value: location.locationType },
    });
    fireEvent.change(screen.getByLabelText('Address line 1'), {
      target: { value: location.addressLine1 },
    });
    fireEvent.change(screen.getByLabelText('City'), { target: { value: location.city } });
    fireEvent.submit(
      screen.getByRole('heading', { name: 'Add an operating location' }).closest('form')!,
    );
    expect(await screen.findByText(location.name)).toBeTruthy();
    expect(screen.getByText('0 registers')).toBeTruthy();

    const commandPaths = fetchMock.mock.calls
      .filter(([, options]) => options?.method === 'POST')
      .map(([url]) => url);
    expect(commandPaths).toEqual([
      '/api/v1/organization/legal-entities',
      `/api/v1/organization/legal-entities/${entity.id}/branches`,
      `/api/v1/organization/branches/${branch.id}/locations`,
    ]);
  });

  it('connects the security control room to accounts, roles, sessions, and audit evidence', async () => {
    const securityContext = {
      ...authenticationContext,
      isAdministrative: true,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'view', module: 'platform' },
        { action: 'create', module: 'platform' },
        { action: 'approve', module: 'platform' },
      ],
      twoFactorVerified: true,
    };
    storeAuthenticatedSession(securityContext);
    const role = {
      code: 'crm.operator',
      description: 'Controlled CRM operator access.',
      id: 'c7e72db8-9c66-4395-a216-72c1edc3d582',
      isAdministrative: false,
      isSystemRole: false,
      name: 'CRM operator',
      permissions: [{ action: 'view', module: 'crm' }],
      version: 1,
    };
    let account = {
      accountId: '34df4d33-6af4-451c-a36c-c169f7ad3624',
      activeSessionCount: 1,
      createdAt: '2026-08-10T10:00:00.000Z',
      displayName: 'Ivaylo Petrov',
      email: 'ivaylo@example.invalid',
      employeeId: 'fc9c927f-e580-4dba-98c1-e4281083049f',
      employeeNumber: 'EMP-014',
      roles: [] as Array<{
        code: string;
        id: string;
        isAdministrative: boolean;
        name: string;
      }>,
      status: 'active',
      twoFactorEnrolled: false,
      updatedAt: '2026-08-10T10:00:00.000Z',
      version: 1,
    };
    const sessionRecord = {
      accountId: account.accountId,
      createdAt: '2026-08-10T10:00:00.000Z',
      displayName: account.displayName,
      email: account.email,
      expiresAt: '2099-08-10T18:00:00.000Z',
      id: securityContext.sessionId,
      ipAddress: '127.0.0.1',
      lastSeenAt: '2026-08-10T10:10:00.000Z',
      twoFactorVerified: true,
      userAgent: 'Vista browser test',
    };
    const auditEvent = {
      action: 'identity.account.created',
      actorAccountId: securityContext.accountId,
      actorDisplayName: securityContext.displayName,
      correlationId: 'security-ui-test',
      eventHash: 'a'.repeat(64),
      id: '625f018f-8f3b-489a-b268-765f88a71461',
      metadata: {},
      occurredAt: '2026-08-10T10:00:00.000Z',
      targetId: account.accountId,
      targetType: 'user_account',
    };
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(securityContext));
      if (input.includes('/platform/security/accounts?')) {
        return Promise.resolve(
          jsonResponse({ items: [account], page: 1, pageSize: 100, total: 1, totalPages: 1 }),
        );
      }
      if (input.endsWith('/platform/security/roles')) return Promise.resolve(jsonResponse([role]));
      if (input.endsWith('/platform/security/sessions'))
        return Promise.resolve(jsonResponse([sessionRecord]));
      if (input.includes('/platform/security/audit-events?'))
        return Promise.resolve(
          jsonResponse({ items: [auditEvent], page: 1, pageSize: 100, total: 1, totalPages: 1 }),
        );
      if (input.endsWith('/platform/security/audit-integrity'))
        return Promise.resolve(
          jsonResponse({ checkedEvents: 1, headHash: auditEvent.eventHash, valid: true }),
        );
      if (
        input.endsWith(`/platform/security/accounts/${account.accountId}/roles`) &&
        options?.method === 'PUT'
      ) {
        account = {
          ...account,
          roles: [
            {
              code: role.code,
              id: role.id,
              isAdministrative: role.isAdministrative,
              name: role.name,
            },
          ],
          version: 2,
        };
        return Promise.resolve(jsonResponse(account));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/security']);
    expect(await screen.findByRole('heading', { name: 'Security' })).toBeTruthy();
    expect(screen.getByText('Activity log checked')).toBeTruthy();
    expect(screen.getByText(account.displayName)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    const accountDialog = screen.getByRole('dialog', { name: account.displayName });
    fireEvent.click(within(accountDialog).getByRole('checkbox', { name: /CRM operator/u }));
    fireEvent.click(within(accountDialog).getByRole('button', { name: 'Save roles' }));
    expect(await screen.findByText('Employee access updated.')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /^Roles/u }));
    expect(screen.getByRole('heading', { name: role.name })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /^Sessions/u }));
    expect(screen.getByText(/Current session/u)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Activity log' }));
    expect(screen.getAllByText('Activity log checked').length).toBeGreaterThan(0);
    expect(screen.getByText('Employee account created')).toBeTruthy();

    const roleCommand = fetchMock.mock.calls.find(
      ([url, options]) =>
        url.endsWith(`/platform/security/accounts/${account.accountId}/roles`) &&
        options?.method === 'PUT',
    );
    expect(roleCommand).toBeTruthy();
    expect(
      new Headers((roleCommand?.[1] as RequestInit).headers).get('Idempotency-Key'),
    ).toBeTruthy();
    expect(JSON.parse((roleCommand?.[1] as RequestInit).body as string)).toEqual({
      expectedVersion: 1,
      roleIds: [role.id],
    });
  });

  it('shows payload-free system activity and confirms a failed delivery retry', async () => {
    const operationsContext = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'view', module: 'platform' },
        { action: 'edit', module: 'platform' },
      ],
    };
    storeAuthenticatedSession(operationsContext);
    const integrationEvent = {
      aggregateId: 'd1a38bf1-ee29-449b-ab3e-54c95ae5d80b',
      aggregateType: 'inventory_product',
      attemptCount: 3,
      availableAt: '2026-08-11T09:00:00.000Z',
      correlationId: 'stock-alert-request-01',
      deadLetteredAt: '2026-08-11T09:03:00.000Z',
      eventType: 'inventory.low_stock.detected',
      id: 'a12dc4f4-1b4d-4d34-82c2-5ddbf351fb17',
      lastErrorCode: 'INTEGRATION_MESSAGE_REJECTED',
      occurredAt: '2026-08-11T09:00:00.000Z',
      publicationAttemptCount: 1,
      publishedAt: '2026-08-11T09:00:01.000Z',
      replayCount: 0,
      sequenceNumber: '4',
      status: 'dead_letter',
    } as const;
    const eventDetail = {
      ...integrationEvent,
      deliveries: [
        {
          attemptCount: 3,
          consumer: 'notifications.low-stock',
          cycleAttemptCount: 3,
          deadLetteredAt: integrationEvent.deadLetteredAt,
          lastErrorCode: integrationEvent.lastErrorCode,
          replayCount: 0,
          status: 'dead_letter',
        },
      ],
    } as const;
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(operationsContext));
      if (input.endsWith('/platform/integrations/metrics')) {
        return Promise.resolve(
          jsonResponse({
            completed: 12,
            deadLetter: 1,
            failedDeliveries: 1,
            pending: 2,
            published: 1,
            publishing: 0,
            timestamp: '2026-08-11T09:05:00.000Z',
          }),
        );
      }
      if (input.includes('/platform/integrations/events?')) {
        return Promise.resolve(
          jsonResponse({
            items: [integrationEvent],
            page: 1,
            pageSize: 50,
            total: 1,
            totalPages: 1,
          }),
        );
      }
      if (
        input.endsWith(`/platform/integrations/events/${integrationEvent.id}/replay`) &&
        options?.method === 'POST'
      ) {
        return Promise.resolve(jsonResponse({ ...eventDetail, replayCount: 1, status: 'pending' }));
      }
      if (input.endsWith(`/platform/integrations/events/${integrationEvent.id}`)) {
        return Promise.resolve(jsonResponse(eventDetail));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/operations']);
    expect(await screen.findByRole('heading', { name: messages.operations.title })).toBeTruthy();
    expect(await screen.findByText(messages.operations.lowStock)).toBeTruthy();
    expect(screen.queryByText(integrationEvent.lastErrorCode)).toBeNull();

    fireEvent.click(
      screen.getByRole('button', {
        name: `${messages.operations.open} ${messages.operations.lowStock}`,
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: messages.operations.details });
    expect(within(dialog).getByText(messages.operations.inAppAlert)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: messages.operations.retry }));
    fireEvent.click(within(dialog).getByRole('button', { name: messages.operations.confirmRetry }));

    await waitFor(() => {
      const replayCall = fetchMock.mock.calls.find(
        ([url, options]) =>
          url.endsWith(`/platform/integrations/events/${integrationEvent.id}/replay`) &&
          options?.method === 'POST',
      );
      expect(replayCall).toBeTruthy();
      expect(JSON.parse((replayCall?.[1] as RequestInit).body as string)).toEqual({
        expectedReplayCount: 0,
      });
    });
  });

  it('creates and receives a purchase order through the connected procurement workspace', async () => {
    const procurementContext = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'view', module: 'erp.procurement' },
        { action: 'create', module: 'erp.procurement' },
      ],
    };
    storeAuthenticatedSession(procurementContext);
    const supplierId = '124bfcea-275e-4d7f-8aed-e9901f79090f';
    const orderId = '49ff6a7b-d4d4-4ce0-aa11-b5214017dd19';
    const orderLineId = '6899d2ed-a9fe-4274-9955-a6c391f1c7da';
    const references = {
      products: [
        {
          id: inventoryProductFixture.id,
          name: inventoryProductFixture.name,
          productCode: inventoryProductFixture.productCode,
          requiresExpiry: false,
          trackingMode: 'none',
        },
      ],
      suppliers: [{ id: supplierId, name: 'Bulgarian Equipment Supply Ltd.' }],
      warehouses: [{ id: warehouseFixture.id, name: warehouseFixture.name }],
    };
    let orders: unknown[] = [];
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(procurementContext));
      if (input.endsWith('/procurement/reference-data')) {
        return Promise.resolve(jsonResponse(references));
      }
      if (input.includes('/procurement/purchase-orders?') && options?.method !== 'POST') {
        return Promise.resolve(
          jsonResponse({
            items: orders,
            page: 1,
            pageSize: 100,
            total: orders.length,
            totalPages: 1,
          }),
        );
      }
      if (input.endsWith('/procurement/purchase-orders') && options?.method === 'POST') {
        const order = {
          createdAt: '2026-08-11T12:00:00.000Z',
          currencyCode: 'BGN',
          id: orderId,
          lines: [
            {
              deliveredQuantity: '0.0000',
              expectedDeliveryDate: '2026-08-22',
              id: orderLineId,
              invoicedQuantity: '0.0000',
              orderedQuantity: '2.0000',
              productId: inventoryProductFixture.id,
              productName: inventoryProductFixture.name,
              unitPrice: '125.5000',
            },
          ],
          receipts: [],
          status: 'open',
          supplierName: references.suppliers[0]!.name,
          supplierPartnerId: supplierId,
          updatedAt: '2026-08-11T12:00:00.000Z',
          version: 1,
          warehouseId: warehouseFixture.id,
          warehouseName: warehouseFixture.name,
        };
        orders = [order];
        return Promise.resolve(jsonResponse(order, 201));
      }
      if (
        input.endsWith(`/procurement/purchase-orders/${orderId}/receipts`) &&
        options?.method === 'POST'
      ) {
        const receipt = {
          id: '776fd1d4-d58e-45b9-ad95-46f8f4ee0fd8',
          lines: [
            {
              id: 'e7b1d91c-20a0-4bbb-8a40-a53e09cd4e2a',
              orderLineId,
              productId: inventoryProductFixture.id,
              quantity: '2.0000',
              serialItemIds: [],
              stockMovementId: '8ba45261-415b-4e9b-b857-b0f7f4ef3658',
              totalCostBgn: '251.0000',
              unitCostBgn: '125.5000',
            },
          ],
          purchaseOrderId: orderId,
          receivedAt: '2026-08-11T12:10:00.000Z',
          supplierDeliveryReference: 'DEL-2026-42',
          warehouseId: warehouseFixture.id,
        };
        orders = [
          {
            ...(orders[0] as Record<string, unknown>),
            lines: [
              {
                ...((orders[0] as { lines: Array<Record<string, unknown>> }).lines[0] ?? {}),
                deliveredQuantity: '2.0000',
              },
            ],
            receipts: [receipt],
            status: 'received',
            version: 2,
          },
        ];
        return Promise.resolve(jsonResponse(receipt, 201));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/erp.procurement/purchase-orders']);
    expect(await screen.findByRole('heading', { name: messages.procurement.orders })).toBeTruthy();
    expect(screen.getByText(messages.procurement.emptyOrders)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: messages.procurement.newOrder }));
    const createDialog = screen.getByRole('dialog', { name: messages.procurement.orderTitle });
    fireEvent.change(within(createDialog).getByLabelText(messages.procurement.quantity), {
      target: { value: '2' },
    });
    fireEvent.change(within(createDialog).getByLabelText(messages.procurement.unitPrice), {
      target: { value: '125.5' },
    });
    fireEvent.change(within(createDialog).getByLabelText(messages.procurement.expectedDate), {
      target: { value: '2026-08-22' },
    });
    fireEvent.click(within(createDialog).getByRole('button', { name: messages.procurement.save }));
    expect(await screen.findByText(messages.procurement.createSuccess)).toBeTruthy();
    expect(await screen.findByText(references.suppliers[0]!.name)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: messages.procurement.receive }));
    const receiptDialog = screen.getByRole('dialog', { name: messages.procurement.receiveTitle });
    fireEvent.change(within(receiptDialog).getByLabelText(messages.procurement.deliveryReference), {
      target: { value: 'DEL-2026-42' },
    });
    fireEvent.click(
      within(receiptDialog).getByRole('button', { name: messages.procurement.receive }),
    );
    expect(await screen.findByText(messages.procurement.receiveSuccess)).toBeTruthy();
    expect(await screen.findByText(messages.procurement.received)).toBeTruthy();

    const createCall = fetchMock.mock.calls.find(
      ([url, options]) =>
        url.endsWith('/procurement/purchase-orders') && options?.method === 'POST',
    );
    expect(JSON.parse((createCall?.[1] as RequestInit).body as string)).toEqual({
      currencyCode: 'BGN',
      lines: [
        {
          expectedDeliveryDate: '2026-08-22',
          productId: inventoryProductFixture.id,
          quantity: '2',
          unitPrice: '125.5',
        },
      ],
      supplierPartnerId: supplierId,
      warehouseId: warehouseFixture.id,
    });
  });

  it('navigates supplier records, previews terms, and records an invoice without route knowledge', async () => {
    const procurementContext = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'view', module: 'erp.procurement' },
        { action: 'create', module: 'erp.procurement' },
        { action: 'edit', module: 'erp.procurement' },
      ],
    };
    storeAuthenticatedSession(procurementContext);
    const supplierId = '98a449a9-c96c-41f6-9eb1-ef912785b314';
    const orderLineId = '5cbb4102-df1b-4671-a5f9-b592a09bc8f5';
    const orderId = '6b945bbd-b026-44b1-8f74-d8af4fd7cc92';
    let supplier: ProcurementSupplierRecord = {
      contacts: [
        {
          email: 'orders@supplier.example',
          name: 'Mira Ivanova',
          role: 'Sales contact',
        },
      ],
      evaluations: [],
      profile: {
        supplierName: 'Vratsa Technical Supply Ltd.',
        supplierPartnerId: supplierId,
        version: 0,
      },
    };
    const order = {
      createdAt: '2026-08-11T12:00:00.000Z',
      currencyCode: 'BGN',
      id: orderId,
      lines: [
        {
          deliveredQuantity: '2.0000',
          expectedDeliveryDate: '2026-08-20',
          id: orderLineId,
          invoicedQuantity: '0.0000',
          orderedQuantity: '2.0000',
          productId: inventoryProductFixture.id,
          productName: inventoryProductFixture.name,
          unitPrice: '40.0000',
        },
      ],
      receipts: [],
      status: 'received',
      supplierInvoices: [],
      supplierName: supplier.profile.supplierName,
      supplierPartnerId: supplierId,
      updatedAt: '2026-08-11T12:00:00.000Z',
      version: 2,
      warehouseId: warehouseFixture.id,
      warehouseName: warehouseFixture.name,
    };
    let invoices: unknown[] = [];
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(procurementContext));
      if (input.endsWith('/procurement/suppliers') && options?.method !== 'PUT') {
        return Promise.resolve(jsonResponse([supplier]));
      }
      if (input.includes('/procurement/purchase-orders?')) {
        return Promise.resolve(
          jsonResponse({ items: [order], page: 1, pageSize: 100, total: 1, totalPages: 1 }),
        );
      }
      if (input.endsWith('/procurement/supplier-invoices') && options?.method !== 'POST') {
        return Promise.resolve(jsonResponse(invoices));
      }
      if (input.endsWith('/procurement/supplier-claims')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (
        input.endsWith(`/procurement/suppliers/${supplierId}/commercial-profile`) &&
        options?.method === 'PUT'
      ) {
        const body = JSON.parse(options.body as string) as {
          deliveryTerms?: string;
          paymentTermsDays?: number;
        };
        supplier = {
          ...supplier,
          profile: {
            ...supplier.profile,
            ...body,
            updatedAt: '2026-08-11T13:00:00.000Z',
            version: 1,
          },
        };
        return Promise.resolve(jsonResponse(supplier.profile));
      }
      if (input.endsWith('/procurement/supplier-invoices') && options?.method === 'POST') {
        const invoice = {
          currencyCode: 'BGN',
          id: 'b58ce02e-5042-4cf8-9d45-78d65d537e1a',
          invoiceDate: '2026-08-11',
          invoiceNumber: 'SUP-2026-101',
          lines: [
            {
              id: '592fd12f-f1d0-4c78-8e8f-9a2d2af7a34c',
              lineTotal: '80.0000',
              orderLineId,
              productId: inventoryProductFixture.id,
              productName: inventoryProductFixture.name,
              quantity: '2.0000',
              unitPrice: '40.0000',
            },
          ],
          purchaseOrderId: orderId,
          recordedAt: '2026-08-11T13:05:00.000Z',
          supplierName: supplier.profile.supplierName,
          supplierPartnerId: supplierId,
          total: '80.0000',
        };
        invoices = [invoice];
        return Promise.resolve(jsonResponse(invoice, 201));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/erp.procurement']);
    expect(await screen.findByRole('heading', { name: 'Procurement' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: /Suppliers Review supplier contacts/u }));

    expect(await screen.findByRole('heading', { name: 'Suppliers' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Preview supplier' }));
    const supplierDialog = await screen.findByRole('dialog', {
      name: supplier.profile.supplierName,
    });
    expect(
      within(supplierDialog).getByRole('button', { name: 'Back to procurement list' }),
    ).toBeTruthy();
    fireEvent.change(within(supplierDialog).getByLabelText('Payment terms in days'), {
      target: { value: '30' },
    });
    fireEvent.change(within(supplierDialog).getByLabelText('Delivery terms'), {
      target: { value: 'DAP warehouse' },
    });
    fireEvent.click(within(supplierDialog).getByRole('button', { name: 'Save terms' }));
    expect(await screen.findByText('Supplier record updated.')).toBeTruthy();

    fireEvent.click(screen.getByRole('link', { name: 'Supplier invoices' }));
    expect(await screen.findByRole('heading', { name: 'Supplier invoices' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Record supplier invoice/u }));
    const invoiceDialog = await screen.findByRole('dialog', { name: 'Record supplier invoice' });
    fireEvent.change(within(invoiceDialog).getByLabelText('Supplier invoice number'), {
      target: { value: 'SUP-2026-101' },
    });
    fireEvent.click(within(invoiceDialog).getByRole('button', { name: 'Record invoice' }));
    expect(
      await screen.findByText('Supplier invoice recorded and comparison updated.'),
    ).toBeTruthy();

    expect(
      fetchMock.mock.calls.some(
        ([url, options]) =>
          url.endsWith(`/procurement/suppliers/${supplierId}/commercial-profile`) &&
          options?.method === 'PUT',
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) =>
          url.endsWith('/procurement/supplier-invoices') && options?.method === 'POST',
      ),
    ).toBe(true);
  });
});

function renderApplication(initialEntries: string[]) {
  return render(
    <RouterProvider initialPath={initialEntries[0] ?? '/'}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </RouterProvider>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

function storeAuthenticatedSession(context: typeof authenticationContext): void {
  sessionStorage.setItem('vista.erp-crm.session.v1', JSON.stringify({ ...loginResponse, context }));
}
