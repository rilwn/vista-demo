import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  CrmAnalyticsOverview,
  CrmLead,
  CrmOpportunity,
  CrmReportDefinition,
  CrmReportExport,
  CustomerPaymentAccount,
  CustomerOperationalOverview,
  FinanceAgingReport,
  FinanceJournalReport,
  FinanceReportDefinition,
  FinanceReportExport,
  SavedFinanceReport,
  FinanceBankStatement,
  FinanceCashVoucher,
  FinanceSupplierOffset,
  FinanceSupplierPayable,
  FinanceSupplierPayment,
  FinanceTurnoverReport,
  FinanceVatReviewReport,
  PartnerProfile,
  PartnerSummary,
  ProcurementSupplierRecord,
  SalesWorkflow,
  ServiceInspectionPlan,
  ServiceReportDefinition,
  ServiceReportOverview,
  WarrantyClaim,
} from '@vista/contracts';
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
} satisfies PartnerSummary;

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
} satisfies PartnerProfile;

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

  it('lets an employee complete a verified recovery handoff without creating a browser session', async () => {
    const recoveryCode = 'A'.repeat(43);
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        requiresTotpEnrollment: false,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderApplication(['/recover']);

    fireEvent.change(screen.getByLabelText('Work email'), {
      target: { value: 'employee@example.invalid' },
    });
    fireEvent.change(screen.getByLabelText('Recovery code'), { target: { value: recoveryCode } });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'Vista-Recovered-Password-9!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'Vista-Recovered-Password-9!' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Reset password' }).closest('form')!);

    expect(await screen.findByRole('heading', { name: 'Account recovered' })).toBeTruthy();
    expect(sessionStorage.getItem('vista.erp-crm.session.v1')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/recovery/complete',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      email: 'employee@example.invalid',
      newPassword: 'Vista-Recovered-Password-9!',
      recoveryCode,
    });
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
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/auth/'))).toHaveLength(2);

    const currentAccountRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(currentAccountRequest.headers).get('Authorization')).toBe(
      `Bearer ${loginResponse.sessionToken}`,
    );
  });

  it('searches permitted workspace pages and exposes a role-aware account menu', async () => {
    storeAuthenticatedSession(authenticationContext);
    const fetchMock = vi.fn((input: string) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(authenticationContext));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/']);
    await screen.findByRole('heading', { name: `${messages.home.title}, Mila.` });

    const search = screen.getByRole('combobox', { name: 'Search pages and work areas' });
    fireEvent.focus(search);
    await screen.findByRole('listbox', { name: 'Workspace destinations' });
    fireEvent.change(search, { target: { value: 'Finance' } });
    expect(await screen.findByText('No matching page')).toBeTruthy();
    fireEvent.change(search, { target: { value: 'Customers & CRM' } });
    fireEvent.click(await screen.findByRole('option', { name: /Customers & CRM/u }));
    expect(await screen.findByRole('heading', { name: moduleMessages.crm.label })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open account menu' }));
    const menu = screen.getByRole('menu', { name: 'Account menu' });
    expect(within(menu).getByRole('menuitem', { name: /My access & security/u })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Overview' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: messages.navigation.signOut })).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: 'Security administration' })).toBeNull();
  });

  it('starts a newly signed-in employee at the overview instead of restoring a stale restricted page', async () => {
    const warehouseOnlyContext = {
      ...authenticationContext,
      permissions: [{ action: 'view', module: 'erp.warehouse' }],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(loginResponse))
      .mockResolvedValueOnce(jsonResponse(warehouseOnlyContext));
    vi.stubGlobal('fetch', fetchMock);
    renderApplication(['/partners']);

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
    expect(screen.queryByText(messages.states.notFound)).toBeNull();
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

    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/auth/'))).toHaveLength(
        3,
      ),
    );
    expect(
      await screen.findByRole('heading', { name: `${messages.home.title}, Mila.` }),
    ).toBeTruthy();
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
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/auth/'))).toHaveLength(1);
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
    expect(screen.getByRole('link', { name: 'Back to Overview' })).toBeTruthy();
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

  it('enrols an authenticator from My access and verifies its current code', async () => {
    storeAuthenticatedSession(authenticationContext);
    const enrollmentId = '825eef1d-56d5-431d-838c-0084076f32d7';
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(authenticationContext));
      if (input.endsWith('/auth/me/totp') && !options?.method)
        return Promise.resolve(jsonResponse({ enrolled: false }));
      if (input.endsWith('/auth/me/totp/enrollment') && options?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            enrollmentId,
            expiresAt: '2026-08-12T11:15:00.000Z',
            manualEntryKey: 'ABCDEFGHIJKLMNOP',
            provisioningUri:
              'otpauth://totp/Vista%20Service:mila@example.invalid?secret=ABCDEFGHIJKLMNOP',
          }),
        );
      }
      if (input.endsWith(`/auth/me/totp/enrollment/${enrollmentId}/verify`)) {
        return Promise.resolve(
          jsonResponse({
            enrolled: true,
            enrolledAt: '2026-08-12T11:01:00.000Z',
            revokedOtherSessionCount: 0,
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/access']);
    await screen.findByRole('heading', { name: messages.access.title });
    await screen.findByRole('button', { name: messages.access.setUpAuthenticator });
    fireEvent.click(screen.getByRole('button', { name: messages.access.setUpAuthenticator }));
    const drawer = await screen.findByRole('dialog', {
      name: messages.access.authenticatorSetupTitle,
    });
    fireEvent.change(within(drawer).getByLabelText(messages.access.currentPassword), {
      target: { value: 'Current-Password-7!' },
    });
    fireEvent.submit(
      within(drawer)
        .getByRole('button', { name: messages.access.setUpAuthenticator })
        .closest('form')!,
    );

    expect(await within(drawer).findByText('ABCD EFGH IJKL MNOP')).toBeTruthy();
    expect(
      await within(drawer).findByRole('img', {
        name: 'Scan this QR code with your authenticator app',
      }),
    ).toBeTruthy();
    fireEvent.change(within(drawer).getByLabelText(messages.access.authenticatorCode), {
      target: { value: '123 456extra' },
    });
    expect(
      within(drawer).getByLabelText<HTMLInputElement>(messages.access.authenticatorCode).value,
    ).toBe('123456');
    fireEvent.submit(
      within(drawer)
        .getByRole('button', { name: messages.access.verifyAuthenticator })
        .closest('form')!,
    );

    expect(await screen.findByText(messages.access.authenticatorEnrollmentSuccess)).toBeTruthy();
    expect(
      screen.queryByRole('dialog', { name: messages.access.authenticatorSetupTitle }),
    ).toBeNull();
    const command = fetchMock.mock.calls.find(([url]) =>
      url.endsWith(`/auth/me/totp/enrollment/${enrollmentId}/verify`),
    );
    expect(JSON.parse((command?.[1] as RequestInit).body as string)).toEqual({ code: '123456' });
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
    const paymentNotification = {
      channel: 'in_system' as const,
      createdAt: '2026-08-21T10:00:00.000Z',
      deliveredAt: '2026-08-21T10:01:00.000Z',
      id: 'b4ffce3c-bde4-42cc-a20b-4b8cd8ce7a45',
      payload: {
        counterpartyName: 'Alfa Market Demo Ltd.',
        dueDate: '2026-08-27',
        number: 'FIN-REV-2026-000005',
        outstandingBgn: '60.0000',
      },
      templateKey: 'finance.payment.upcoming',
      templateVersion: 1,
    };
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(authenticationContext));
      if (input.includes('/notifications?'))
        return Promise.resolve(
          jsonResponse({ items: [paymentNotification, notification], unreadCount: 2 }),
        );
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
    expect(screen.getByText('Payment is due soon')).toBeTruthy();
    expect(screen.getByText(/FIN-REV-2026-000005 · Alfa Market Demo Ltd\./u)).toBeTruthy();
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
    expect(screen.getByRole('link', { name: 'Back to Customers & CRM' })).toBeTruthy();
    expect(screen.getByText(messages.partners.results(1))).toBeTruthy();
    expect(screen.queryByRole('button', { name: messages.partners.create })).toBeNull();
    fireEvent.click(partnerButton);
    const detailDialog = screen.getByRole('dialog', { name: messages.partners.detailsTitle });
    expect(detailDialog.classList.contains('partner-detail-drawer')).toBe(true);
    expect(
      within(detailDialog).getByRole('heading', { name: 'Registration details' }),
    ).toBeTruthy();
    expect(detailDialog.querySelectorAll('.partner-detail-list > div')).toHaveLength(5);
    expect(screen.getAllByText(partner.uic).length).toBeGreaterThan(0);
    expect(await screen.findByText('Maria Petrova')).toBeTruthy();
    expect(screen.getByText('GB82WEST12345698765432')).toBeTruthy();

    const listRequest = fetchMock.mock.calls[1];
    expect(listRequest?.[0]).toContain('/api/v1/master-data/partners?');
    expect(new Headers((listRequest?.[1] as RequestInit).headers).get('Authorization')).toBe(
      `Bearer ${loginResponse.sessionToken}`,
    );
  });

  it('keeps the New ticket fields scrollable above an edge-to-edge action footer', async () => {
    const crmContext = {
      ...authenticationContext,
      permissions: [...authenticationContext.permissions, { action: 'create', module: 'crm' }],
    };
    storeAuthenticatedSession(crmContext);
    let releaseReferences: () => void = () => {};
    const referenceGate = new Promise<void>((resolve) => {
      releaseReferences = resolve;
    });
    const fetchMock = vi.fn((input: string) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(crmContext));
      if (input.endsWith('/crm/tickets/reference-data')) {
        return referenceGate.then(() =>
          jsonResponse({
            assignees: [],
            businessTimezone: 'Europe/Sofia',
            categories: [{ code: 'billing', id: 'category-1', name: 'Billing' }],
            customers: [{ id: partner.id, name: partner.displayName }],
            equipment: [],
            locations: [],
            slaPolicies: [
              {
                id: 'sla-1',
                name: 'Standard care',
                priority: 'normal',
                responseMinutes: 240,
                resolutionMinutes: 1440,
              },
            ],
            subscriptions: [],
          }),
        );
      }
      if (input.includes('/crm/tickets?')) {
        return Promise.resolve(
          jsonResponse({
            items: [],
            page: 1,
            pageSize: 25,
            summary: { atRisk: 0, breached: 0, open: 0, unassigned: 0 },
            total: 0,
            totalPages: 0,
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/crm/tickets']);

    const newTicket = await screen.findByRole<HTMLButtonElement>('button', { name: /New ticket/u });
    expect(newTicket.disabled).toBe(true);
    fireEvent.click(newTicket);
    expect(screen.queryByRole('dialog', { name: 'New ticket' })).toBeNull();
    releaseReferences();
    await waitFor(() => expect(newTicket.disabled).toBe(false));
    fireEvent.click(newTicket);
    const dialog = await screen.findByRole('dialog', { name: 'New ticket' });
    const form = dialog.querySelector<HTMLFormElement>('.crm-ticket-form');
    expect(form).toBeTruthy();
    expect(form?.children[0]?.classList.contains('crm-ticket-form-scroll')).toBe(true);
    expect(form?.children[1]?.classList.contains('crm-ticket-drawer-actions')).toBe(true);
    const footer = form?.children[1] as HTMLElement;
    expect(within(footer).getByRole('button', { name: 'Create ticket' })).toBeTruthy();
    expect(within(footer).getByRole('button', { name: 'Back' })).toBeTruthy();
  });

  it('records customer interactions and completes assigned follow-up tasks from the CRM timeline', async () => {
    const crmContext = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'create', module: 'crm' },
        { action: 'edit', module: 'crm' },
      ],
    };
    storeAuthenticatedSession(crmContext);
    const customerId = '6d17e1cc-bfef-4d25-bd44-833894c14ed6';
    const locationId = '08d7992e-504a-4b86-b10d-c06ba6ab30de';
    const interactionId = 'b88a1b22-ad44-4ba2-b50f-21df3ae5e767';
    const taskId = '72d20969-8d5b-45f3-9403-e842c380a2d2';
    const references = {
      assignees: [{ displayName: 'Mila Petrova', id: crmContext.accountId }],
      businessTimezone: 'Europe/Sofia',
      contacts: [{ customerPartnerId: customerId, displayName: 'Elena Petrova', id: 'contact-1' }],
      customers: [{ id: customerId, name: 'Alfa Market Demo Ltd.' }],
      locations: [{ customerPartnerId: customerId, id: locationId, name: 'Main retail store' }],
    };
    let interaction: Record<string, unknown> | null = null;
    let task: Record<string, unknown> | null = null;
    function page() {
      const items = [
        ...(interaction
          ? [{ interaction, kind: 'interaction', occurredAt: interaction['occurredAt'] }]
          : []),
        ...(task
          ? [
              {
                kind: 'task_event',
                occurredAt: task['updatedAt'],
                task,
                taskEvent: (task['history'] as unknown[]).at(-1),
              },
            ]
          : []),
      ];
      return {
        items,
        openTasks: task?.['status'] === 'open' ? [task] : [],
        page: 1,
        pageSize: 25,
        summary: {
          interactions: interaction ? 1 : 0,
          openTasks: task?.['status'] === 'open' ? 1 : 0,
          overdueTasks: 0,
        },
        total: items.length,
        totalPages: items.length ? 1 : 0,
      };
    }
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(crmContext));
      if (input.endsWith('/crm/timeline/reference-data')) {
        return Promise.resolve(jsonResponse(references));
      }
      if (input.includes('/crm/timeline?')) return Promise.resolve(jsonResponse(page()));
      if (input.endsWith('/crm/interactions') && options?.method === 'POST') {
        const body = JSON.parse(options.body as string) as Record<string, unknown>;
        interaction = {
          ...body,
          contactName: 'Elena Petrova',
          createdAt: '2026-09-01T09:01:00.000Z',
          createdByName: 'Mila Petrova',
          customerName: 'Alfa Market Demo Ltd.',
          id: interactionId,
          locationName: 'Main retail store',
        };
        return Promise.resolve(jsonResponse(interaction, 201));
      }
      if (input.endsWith('/crm/tasks') && options?.method === 'POST') {
        const body = JSON.parse(options.body as string) as Record<string, unknown>;
        task = {
          assignedTo: { displayName: 'Mila Petrova', id: crmContext.accountId },
          createdAt: '2026-09-01T09:02:00.000Z',
          customerName: 'Alfa Market Demo Ltd.',
          history: [
            {
              changedAt: '2026-09-01T09:02:00.000Z',
              changedByName: 'Mila Petrova',
              id: 'task-history-created',
              status: 'open',
              type: 'created',
            },
          ],
          id: taskId,
          locationName: 'Main retail store',
          status: 'open',
          updatedAt: '2026-09-01T09:02:00.000Z',
          version: 1,
          ...body,
        };
        return Promise.resolve(jsonResponse(task, 201));
      }
      if (input.endsWith(`/crm/tasks/${taskId}/transition`) && options?.method === 'POST') {
        task = {
          ...task,
          completedAt: '2026-09-01T09:10:00.000Z',
          history: [
            ...((task?.['history'] as unknown[]) ?? []),
            {
              changedAt: '2026-09-01T09:10:00.000Z',
              changedByName: 'Mila Petrova',
              id: 'task-history-completed',
              status: 'completed',
              type: 'completed',
            },
          ],
          status: 'completed',
          updatedAt: '2026-09-01T09:10:00.000Z',
          version: 2,
        };
        return Promise.resolve(jsonResponse(task));
      }
      if (input.includes('/files?')) {
        return Promise.resolve(
          jsonResponse({ items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/crm/timeline']);
    expect(await screen.findByRole('heading', { name: 'Interactions & tasks' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to Customers & CRM' })).toBeTruthy();
    const interactionButton = screen.getByRole('button', { name: /Log interaction/u });
    await waitFor(() => expect((interactionButton as HTMLButtonElement).disabled).toBe(false));
    interactionButton.focus();
    fireEvent.click(interactionButton);
    let interactionDialog = screen.getByRole('dialog', { name: 'Log interaction' });
    expect(document.activeElement).toBe(
      within(interactionDialog).getByRole('button', { name: 'Back from Log interaction' }),
    );
    fireEvent.keyDown(interactionDialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Log interaction' })).toBeNull();
    expect(document.activeElement).toBe(interactionButton);
    fireEvent.click(interactionButton);
    interactionDialog = screen.getByRole('dialog', { name: 'Log interaction' });
    expect(interactionDialog.querySelector('.crm-timeline-drawer-actions')).toBeTruthy();
    fireEvent.change(within(interactionDialog).getByLabelText('Location (optional)'), {
      target: { value: locationId },
    });
    fireEvent.change(within(interactionDialog).getByLabelText('Subject'), {
      target: { value: 'Additional device quotation' },
    });
    fireEvent.change(within(interactionDialog).getByLabelText('Notes'), {
      target: { value: 'The customer requested a quotation for an additional device.' },
    });
    fireEvent.click(within(interactionDialog).getByRole('button', { name: 'Save interaction' }));
    expect(
      await screen.findByText('The interaction was added to the customer timeline.'),
    ).toBeTruthy();
    expect(await screen.findByText('Additional device quotation')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    const taskDialog = screen.getByRole('dialog', { name: 'New task' });
    fireEvent.change(within(taskDialog).getByLabelText('Location (optional)'), {
      target: { value: locationId },
    });
    fireEvent.change(within(taskDialog).getByLabelText('Task'), {
      target: { value: 'Send the requested quotation' },
    });
    fireEvent.click(within(taskDialog).getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText('The follow-up task was created.')).toBeTruthy();
    expect((await screen.findAllByText('Send the requested quotation')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: /Send the requested quotation/u })[0]!);
    const taskPreview = await screen.findByRole('dialog', { name: 'Task details' });
    fireEvent.click(within(taskPreview).getByRole('button', { name: /Complete task/u }));
    expect(await screen.findByText('The task was completed.')).toBeTruthy();
    expect(within(taskPreview).getByText('Completed')).toBeTruthy();

    const interactionCommand = fetchMock.mock.calls.find(
      ([url, options]) => url.endsWith('/crm/interactions') && options?.method === 'POST',
    );
    expect(JSON.parse((interactionCommand?.[1] as RequestInit).body as string)).toMatchObject({
      customerLocationId: locationId,
      customerPartnerId: customerId,
      interactionType: 'incoming_call',
      subject: 'Additional device quotation',
    });
  });

  it('qualifies a lead, converts it once, and moves the opportunity through the CRM pipeline', async () => {
    const crmContext = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'create', module: 'crm' },
        { action: 'edit', module: 'crm' },
      ],
    };
    storeAuthenticatedSession(crmContext);
    const owner = { displayName: 'Mila Petrova', id: crmContext.accountId };
    const customerId = 'aa17e1cc-bfef-4d25-bd44-833894c14ed6';
    const leadId = 'ab8a1b22-ad44-4ba2-b50f-21df3ae5e767';
    const opportunityId = 'ac8a1b22-ad44-4ba2-b50f-21df3ae5e767';
    let customers: Array<{ id: string; name: string }> = [];
    let lead: CrmLead | null = null;
    let opportunity: CrmOpportunity | null = null;
    const references = () => ({
      assignees: [owner],
      businessTimezone: 'Europe/Sofia',
      customers,
      quotations: [],
    });
    const leadPage = () => ({
      items: lead ? [lead] : [],
      page: 1,
      pageSize: 25,
      summary: {
        converted: lead?.status === 'converted' ? 1 : 0,
        new: lead?.status === 'new' ? 1 : 0,
        qualified: lead?.status === 'qualified' ? 1 : 0,
      },
      total: lead ? 1 : 0,
      totalPages: lead ? 1 : 0,
    });
    const opportunityPage = () => ({
      items: opportunity ? [opportunity] : [],
      page: 1,
      pageSize: 200,
      summary: {
        openCount: opportunity && !['won', 'lost'].includes(opportunity.stage) ? 1 : 0,
        openRevenueBgn: opportunity ? opportunity.estimatedRevenueBgn : '0',
        weightedRevenueBgn: opportunity ? opportunity.weightedRevenueBgn : '0',
        wonRevenueBgn: opportunity?.stage === 'won' ? opportunity.estimatedRevenueBgn : '0',
      },
      total: opportunity ? 1 : 0,
      totalPages: opportunity ? 1 : 0,
    });
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(crmContext));
      if (input.endsWith('/crm/pipeline/reference-data'))
        return Promise.resolve(jsonResponse(references()));
      if (input.includes('/crm/leads?')) return Promise.resolve(jsonResponse(leadPage()));
      if (input.includes('/crm/opportunities?'))
        return Promise.resolve(jsonResponse(opportunityPage()));
      if (input.endsWith('/crm/leads') && options?.method === 'POST') {
        const body = JSON.parse(options.body as string) as Record<string, unknown>;
        lead = {
          contactName: body['contactName'] as string,
          createdAt: '2026-09-01T10:00:00.000Z',
          email: body['email'] as string,
          history: [
            {
              changedAt: '2026-09-01T10:00:00.000Z',
              changedByName: owner.displayName,
              id: 'lead-created',
              status: 'new',
              type: 'created',
            },
          ],
          id: leadId,
          number: 'LEAD-2026-000001',
          notes: body['notes'] as string,
          organizationName: body['organizationName'] as string,
          owner,
          source: body['source'] as CrmLead['source'],
          status: 'new',
          telephone: body['telephone'] as string,
          updatedAt: '2026-09-01T10:00:00.000Z',
          version: 1,
        };
        return Promise.resolve(jsonResponse(lead, 201));
      }
      if (input.endsWith(`/crm/leads/${leadId}/qualify`) && options?.method === 'POST') {
        lead = {
          ...lead!,
          history: [
            ...lead!.history,
            {
              changedAt: '2026-09-01T10:05:00.000Z',
              changedByName: owner.displayName,
              id: 'lead-qualified',
              status: 'qualified',
              type: 'qualified',
            },
          ],
          qualifiedAt: '2026-09-01T10:05:00.000Z',
          status: 'qualified',
          updatedAt: '2026-09-01T10:05:00.000Z',
          version: 2,
        };
        return Promise.resolve(jsonResponse(lead));
      }
      if (input.endsWith(`/crm/leads/${leadId}/convert`) && options?.method === 'POST') {
        const body = JSON.parse(options.body as string) as {
          newCustomer: { displayName: string };
          opportunity: {
            description?: string;
            estimatedRevenueBgn: string;
            expectedCloseOn?: string;
            ownerAccountId: string;
            probabilityPercent: number;
            title: string;
          };
        };
        customers = [{ id: customerId, name: body.newCustomer.displayName }];
        lead = {
          ...lead!,
          convertedAt: '2026-09-01T10:10:00.000Z',
          convertedCustomer: customers[0]!,
          history: [
            ...lead!.history,
            {
              changedAt: '2026-09-01T10:10:00.000Z',
              changedByName: owner.displayName,
              id: 'lead-converted',
              status: 'converted',
              type: 'converted',
            },
          ],
          status: 'converted',
          updatedAt: '2026-09-01T10:10:00.000Z',
          version: 3,
        };
        opportunity = {
          createdAt: '2026-09-01T10:10:00.000Z',
          customer: customers[0]!,
          ...(body.opportunity.description ? { description: body.opportunity.description } : {}),
          estimatedRevenueBgn: '1800.00',
          ...(body.opportunity.expectedCloseOn
            ? { expectedCloseOn: body.opportunity.expectedCloseOn }
            : {}),
          history: [
            {
              changedAt: '2026-09-01T10:10:00.000Z',
              changedByName: owner.displayName,
              id: 'opportunity-created',
              nextStage: 'qualified',
              probabilityPercent: 40,
              type: 'created',
            },
          ],
          id: opportunityId,
          number: 'OPP-2026-000001',
          owner,
          probabilityPercent: 40,
          quotations: [],
          sourceLeadId: leadId,
          stage: 'qualified',
          title: body.opportunity.title,
          updatedAt: '2026-09-01T10:10:00.000Z',
          version: 1,
          weightedRevenueBgn: '720.00',
        };
        return Promise.resolve(jsonResponse({ customer: customers[0], lead, opportunity }));
      }
      if (input.endsWith(`/crm/opportunities/${opportunityId}`) && !options?.method)
        return Promise.resolve(jsonResponse(opportunity));
      if (
        input.endsWith(`/crm/opportunities/${opportunityId}/stage`) &&
        options?.method === 'POST'
      ) {
        const body = JSON.parse(options.body as string) as {
          probabilityPercent: number;
          stage: CrmOpportunity['stage'];
        };
        opportunity = {
          ...opportunity!,
          history: [
            ...opportunity!.history,
            {
              changedAt: '2026-09-01T10:15:00.000Z',
              changedByName: owner.displayName,
              id: 'opportunity-moved',
              nextStage: body.stage,
              previousStage: opportunity!.stage,
              probabilityPercent: body.probabilityPercent,
              type: 'stage_changed',
            },
          ],
          probabilityPercent: body.probabilityPercent,
          stage: body.stage,
          updatedAt: '2026-09-01T10:15:00.000Z',
          version: 2,
          weightedRevenueBgn: '720.00',
        };
        return Promise.resolve(jsonResponse(opportunity));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/crm/leads']);
    expect(await screen.findByRole('heading', { name: 'Leads & opportunities' })).toBeTruthy();
    const newLead = screen.getByRole('button', { name: /New lead/u });
    await waitFor(() => expect((newLead as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(newLead);
    let dialog = screen.getByRole('dialog', { name: 'New lead' });
    fireEvent.change(within(dialog).getByLabelText('Company or prospect name'), {
      target: { value: 'North Shop Demo Ltd.' },
    });
    fireEvent.change(within(dialog).getByLabelText('Contact person'), {
      target: { value: 'Petar Dimitrov' },
    });
    fireEvent.change(within(dialog).getByLabelText('Telephone'), {
      target: { value: '+359 888 200 300' },
    });
    fireEvent.change(within(dialog).getByLabelText('Notes (optional)'), {
      target: { value: 'Interested in a fiscal device and annual service.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save lead' }));
    expect(await screen.findByText('LEAD-2026-000001 was added to the lead desk.')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: /North Shop Demo Ltd\./u }));
    dialog = screen.getByRole('dialog', { name: 'North Shop Demo Ltd.' });
    expect(dialog.querySelector('.security-drawer-body > .crm-pipeline-preview')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /Mark as qualified/u }));
    expect(await screen.findByText('LEAD-2026-000001 is ready for conversion.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Convert lead' }));
    dialog = screen.getByRole('dialog', { name: 'Convert lead' });
    const conversionForm = dialog.querySelector('form.crm-timeline-drawer-form');
    expect(conversionForm?.querySelector(':scope > .crm-timeline-drawer-scroll')).toBeTruthy();
    expect(conversionForm?.querySelector(':scope > .crm-timeline-drawer-actions')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Opportunity name'), {
      target: { value: 'Fiscal device and annual service' },
    });
    fireEvent.change(within(dialog).getByLabelText('Estimated value (BGN)'), {
      target: { value: '1800' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Convert lead' }));
    expect(
      await screen.findByText(
        'LEAD-2026-000001 became North Shop Demo Ltd. with opportunity OPP-2026-000001.',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Sales pipeline/u }));
    expect(await screen.findByText('Fiscal device and annual service')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Fiscal device and annual service/u }));
    dialog = await screen.findByRole('dialog', { name: 'Fiscal device and annual service' });
    expect(dialog.querySelector('.security-drawer-body > .crm-pipeline-preview')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Next stage'), {
      target: { value: 'quotation_sent' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update stage' }));
    expect(await screen.findByText('OPP-2026-000001 moved to Quotation sent.')).toBeTruthy();
    expect(within(dialog).getAllByText('Quotation sent').length).toBeGreaterThan(0);

    const convertCall = fetchMock.mock.calls.find(
      ([url, options]) =>
        url.endsWith(`/crm/leads/${leadId}/convert`) && options?.method === 'POST',
    );
    expect(JSON.parse((convertCall?.[1] as RequestInit).body as string)).toMatchObject({
      createOpportunity: true,
      expectedVersion: 2,
      newCustomer: { displayName: 'North Shop Demo Ltd.', kind: 'legal_entity' },
      opportunity: { estimatedRevenueBgn: '1800', probabilityPercent: 40 },
    });
  });

  it('uploads an immutable partner document from the nested partner view', async () => {
    const contextWithEdit = {
      ...authenticationContext,
      permissions: [...authenticationContext.permissions, { action: 'edit', module: 'crm' }],
    };
    const managedFile = {
      byteSize: 31,
      checksumSha256: '1'.repeat(64),
      createdAt: '2026-08-19T10:00:00.000Z',
      id: 'de1c9adf-cf80-427d-9865-fbb9899e4d4d',
      inspectionMethod: 'structural-signature',
      isCurrent: true,
      issuerAccountId: contextWithEdit.accountId,
      mediaType: 'application/pdf',
      originalName: 'service-agreement.pdf',
      parentId: partner.id,
      parentType: 'partner',
      scannedAt: '2026-08-19T10:00:00.000Z',
      status: 'available',
      version: 1,
      versionCount: 1,
      versionGroupId: '85e019a1-16dc-4639-aeb4-b64cf58e90a0',
    };
    let fileListCalls = 0;
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(contextWithEdit));
      if (input.includes('/master-data/partners?'))
        return Promise.resolve(jsonResponse(partnerPage));
      if (input.endsWith(`/partners/${partner.id}/profile`))
        return Promise.resolve(jsonResponse(partnerProfile));
      if (input.endsWith(`/partners/${partner.id}/locations`))
        return Promise.resolve(jsonResponse([]));
      if (input.endsWith('/files') && options?.method === 'POST')
        return Promise.resolve(jsonResponse(managedFile, 201));
      if (input.includes('/files?')) {
        fileListCalls += 1;
        return Promise.resolve(
          jsonResponse({
            items: fileListCalls === 1 ? [] : [managedFile],
            page: 1,
            pageSize: 100,
            total: fileListCalls === 1 ? 0 : 1,
            totalPages: fileListCalls === 1 ? 0 : 1,
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    storeAuthenticatedSession(contextWithEdit);

    renderApplication(['/partners']);
    fireEvent.click(await screen.findByRole('button', { name: /Vista Retail Partner Ltd\./u }));
    fireEvent.click(screen.getByRole('button', { name: messages.partners.documents.open }));
    expect(
      await screen.findByRole('dialog', { name: messages.partners.documents.title }),
    ).toBeTruthy();
    expect(await screen.findByText(messages.partners.documents.emptyTitle)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: messages.partners.documents.add }));
    const selected = new File(['%PDF-1.4\nVista service agreement'], managedFile.originalName, {
      type: managedFile.mediaType,
    });
    fireEvent.change(screen.getByLabelText(messages.partners.documents.chooseFile), {
      target: { files: [selected] },
    });
    fireEvent.click(screen.getByRole('button', { name: messages.partners.documents.upload }));

    expect(await screen.findByText(managedFile.originalName)).toBeTruthy();
    expect(screen.getByText(messages.partners.documents.version(1), { exact: false })).toBeTruthy();
    const uploadRequest = fetchMock.mock.calls.find(
      ([url, options]) => url.endsWith('/files') && options?.method === 'POST',
    );
    const uploadOptions = uploadRequest?.[1] as RequestInit;
    expect(new Headers(uploadOptions.headers).get('Authorization')).toBe(
      `Bearer ${loginResponse.sessionToken}`,
    );
    expect(new Headers(uploadOptions.headers).get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/u);
    expect(uploadOptions.body).toBeInstanceOf(FormData);
    expect((uploadOptions.body as FormData).get('parentType')).toBe('partner');
    expect((uploadOptions.body as FormData).get('parentId')).toBe(partner.id);
    expect((uploadOptions.body as FormData).get('file')).toEqual(selected);

    fireEvent.click(screen.getByRole('button', { name: messages.partners.documents.back }));
    expect(screen.getByRole('dialog', { name: messages.partners.detailsTitle })).toBeTruthy();
  });

  it('shows one customer view across CRM, sales, finance, payments, locations, and equipment', async () => {
    const locationId = '3991eb4c-5257-4982-ae65-7c5cd2f81977';
    const overview: CustomerOperationalOverview = {
      financialDocuments: [
        {
          bgnGrossTotal: '60.0000',
          currencyCode: 'BGN',
          documentType: 'invoice',
          draftNumber: 'DINV-2026-000001',
          dueDate: '2026-09-08',
          grossTotal: '60.0000',
          id: 'cbd78dca-c987-4fa2-a64d-a1dd83ba5c79',
          issueDate: '2026-08-25',
          sourceSalesInvoiceId: '4d858c55-2579-4ed0-b0bd-91152013c987',
          status: 'draft',
        },
      ],
      locations: [
        {
          equipment: [
            {
              active: true,
              customerLocationId: locationId,
              deviceName: 'Demo Fiscal Register X1',
              id: 'a84fc2ec-1fdd-41f8-820e-c41bf570086b',
              purchaseDate: '2026-08-25',
              serialNumber: 'DEMO-FR-ALFA-01',
              status: 'active',
              version: 1,
              warrantyStartsOn: '2026-08-25',
            },
          ],
          location: {
            active: true,
            addressLine1: '12 Hristo Botev Blvd.',
            city: 'Vratsa',
            countryCode: 'BG',
            id: locationId,
            locationType: 'Store',
            name: 'Central Store',
            partnerId: partner.id,
            version: 1,
          },
        },
      ],
      payments: [
        {
          amount: '20.0000',
          currencyCode: 'BGN',
          id: 'c3603397-2627-47a4-a104-fb8a14ca2b2d',
          number: 'PAY-2026-000001',
          paymentDate: '2026-08-26',
          paymentMethod: 'bank_transfer',
          paymentReference: 'FIN-REV-2026-000001',
          recordedAt: '2026-08-26T09:00:00.000Z',
        },
      ],
      profile: partnerProfile,
      purchases: [
        {
          currencyCode: 'BGN',
          id: '4d858c55-2579-4ed0-b0bd-91152013c987',
          lines: [
            {
              lineTotal: '50.0000',
              productId: inventoryProductFixture.id,
              productName: 'Demo Fiscal Register X1',
              quantity: '1.0000',
              unitPrice: '50.0000',
            },
          ],
          number: 'DEV-INV-DRAFT-0001',
          recordedAt: '2026-08-25T12:00:00.000Z',
          source: 'erp_sales',
          sourceShipmentId: '6ee1d759-5832-48f1-8743-d412624221b4',
          total: '60.0000',
        },
      ],
      receivables: [
        {
          allocatedTotal: '20.0000',
          bgnTotal: '60.0000',
          currencyCode: 'BGN',
          documentDate: '2026-08-25',
          dueDate: '2026-09-08',
          id: '7ea2517a-1168-468f-9851-e74b8d884aa4',
          number: 'FIN-REV-2026-000001',
          outstandingTotal: '40.0000',
          paymentStatus: 'partially_paid',
          sourceSalesInvoiceId: '4d858c55-2579-4ed0-b0bd-91152013c987',
          total: '60.0000',
        },
      ],
      summary: {
        activeEquipment: 1,
        activeLocations: 1,
        financialDocuments: 1,
        lastPurchaseAt: '2026-08-25T12:00:00.000Z',
        openReceivables: 1,
        outstandingBgn: '40.0000',
        payments: 1,
        purchases: 1,
      },
    };
    const fetchMock = vi.fn((input: string) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(authenticationContext));
      if (input.includes('/master-data/partners?'))
        return Promise.resolve(jsonResponse(partnerPage));
      if (input.endsWith(`/partners/${partner.id}/profile`))
        return Promise.resolve(jsonResponse(partnerProfile));
      if (input.endsWith(`/partners/${partner.id}/locations`))
        return Promise.resolve(jsonResponse(overview.locations));
      if (input.endsWith(`/partners/${partner.id}/customer-overview?limit=10`))
        return Promise.resolve(jsonResponse(overview));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    storeAuthenticatedSession(authenticationContext);

    renderApplication(['/partners']);
    fireEvent.click(await screen.findByRole('button', { name: /Vista Retail Partner Ltd\./u }));
    await screen.findByText('Maria Petrova');
    fireEvent.click(screen.getByRole('button', { name: 'Customer overview' }));

    const dialog = await screen.findByRole('dialog', { name: 'Customer overview' });
    expect(within(dialog).getByRole('heading', { name: partner.displayName })).toBeTruthy();
    expect(within(dialog).getByText('FIN-REV-2026-000001')).toBeTruthy();
    expect(within(dialog).getByText('DEV-INV-DRAFT-0001')).toBeTruthy();
    expect(within(dialog).getAllByText('Demo Fiscal Register X1').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('DEMO-FR-ALFA-01')).toBeTruthy();
    expect(within(dialog).getByText('PAY-2026-000001')).toBeTruthy();
    expect(within(dialog).getByText('DINV-2026-000001')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to partner' }));
    expect(screen.getByRole('dialog', { name: messages.partners.detailsTitle })).toBeTruthy();
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
    fireEvent.click(
      screen.getByRole('radio', { name: new RegExp(messages.categories.serialTracking, 'u') }),
    );
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
    expect(JSON.parse(requestOptions.body as string)).toEqual({
      name: 'Electronic scales',
      requiresExpiry: false,
      trackingMode: 'serial',
    });
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
    expect(screen.getByRole('link', { name: 'Back to Warehouse' })).toBeTruthy();
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
      if (input.endsWith('/warehouse/serial-traceability/FDA-ALPHA-0001'))
        return Promise.resolve(
          jsonResponse({
            currentCustody: { displayName: 'Main retail site', type: 'customer' },
            currentWarehouse: {
              displayName: warehouseFixture.name,
              id: warehouseFixture.id,
            },
            customer: { displayName: 'Alfa Market Ltd.', id: partner.id },
            customerEquipment: {
              id: 'aa11ca8d-44dd-49ee-87f8-a9924666294e',
              location: {
                displayName: 'Main retail site',
                id: 'c4cb4711-b0cd-4b72-a876-bf1466b4cecc',
              },
              status: 'active',
            },
            events: [
              {
                actor: { displayName: 'Warehouse Manager', id: authenticationContext.accountId },
                eventId: 'movement:receipt',
                eventType: 'receipt',
                occurredAt: '2026-08-01T08:00:00.000Z',
                referenceId: 'DEL-2026-081',
                referenceType: 'Supplier delivery',
                supplier: { displayName: 'TechSupply Ltd.', id: partner.id },
                warehouse: { displayName: warehouseFixture.name, id: warehouseFixture.id },
              },
              {
                customer: { displayName: 'Alfa Market Ltd.', id: partner.id },
                customerLocation: {
                  displayName: 'Main retail site',
                  id: 'c4cb4711-b0cd-4b72-a876-bf1466b4cecc',
                },
                details: [{ label: 'Accepted by', value: 'Elena Petrova' }],
                eventId: 'handover:one',
                eventType: 'handover',
                occurredAt: '2026-08-05T10:00:00.000Z',
                referenceId: 'HO-2026-000081',
                referenceType: 'Equipment handover',
              },
              {
                customer: { displayName: 'Alfa Market Ltd.', id: partner.id },
                customerLocation: {
                  displayName: 'Main retail site',
                  id: 'c4cb4711-b0cd-4b72-a876-bf1466b4cecc',
                },
                description: 'Display connection repaired and tested.',
                details: [
                  { label: 'Working time', value: '45 minutes' },
                  { label: 'Repair cost', value: 'BGN 72.0000' },
                ],
                eventId: 'repair-completed:one',
                eventType: 'repair_completed',
                occurredAt: '2026-08-12T11:30:00.000Z',
                referenceId: 'WO-2026-000041',
                referenceType: 'Service work order',
                technician: {
                  displayName: 'Service Technician',
                  id: authenticationContext.accountId,
                },
              },
            ],
            product: { displayName: inventoryProductFixture.name, id: inventoryProductFixture.id },
            serialItemId: '77886c8d-5812-413d-a93c-c2bcbb4f27df',
            serialNumber: 'FDA-ALPHA-0001',
            status: 'issued',
          }),
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

    fireEvent.change(screen.getByLabelText('Serial number'), {
      target: { value: 'FDA-ALPHA-0001' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Trace serial' }));
    expect(await screen.findByText('Accepted by customer')).toBeTruthy();
    expect(screen.getByText('Repair completed')).toBeTruthy();
    expect(screen.getByText('Service Technician')).toBeTruthy();
    expect(screen.getAllByText('Main retail site').length).toBeGreaterThan(0);

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
      if (input.endsWith(`/platform/security/roles/${role.id}`) && options?.method === 'PUT') {
        return Promise.resolve(jsonResponse(role));
      }
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
    expect(await screen.findByRole('heading', { name: role.name })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit access' }));
    const roleDialog = screen.getByRole('dialog', { name: `Edit ${role.name}` });
    fireEvent.click(within(roleDialog).getByRole('button', { name: 'Save access' }));
    expect(await screen.findByText('Role access updated.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /^Sessions/u }));
    expect(await screen.findByText(/Current session/u)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Activity log' }));
    expect((await screen.findAllByText('Activity log checked')).length).toBeGreaterThan(0);
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
    const roleUpdateCommand = fetchMock.mock.calls.find(
      ([url, options]) =>
        url.endsWith(`/platform/security/roles/${role.id}`) && options?.method === 'PUT',
    );
    expect(roleUpdateCommand).toBeTruthy();
    expect(
      new Headers((roleUpdateCommand?.[1] as RequestInit).headers).get('Idempotency-Key'),
    ).toBeTruthy();
    expect(JSON.parse((roleUpdateCommand?.[1] as RequestInit).body as string)).toEqual({
      description: role.description,
      expectedVersion: role.version,
      name: role.name,
      permissions: role.permissions,
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
    const purchaseOrderWorkspace = screen.getByRole('region', {
      name: 'Purchase orders workspace',
    });
    expect(purchaseOrderWorkspace.classList.contains('procurement-tab-surface')).toBe(true);
    expect(
      within(purchaseOrderWorkspace).getByRole('heading', { name: 'Purchase order register' }),
    ).toBeTruthy();
    expect(screen.getByText(messages.procurement.emptyOrders)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: messages.procurement.newOrder }));
    const createDialog = screen.getByRole('dialog', { name: messages.procurement.orderTitle });
    expect(within(createDialog).getByRole('heading', { name: 'Order details' })).toBeTruthy();
    expect(within(createDialog).getByRole('heading', { name: 'Products' })).toBeTruthy();
    expect(
      within(createDialog).getByRole<HTMLButtonElement>('button', {
        name: 'All products added',
      }).disabled,
    ).toBe(true);
    expect(
      within(createDialog)
        .getByRole('button', { name: messages.procurement.save })
        .closest('footer')
        ?.classList.contains('procurement-drawer-actions'),
    ).toBe(true);
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
    expect(receiptDialog.classList.contains('goods-receipt-drawer')).toBe(true);
    expect(
      within(receiptDialog).getByRole('heading', { name: 'Products in this delivery' }),
    ).toBeTruthy();
    const includeProduct = within(receiptDialog).getByRole<HTMLInputElement>('checkbox', {
      name: new RegExp(inventoryProductFixture.name, 'u'),
    });
    expect(includeProduct.classList.contains('procurement-receive-checkbox')).toBe(true);
    expect(includeProduct.checked).toBe(true);
    fireEvent.click(includeProduct);
    expect(
      within(receiptDialog).getByLabelText<HTMLInputElement>(messages.procurement.quantity)
        .disabled,
    ).toBe(true);
    fireEvent.click(includeProduct);
    expect(
      within(receiptDialog).getByLabelText<HTMLInputElement>(messages.procurement.quantity)
        .disabled,
    ).toBe(false);
    fireEvent.change(within(receiptDialog).getByLabelText(messages.procurement.deliveryReference), {
      target: { value: 'DEL-2026-42' },
    });
    fireEvent.click(
      within(receiptDialog).getByRole('button', { name: messages.procurement.receive }),
    );
    expect(await screen.findByText(messages.procurement.receiveSuccess)).toBeTruthy();
    await waitFor(() => {
      expect(screen.getAllByText(messages.procurement.received).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('link', { name: 'Goods receipts' }));
    const goodsReceiptWorkspace = await screen.findByRole('region', {
      name: 'Goods receipts workspace',
    });
    expect(goodsReceiptWorkspace.className).toBe(purchaseOrderWorkspace.className);
    expect(
      within(goodsReceiptWorkspace).getByRole('heading', { name: 'Goods receipt register' }),
    ).toBeTruthy();
    expect(within(goodsReceiptWorkspace).getByText(/DEL-2026-42/u)).toBeTruthy();

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
              grossTotal: '96.0000',
              id: '592fd12f-f1d0-4c78-8e8f-9a2d2af7a34c',
              lineTotal: '80.0000',
              netTotal: '80.0000',
              orderLineId,
              productId: inventoryProductFixture.id,
              productName: inventoryProductFixture.name,
              quantity: '2.0000',
              taxBreakdownRecorded: true,
              unitPrice: '40.0000',
              vatAmount: '16.0000',
              vatRate: '20.0000',
              vatTreatment: 'standard_20',
            },
          ],
          netTotal: '80.0000',
          purchaseOrderId: orderId,
          recordedAt: '2026-08-11T13:05:00.000Z',
          supplierName: supplier.profile.supplierName,
          supplierPartnerId: supplierId,
          taxBreakdownComplete: true,
          total: '96.0000',
          vatTotal: '16.0000',
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
    const supplierWorkspace = screen.getByRole('region', { name: 'Suppliers workspace' });
    expect(supplierWorkspace.classList.contains('procurement-tab-surface')).toBe(true);
    expect(
      within(supplierWorkspace).getByRole('heading', { name: 'Supplier register' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to Procurement' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Preview supplier' }));
    const supplierDialog = await screen.findByRole('dialog', {
      name: supplier.profile.supplierName,
    });
    expect(
      within(supplierDialog).getByRole('button', { name: 'Back to procurement list' }),
    ).toBeTruthy();
    expect(within(supplierDialog).queryByLabelText('Overall score')).toBeNull();
    fireEvent.click(within(supplierDialog).getByRole('button', { name: 'Add evaluation' }));
    expect(within(supplierDialog).getByLabelText('Overall score')).toBeTruthy();
    fireEvent.click(within(supplierDialog).getByRole('button', { name: 'Cancel' }));
    expect(within(supplierDialog).queryByLabelText('Overall score')).toBeNull();
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
          url.endsWith('/procurement/supplier-invoices') &&
          options?.method === 'POST' &&
          typeof options.body === 'string' &&
          options.body.includes('"vatTreatment":"standard_20"'),
      ),
    ).toBe(true);
  });

  it('reviews Finance aging and partner turnover through visible navigation', async () => {
    const financeContext = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'view', module: 'erp.finance' },
        { action: 'create', module: 'erp.finance' },
      ],
    };
    storeAuthenticatedSession(financeContext);
    const receivableReport: FinanceAgingReport = {
      asOf: '2026-08-21',
      items: [
        {
          bucket: 'days_0_30',
          daysOverdue: 12,
          documentDate: '2026-07-25',
          dueDate: '2026-08-09',
          id: '0cedf0aa-52de-4d51-9685-ff8d52aeb004',
          number: 'FIN-REV-2026-000014',
          originalBgnTotal: '180.0000',
          outstandingBgnTotal: '140.0000',
          partnerId: '621806be-070c-4cf8-84cc-c1585dad9d3b',
          partnerName: 'Alfa Market Ltd.',
          paymentStatus: 'overdue',
          sourceNumber: 'INV-DRAFT-2026-000014',
        },
      ],
      kind: 'receivable',
      page: 1,
      pageSize: 50,
      totalItems: 1,
      totalPages: 1,
      totals: {
        current: '0.0000',
        days0To30: '140.0000',
        days31To60: '0.0000',
        days61To90: '0.0000',
        over90: '0.0000',
        total: '140.0000',
      },
    };
    const payableReport: FinanceAgingReport = {
      ...receivableReport,
      items: [
        {
          ...receivableReport.items[0]!,
          bucket: 'current',
          daysOverdue: 0,
          id: '7f107f45-14f9-4bb1-a39c-3c0ed3df049f',
          number: 'PAY-2026-000009',
          outstandingBgnTotal: '75.0000',
          partnerId: '54d6b7b1-330e-494f-85c4-2b781755aefd',
          partnerName: 'TechSupply Ltd.',
          paymentStatus: 'partially_paid',
          sourceNumber: 'TS-1094',
        },
      ],
      kind: 'payable',
      totals: {
        current: '75.0000',
        days0To30: '0.0000',
        days31To60: '0.0000',
        days61To90: '0.0000',
        over90: '0.0000',
        total: '75.0000',
      },
    };
    const customerTurnover: FinanceTurnoverReport = {
      dateFrom: '2026-08-01',
      dateTo: '2026-08-21',
      items: [
        {
          allocatedBgnTotal: '40.0000',
          documentCount: 2,
          grossBgnTotal: '240.0000',
          outstandingBgnTotal: '200.0000',
          partnerId: receivableReport.items[0]!.partnerId,
          partnerName: 'Alfa Market Ltd.',
        },
      ],
      kind: 'customer',
      page: 1,
      pageSize: 50,
      totalItems: 1,
      totalPages: 1,
      totals: {
        allocatedBgnTotal: '40.0000',
        documentCount: 2,
        grossBgnTotal: '240.0000',
        outstandingBgnTotal: '200.0000',
      },
    };
    const supplierTurnover: FinanceTurnoverReport = {
      ...customerTurnover,
      items: [
        {
          allocatedBgnTotal: '25.0000',
          documentCount: 1,
          grossBgnTotal: '100.0000',
          outstandingBgnTotal: '75.0000',
          partnerId: payableReport.items[0]!.partnerId,
          partnerName: 'TechSupply Ltd.',
        },
      ],
      kind: 'supplier',
      totals: {
        allocatedBgnTotal: '25.0000',
        documentCount: 1,
        grossBgnTotal: '100.0000',
        outstandingBgnTotal: '75.0000',
      },
    };
    const salesJournal: FinanceJournalReport = {
      dateFrom: '2026-08-01',
      dateTo: '2026-08-21',
      items: [
        {
          currencyCode: 'BGN',
          documentDate: '2026-08-18',
          documentType: 'invoice',
          exchangeRate: '1.00000000',
          grossBgnTotal: '240.0000',
          id: '4a3dd890-b862-45cc-b94d-b96e584186bf',
          netBgnTotal: '200.0000',
          number: 'DINV-VR-2026-000014',
          partnerName: 'Alfa Market Ltd.',
          partnerVatNumber: 'BG204000001',
          sourceNumber: 'DEV-INV-DRAFT-0001',
          status: 'draft',
          taxBreakdownComplete: true,
          taxEventDate: '2026-08-18',
          vatBgnTotal: '40.0000',
        },
      ],
      kind: 'sales',
      page: 1,
      pageSize: 50,
      totalItems: 1,
      totalPages: 1,
      totals: {
        documentCount: 1,
        grossBgnTotal: '240.0000',
        incompleteTaxDocuments: 0,
        netBgnTotal: '200.0000',
        vatBgnTotal: '40.0000',
      },
    };
    const purchaseJournal: FinanceJournalReport = {
      ...salesJournal,
      items: [
        {
          currencyCode: 'BGN',
          documentDate: '2026-08-19',
          documentType: 'supplier_invoice',
          exchangeRate: '1.00000000',
          grossBgnTotal: '120.0000',
          id: 'bc863e98-b977-421d-a426-eb74a7454d69',
          netBgnTotal: '100.0000',
          number: 'SUP-2026-101',
          partnerName: 'TechSupply Ltd.',
          partnerVatNumber: 'BG205000002',
          status: 'recorded',
          taxBreakdownComplete: true,
          taxEventDate: '2026-08-19',
          vatBgnTotal: '20.0000',
        },
      ],
      kind: 'purchase',
      totals: {
        documentCount: 1,
        grossBgnTotal: '120.0000',
        incompleteTaxDocuments: 0,
        netBgnTotal: '100.0000',
        vatBgnTotal: '20.0000',
      },
    };
    const vatReview: FinanceVatReviewReport = {
      dateFrom: '2026-08-01',
      dateTo: '2026-08-21',
      incompletePurchaseDocumentNumbers: [],
      incompletePurchaseDocuments: 0,
      items: [
        {
          direction: 'output',
          documentCount: 1,
          netBgnTotal: '200.0000',
          vatBgnTotal: '40.0000',
          vatRate: '20.0000',
          vatTreatment: 'standard_20',
        },
        {
          direction: 'input',
          documentCount: 1,
          netBgnTotal: '100.0000',
          vatBgnTotal: '20.0000',
          vatRate: '20.0000',
          vatTreatment: 'standard_20',
        },
      ],
      recordedDifferenceBgn: '20.0000',
      recordedInputVatBgn: '20.0000',
      recordedOutputVatBgn: '40.0000',
    };
    const definitions: FinanceReportDefinition[] = [
      {
        description: 'Open customer balances grouped by due-date age.',
        formats: ['csv', 'xlsx', 'pdf'],
        key: 'finance.receivables-aging',
        name: 'Customer receivables',
        requiresDateRange: false,
      },
      {
        description: 'Open supplier balances grouped by due-date age.',
        formats: ['csv', 'xlsx', 'pdf'],
        key: 'finance.supplier-payables-aging',
        name: 'Supplier payables',
        requiresDateRange: false,
      },
      {
        description: 'Customer document turnover for a selected period.',
        formats: ['csv', 'xlsx', 'pdf'],
        key: 'finance.customer-turnover',
        name: 'Customer turnover',
        requiresDateRange: true,
      },
      {
        description: 'Supplier document turnover for a selected period.',
        columns: [
          { key: 'partnerName', label: 'Partner', type: 'text' },
          { key: 'grossBgnTotal', label: 'Gross BGN', type: 'money' },
          { key: 'outstandingBgnTotal', label: 'Outstanding BGN', type: 'money' },
        ],
        formats: ['csv', 'xlsx', 'pdf'],
        key: 'finance.supplier-turnover',
        name: 'Supplier turnover',
        requiresDateRange: true,
      },
      {
        description: 'Recorded Sales document tax values for a selected period.',
        formats: ['csv', 'xlsx', 'pdf'],
        key: 'finance.sales-journal',
        name: 'Sales journal review',
        requiresDateRange: true,
      },
      {
        description: 'Recorded supplier invoice tax values for a selected period.',
        formats: ['csv', 'xlsx', 'pdf'],
        key: 'finance.purchase-journal',
        name: 'Purchase journal review',
        requiresDateRange: true,
      },
      {
        description: 'Recorded output and input VAT for a selected period.',
        formats: ['csv', 'xlsx', 'pdf'],
        key: 'finance.vat-review',
        name: 'VAT review',
        requiresDateRange: true,
      },
    ];
    const completedExport: FinanceReportExport = {
      attemptCount: 1,
      completedAt: '2026-08-21T12:05:00.000Z',
      createdAt: '2026-08-21T12:04:00.000Z',
      definitionKey: 'finance.supplier-turnover',
      fileName: 'supplier-turnover-2026-08-21.xlsx',
      format: 'xlsx',
      id: '1c11fa55-9d40-4289-9f89-40517a63cbb8',
      name: 'Supplier turnover',
      rowCount: 1,
      sizeBytes: 8124,
      status: 'completed',
    };
    let exportRequested = false;
    const savedReports: SavedFinanceReport[] = [];
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(financeContext));
      if (input.includes('/finance/saved-reports?'))
        return Promise.resolve(
          jsonResponse({ items: savedReports, total: savedReports.length, page: 1, totalPages: 1 }),
        );
      if (input.endsWith('/finance/saved-reports') && options?.method === 'POST') {
        const saved = JSON.parse(options.body as string) as SavedFinanceReport;
        savedReports.push(saved);
        return Promise.resolve(jsonResponse(saved, 201));
      }
      if (input.endsWith('/finance/report-exports/definitions'))
        return Promise.resolve(jsonResponse(definitions));
      if (input.includes('/finance/report-exports?'))
        return Promise.resolve(
          jsonResponse({
            items: exportRequested ? [completedExport] : [],
            page: 1,
            pageSize: 20,
            total: exportRequested ? 1 : 0,
            totalPages: exportRequested ? 1 : 0,
          }),
        );
      if (input.endsWith('/finance/report-exports') && options?.method === 'POST') {
        exportRequested = true;
        return Promise.resolve(
          jsonResponse({ ...completedExport, completedAt: undefined, status: 'queued' }, 202),
        );
      }
      if (input.includes('/finance/reports/aging?'))
        return Promise.resolve(
          jsonResponse(input.includes('kind=payable') ? payableReport : receivableReport),
        );
      if (input.includes('/finance/reports/turnover?'))
        return Promise.resolve(
          jsonResponse(input.includes('kind=supplier') ? supplierTurnover : customerTurnover),
        );
      if (input.includes('/finance/reports/journal?'))
        return Promise.resolve(
          jsonResponse(input.includes('kind=purchase') ? purchaseJournal : salesJournal),
        );
      if (input.includes('/finance/reports/vat-review?'))
        return Promise.resolve(jsonResponse(vatReview));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/erp.finance']);
    expect(await screen.findByRole('heading', { name: 'Finance' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: /Finance reports Review balances/u }));

    expect(await screen.findByRole('heading', { name: 'Finance reports' })).toBeTruthy();
    expect(await screen.findByText('Alfa Market Ltd.')).toBeTruthy();
    expect(screen.getByText('12 days overdue')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Payables' }));
    expect(await screen.findByText('TechSupply Ltd.')).toBeTruthy();
    expect(screen.getByText('Not overdue')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Turnover by partner' }));
    expect(await screen.findByText('Alfa Market Ltd.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Suppliers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('TechSupply Ltd.')).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([url]) => url.includes('/finance/reports/turnover?dateFrom=')),
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Export report' }));
    const exportDialog = await screen.findByRole('dialog', { name: 'Export report' });
    expect(within(exportDialog).getByLabelText<HTMLSelectElement>('Report').value).toBe(
      'finance.supplier-turnover',
    );
    fireEvent.click(await within(exportDialog).findByRole('checkbox', { name: 'Outstanding BGN' }));
    fireEvent.change(within(exportDialog).getByLabelText('Save these options'), {
      target: { value: 'Supplier totals' },
    });
    fireEvent.click(within(exportDialog).getByRole('button', { name: 'Save as new report' }));
    expect(
      await within(exportDialog).findByRole('option', { name: 'Supplier totals' }),
    ).toBeTruthy();
    expect(savedReports[0]?.columns).toEqual(['partnerName', 'grossBgnTotal']);
    fireEvent.click(within(exportDialog).getByRole('button', { name: 'Prepare export' }));
    expect(await within(exportDialog).findByText('Ready')).toBeTruthy();
    expect(within(exportDialog).getAllByText('Supplier turnover').length).toBeGreaterThan(1);
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) =>
          url.endsWith('/finance/report-exports') &&
          options?.method === 'POST' &&
          typeof options.body === 'string' &&
          options.body.includes('finance.supplier-turnover'),
      ),
    ).toBe(true);

    fireEvent.click(within(exportDialog).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export report' }));
    const reopened = await screen.findByRole('dialog', { name: 'Export report' });
    await within(reopened).findByRole('option', { name: 'Supplier totals' });
    fireEvent.change(within(reopened).getByLabelText('My saved reports'), {
      target: { value: savedReports[0]!.id },
    });
    expect(
      within(reopened).getByRole<HTMLInputElement>('checkbox', { name: 'Outstanding BGN' }).checked,
    ).toBe(false);
    fireEvent.click(within(reopened).getByRole('checkbox', { name: 'Partner' }));
    fireEvent.click(within(reopened).getByRole('checkbox', { name: 'Gross BGN' }));
    expect(
      within(reopened).getByRole<HTMLButtonElement>('button', { name: 'Prepare export' }).disabled,
    ).toBe(true);
    fireEvent.click(within(reopened).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Document journals' }));
    expect(await screen.findByText('DINV-VR-2026-000014')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Purchases' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('SUP-2026-101')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'VAT review' }));
    expect(await screen.findByRole('heading', { name: 'Output VAT from sales' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Recorded input VAT from purchases' })).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([url]) => url.includes('/finance/reports/vat-review?dateFrom=')),
    ).toBe(true);
  });

  it('moves through the connected sales workflow using visible navigation and preview actions', async () => {
    const salesContext = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'view', module: 'erp.sales' },
        { action: 'create', module: 'erp.sales' },
        { action: 'edit', module: 'erp.sales' },
      ],
    };
    storeAuthenticatedSession(salesContext);
    const customerId = 'a4eaf510-58f1-49c2-90cc-ce61c102352c';
    const productId = '773e9308-d4d8-43d7-9cf0-9dc20f2de1dc';
    const customerLocationId = '54c81e2d-a18b-4fc4-b444-a4459ca40a5b';
    const warehouseId = '5c8c6996-585c-4375-a239-1c5be14b88f0';
    let workflow: SalesWorkflow | undefined;
    const references = {
      batches: [],
      customers: [{ id: customerId, name: 'Vista Retail Customer Ltd.' }],
      customerLocations: [
        { customerPartnerId: customerId, id: customerLocationId, name: 'Main retail site' },
      ],
      products: [
        {
          id: productId,
          name: 'Demo Fiscal Register X1',
          productCode: 'FISCAL-X1',
          trackingMode: 'serial',
        },
      ],
      serials: [
        { productId, serialNumber: 'DEMO-FR-001', warehouseId },
        { productId, serialNumber: 'DEMO-FR-002', warehouseId },
        { productId, serialNumber: 'DEMO-FR-003', warehouseId },
      ],
      warehouses: [{ id: warehouseId, name: 'Central warehouse' }],
    };
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(salesContext));
      if (input.endsWith('/sales/reference-data')) return Promise.resolve(jsonResponse(references));
      if (input.endsWith('/sales/workflows'))
        return Promise.resolve(jsonResponse(workflow ? [workflow] : []));
      if (input.includes('/sales/prices/resolve?'))
        return Promise.resolve(
          jsonResponse({
            asOf: '2026-08-12',
            currencyCode: 'BGN',
            matched: true,
            priceListCode: 'TRADE',
            priceListId: '5860227a-84d3-4a64-bfd0-99cb9faf2e53',
            priceListName: 'Trade customers',
            priority: 10,
            productId,
            unitPrice: '38.0000',
          }),
        );
      if (input.endsWith('/sales/quotations') && options?.method === 'POST') {
        workflow = {
          createdAt: '2026-08-12T08:00:00.000Z',
          currencyCode: 'BGN',
          customerName: references.customers[0]!.name,
          customerPartnerId: customerId,
          id: '8ea0d4c4-0493-41b8-a224-f8466a05a578',
          lines: [
            {
              discountPercent: '0.0000',
              id: 'c4a3ca8d-0a5b-42b6-8518-76f3b627334f',
              lineTotal: '80.0000',
              productId,
              productName: references.products[0]!.name,
              quantity: '2.0000',
              trackingMode: 'serial',
              unitPrice: '40.0000',
              vatTreatment: 'standard_20',
            },
          ],
          number: 'Q-2026-000001',
          overallDiscountPercent: '0.0000',
          status: 'draft',
          subtotal: '80.0000',
          total: '96.0000',
          validUntil: '2026-08-26',
          vatTotal: '16.0000',
          warehouseId,
          warehouseName: references.warehouses[0]!.name,
        };
        return Promise.resolve(jsonResponse(workflow, 201));
      }
      if (input.includes('/sales/quotations/') && input.endsWith('/confirm')) {
        workflow = {
          ...workflow!,
          order: {
            confirmedAt: '2026-08-12T08:05:00.000Z',
            id: 'fab8b01e-86da-4572-ab8b-c706325291c8',
            lines: [
              {
                id: 'ce678f02-1ed0-4cc0-83de-952c7b00af71',
                productId,
                productName: references.products[0]!.name,
                quantity: '2.0000',
                reservationId: 'f25f1bc6-d076-4cd8-804d-b4470ec98858',
                reservedSerialNumbers: ['DEMO-FR-002', 'DEMO-FR-003'],
                trackingMode: 'serial',
              },
            ],
            number: 'SO-2026-000001',
            status: 'confirmed',
          },
          status: 'confirmed',
        };
        return Promise.resolve(jsonResponse(workflow, 201));
      }
      if (input.includes('/sales/orders/') && input.endsWith('/shipments')) {
        workflow = {
          ...workflow!,
          handover: {
            id: 'a3c58bdd-f101-4545-9b2d-529dbcf1ade5',
            lines: [
              {
                id: 'f2f50cd1-8efe-467a-91aa-dca6473dc787',
                productId,
                productName: references.products[0]!.name,
                quantity: '2.0000',
                serialNumbers: ['DEMO-FR-002', 'DEMO-FR-003'],
              },
            ],
            number: 'HO-2026-000001',
            preparedAt: '2026-08-12T08:10:00.000Z',
            status: 'prepared',
            version: 1,
          },
          order: { ...workflow!.order!, status: 'shipped' },
          shipment: {
            id: 'b9364434-0b22-42cd-b85c-e444e90e5da4',
            lines: [],
            number: 'SH-2026-000001',
            shippedAt: '2026-08-12T08:10:00.000Z',
          },
          status: 'shipped',
        };
        return Promise.resolve(jsonResponse(workflow, 201));
      }
      if (input.includes('/sales/handover-certificates/') && input.endsWith('/accept')) {
        workflow = {
          ...workflow!,
          handover: {
            ...workflow!.handover!,
            acceptedAt: '2026-08-12T08:12:00.000Z',
            acceptedByName: 'Elena Customer',
            customerLocationId,
            customerLocationName: 'Main retail site',
            status: 'accepted',
            version: 2,
          },
        };
        return Promise.resolve(jsonResponse(workflow));
      }
      if (input.includes('/sales/orders/') && input.endsWith('/invoice-draft')) {
        workflow = {
          ...workflow!,
          invoice: {
            currencyCode: 'BGN',
            customerName: references.customers[0]!.name,
            customerPartnerId: customerId,
            id: '3b507b65-017f-4a10-a697-b2335af52acd',
            lines: [],
            number: 'INV-DRAFT-2026-000001',
            recordedAt: '2026-08-12T08:15:00.000Z',
            status: 'draft',
            subtotal: '80.0000',
            total: '96.0000',
            vatTotal: '16.0000',
          },
          order: { ...workflow!.order!, status: 'invoiced' },
          status: 'invoiced',
        };
        return Promise.resolve(jsonResponse(workflow, 201));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/erp.sales']);
    expect(await screen.findByRole('heading', { name: 'Sales' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: /Quotations Prepare time-bounded/u }));
    expect(await screen.findByRole('heading', { name: 'Sales workflow' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /New quotation/u }));
    const createDialog = await screen.findByRole('dialog', { name: 'New quotation' });
    expect(within(createDialog).getByLabelText<HTMLSelectElement>('Product').value).toBe('');
    fireEvent.change(within(createDialog).getByLabelText('Product'), {
      target: { value: productId },
    });
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Use customer price' }));
    expect(await within(createDialog).findByText(/Trade customers applied/u)).toBeTruthy();
    expect(within(createDialog).getByLabelText<HTMLInputElement>('Unit price (BGN)').value).toBe(
      '38.0000',
    );
    fireEvent.change(within(createDialog).getByLabelText('Unit price (BGN)'), {
      target: { value: '40' },
    });
    fireEvent.change(within(createDialog).getByLabelText('Quantity'), {
      target: { value: '2' },
    });
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Create quotation' }));
    expect(await screen.findByText('Q-2026-000001 was created.')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    let preview = await screen.findByRole('dialog', { name: 'Q-2026-000001' });
    const confirmButton = within(preview).getByRole<HTMLButtonElement>('button', {
      name: 'Confirm order and reserve stock',
    });
    expect(confirmButton.disabled).toBe(true);
    expect(within(preview).getByText('0 of 2 selected')).toBeTruthy();
    const serialSearch = within(preview).getByPlaceholderText('Search by serial number');
    fireEvent.change(serialSearch, { target: { value: '003' } });
    expect(within(preview).queryByRole('button', { name: 'DEMO-FR-001' })).toBeNull();
    expect(within(preview).getByRole('button', { name: 'DEMO-FR-003' })).toBeTruthy();
    fireEvent.change(serialSearch, { target: { value: '' } });
    fireEvent.click(within(preview).getByRole('button', { name: 'DEMO-FR-001' }));
    expect(confirmButton.disabled).toBe(true);
    fireEvent.click(within(preview).getByRole('button', { name: 'DEMO-FR-002' }));
    expect(confirmButton.disabled).toBe(false);
    expect(within(preview).getByText('2 of 2 selected')).toBeTruthy();
    expect(
      within(preview).getByRole<HTMLButtonElement>('button', { name: 'DEMO-FR-003' }).disabled,
    ).toBe(true);
    fireEvent.click(within(preview).getByRole('button', { name: 'DEMO-FR-001' }));
    fireEvent.click(within(preview).getByRole('button', { name: 'DEMO-FR-003' }));
    fireEvent.click(
      within(preview).getByRole('button', { name: 'Confirm order and reserve stock' }),
    );
    expect(await screen.findByText('Quotation confirmed and stock reserved.')).toBeTruthy();

    preview = await screen.findByRole('dialog', { name: 'Q-2026-000001' });
    fireEvent.click(within(preview).getByRole('button', { name: 'Complete shipment' }));
    expect(await screen.findByText('Shipment completed and reserved stock issued.')).toBeTruthy();

    preview = await screen.findByRole('dialog', { name: 'Q-2026-000001' });
    expect(within(preview).getAllByText('HO-2026-000001')).toHaveLength(2);
    fireEvent.change(within(preview).getByRole('combobox', { name: /^Receiving location/u }), {
      target: { value: customerLocationId },
    });
    fireEvent.change(within(preview).getByLabelText('Customer representative'), {
      target: { value: 'Elena Customer' },
    });
    fireEvent.click(within(preview).getByRole('button', { name: 'Record customer acceptance' }));
    expect(
      await screen.findByText('Customer acceptance recorded on the handover certificate.'),
    ).toBeTruthy();
    expect(await screen.findByText('Accepted by Elena Customer')).toBeTruthy();

    preview = await screen.findByRole('dialog', { name: 'Q-2026-000001' });
    fireEvent.click(within(preview).getByRole('button', { name: 'Prepare invoice draft' }));
    expect(await screen.findByText('Invoice draft prepared from the shipment.')).toBeTruthy();
    expect(await screen.findByText('Ready for final review and issuance in Finance.')).toBeTruthy();
    expect(within(preview).getByRole('button', { name: 'Back to sales list' })).toBeTruthy();
    fireEvent.click(within(preview).getByRole('button', { name: 'Back to sales list' }));
    fireEvent.click(screen.getByRole('link', { name: 'Back to Sales' }));
    expect(await screen.findByRole('heading', { name: 'Sales' })).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(
        ([url]) => url.includes('/sales/prices/resolve?asOf=') && url.includes('currencyCode=BGN'),
      ),
    ).toBe(true);
    const confirmationCall = fetchMock.mock.calls.find(
      ([url]) => url.includes('/sales/quotations/') && url.endsWith('/confirm'),
    );
    expect(JSON.parse((confirmationCall?.[1] as RequestInit).body as string)).toMatchObject({
      lines: [{ serialNumbers: ['DEMO-FR-002', 'DEMO-FR-003'] }],
    });
  });

  it('maintains customer groups, campaigns, and future prices through visible Sales navigation', async () => {
    const contextWithSalesPricing = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'view', module: 'erp.sales' },
        { action: 'create', module: 'erp.sales' },
        { action: 'edit', module: 'erp.sales' },
      ],
    };
    storeAuthenticatedSession(contextWithSalesPricing);
    const customerId = partner.id;
    const productId = '1dbe3fc0-4503-4e03-b11a-d33a35a3bcb1';
    const customerGroup = {
      active: true,
      code: 'TRADE',
      createdAt: '2026-08-12T08:00:00.000Z',
      customerPartnerIds: [customerId],
      id: '99bb298b-b3e4-480a-8d9f-c5cb1cb88d84',
      name: 'Trade customers',
      updatedAt: '2026-08-12T08:00:00.000Z',
      version: 1,
    };
    const campaign = {
      active: true,
      code: 'AUTUMN',
      createdAt: '2026-08-12T08:05:00.000Z',
      id: '46ad47b7-78c4-4dbc-b8c7-e2e4a5544f21',
      name: 'Autumn campaign',
      updatedAt: '2026-08-12T08:05:00.000Z',
      validFrom: '2026-08-01',
      validTo: '2026-10-31',
      version: 1,
    };
    const priceList = {
      active: true,
      campaign: { id: campaign.id, name: campaign.name },
      code: 'TRADE-AUTUMN',
      createdAt: '2026-08-12T08:10:00.000Z',
      currencyCode: 'BGN',
      customerGroup: { id: customerGroup.id, name: customerGroup.name },
      id: '2fc80532-0ec0-4f87-a8f3-8efcb60fb95d',
      lines: [
        {
          id: '97a96090-4bc6-4ffc-9e75-3ef05352a026',
          productCode: 'ROLL-01',
          productId,
          productName: 'Receipt rolls',
          unitPrice: '24.0000',
        },
      ],
      name: 'Trade autumn prices',
      priority: 20,
      scope: 'customer_group',
      updatedAt: '2026-08-12T08:10:00.000Z',
      validFrom: '2026-08-01',
      validTo: '2026-10-31',
      version: 1,
    };
    const posOffer = {
      active: true,
      code: 'ROLL-BOX',
      createdAt: '2026-08-12T08:15:00.000Z',
      discountType: 'percentage',
      discountValue: '10.0000',
      id: '0bcafae7-6302-48e3-93c2-bae97826ce2b',
      items: [
        {
          productCode: 'ROLL-01',
          productId,
          productName: 'Receipt rolls',
          requiredQuantity: '10.0000',
        },
      ],
      name: 'Receipt roll box',
      priority: 20,
      ruleType: 'quantity',
      updatedAt: '2026-08-12T08:15:00.000Z',
      validFrom: '2026-08-01',
      validTo: '2026-10-31',
      version: 1,
    };
    let references = {
      campaigns: [] as (typeof campaign)[],
      customerGroups: [] as (typeof customerGroup)[],
      customers: [{ id: customerId, name: partner.displayName }],
      products: [{ id: productId, name: 'Receipt rolls', productCode: 'ROLL-01' }],
    };
    let priceLists: (typeof priceList)[] = [];
    let posOffers: (typeof posOffer)[] = [];
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(contextWithSalesPricing));
      if (input.endsWith('/sales/pricing/reference-data'))
        return Promise.resolve(jsonResponse(references));
      if (input.endsWith('/sales/price-lists') && (!options?.method || options.method === 'GET'))
        return Promise.resolve(jsonResponse(priceLists));
      if (
        input.endsWith('/sales/pos-commercial-rules') &&
        (!options?.method || options.method === 'GET')
      )
        return Promise.resolve(jsonResponse(posOffers));
      if (input.endsWith('/sales/customer-groups') && options?.method === 'POST') {
        references = { ...references, customerGroups: [customerGroup] };
        return Promise.resolve(jsonResponse(customerGroup, 201));
      }
      if (input.endsWith('/sales/promotional-campaigns') && options?.method === 'POST') {
        references = { ...references, campaigns: [campaign] };
        return Promise.resolve(jsonResponse(campaign, 201));
      }
      if (input.endsWith('/sales/price-lists') && options?.method === 'POST') {
        priceLists = [priceList];
        return Promise.resolve(jsonResponse(priceList, 201));
      }
      if (input.endsWith('/sales/pos-commercial-rules') && options?.method === 'POST') {
        posOffers = [posOffer];
        return Promise.resolve(jsonResponse(posOffer, 201));
      }
      if (input.includes('/sales/prices/resolve?')) {
        return Promise.resolve(
          jsonResponse({
            asOf: '2026-08-12',
            currencyCode: 'BGN',
            matched: true,
            priceListCode: priceList.code,
            priceListId: priceList.id,
            priceListName: priceList.name,
            priority: priceList.priority,
            productId,
            unitPrice: '24.0000',
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/erp.sales']);
    expect(await screen.findByRole('heading', { name: 'Sales' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: /Prices & promotions Maintain customer/u }));
    expect(await screen.findByRole('heading', { name: 'Prices & promotions' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Customer groups' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add customer group' }));
    let dialog = screen.getByRole('dialog', { name: 'Create customer group' });
    fireEvent.change(within(dialog).getByLabelText('Code'), { target: { value: 'TRADE' } });
    fireEvent.change(within(dialog).getByLabelText('Customer group name'), {
      target: { value: 'Trade customers' },
    });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: partner.displayName }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create customer group' }));
    expect(await screen.findByText('Trade customers')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Campaigns' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add campaign' }));
    dialog = screen.getByRole('dialog', { name: 'Create campaign' });
    fireEvent.change(within(dialog).getByLabelText('Code'), { target: { value: 'AUTUMN' } });
    fireEvent.change(within(dialog).getByLabelText('Campaign name'), {
      target: { value: 'Autumn campaign' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create campaign' }));
    expect(await screen.findByText('Autumn campaign')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Price lists' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add price list' }));
    dialog = screen.getByRole('dialog', { name: 'Create price list' });
    fireEvent.change(within(dialog).getByLabelText('Code'), {
      target: { value: 'TRADE-AUTUMN' },
    });
    fireEvent.change(within(dialog).getByLabelText('Price-list name'), {
      target: { value: 'Trade autumn prices' },
    });
    fireEvent.change(within(dialog).getByLabelText('Applies to'), {
      target: { value: 'customer_group' },
    });
    fireEvent.change(within(dialog).getByLabelText('Customer group'), {
      target: { value: customerGroup.id },
    });
    fireEvent.change(within(dialog).getByLabelText('Campaign'), {
      target: { value: campaign.id },
    });
    fireEvent.change(within(dialog).getByLabelText(/^Priority/u), { target: { value: '20' } });
    fireEvent.change(within(dialog).getByLabelText('Unit price 1'), {
      target: { value: '24' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create price list' }));
    expect(await screen.findByText('Trade autumn prices')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Check price' }));
    expect(await screen.findByText(/24\.00/u)).toBeTruthy();
    expect(screen.getByText(/Trade autumn prices · TRADE-AUTUMN/u)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/sales/prices/resolve?'))).toBe(true);

    fireEvent.click(screen.getByRole('tab', { name: 'POS offers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add POS offer' }));
    dialog = screen.getByRole('dialog', { name: 'Create POS offer' });
    fireEvent.change(within(dialog).getByLabelText('Offer code'), {
      target: { value: 'ROLL-BOX' },
    });
    fireEvent.change(within(dialog).getByLabelText('Offer name'), {
      target: { value: 'Receipt roll box' },
    });
    fireEvent.change(within(dialog).getByLabelText('Minimum quantity 1'), {
      target: { value: '10' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create POS offer' }));
    expect(await screen.findByText('Receipt roll box')).toBeTruthy();
    expect(screen.getByText('10.00% off')).toBeTruthy();
  });

  it('creates and previews a service subscription through the Sales workspace', async () => {
    const subscriptionsContext = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'view', module: 'erp.sales' },
        { action: 'create', module: 'erp.sales' },
        { action: 'edit', module: 'erp.sales' },
      ],
    };
    storeAuthenticatedSession(subscriptionsContext);
    const customerId = '87606589-7be1-4ddd-8905-b470ace8f480';
    const locationId = '9ab0258d-6b8a-4b18-917c-799b983a1391';
    const equipmentId = '868eb1fd-65c4-4bef-a8f9-e68a774ccdf4';
    const references = {
      customers: [{ id: customerId, name: 'Mountain Retail Ltd.' }],
      equipment: [
        {
          customerLocationId: locationId,
          deviceName: 'Fiscal register FX-20',
          id: equipmentId,
          serialNumber: 'FX20-00918',
        },
      ],
      locations: [{ customerPartnerId: customerId, id: locationId, name: 'Vratsa retail outlet' }],
    };
    let contracts: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(subscriptionsContext));
      if (input.endsWith('/sales/subscriptions/reference-data'))
        return Promise.resolve(jsonResponse(references));
      if (input.endsWith('/sales/subscriptions') && (!options?.method || options.method === 'GET'))
        return Promise.resolve(jsonResponse(contracts));
      if (input.endsWith('/sales/subscriptions') && options?.method === 'POST') {
        if (typeof options.body !== 'string') throw new Error('Expected a JSON request body');
        const submitted = JSON.parse(options.body) as Record<string, unknown>;
        const contract = {
          ...submitted,
          active: true,
          billingAmount: '120.0000',
          createdAt: '2026-08-12T09:00:00.000Z',
          customerLocationName: 'Vratsa retail outlet',
          customerName: 'Mountain Retail Ltd.',
          equipment: [
            {
              deviceName: 'Fiscal register FX-20',
              id: equipmentId,
              serialNumber: 'FX20-00918',
            },
          ],
          id: 'e071ce6e-ae8d-4cea-bca6-56ed215e6ff4',
          invoiceDrafts: [],
          number: 'SC-2026-000001',
          updatedAt: '2026-08-12T09:00:00.000Z',
          version: 1,
        };
        contracts = [contract];
        return Promise.resolve(jsonResponse(contract, 201));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/erp.sales']);
    expect(await screen.findByRole('heading', { name: 'Sales' })).toBeTruthy();
    fireEvent.click(
      screen.getByRole('link', { name: /Service subscriptions Manage customer-location/u }),
    );
    expect(await screen.findByRole('heading', { name: 'Service subscriptions' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to Sales' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'New contract' }));
    const dialog = await screen.findByRole('dialog', { name: 'New service contract' });
    expect(within(dialog).getByText('Fiscal register FX-20')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Recurring amount'), {
      target: { value: '120' },
    });
    fireEvent.change(within(dialog).getByLabelText('Included services'), {
      target: { value: 'Preventive maintenance\nRemote support' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create contract' }));

    expect(await screen.findByText('SC-2026-000001 was created.')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    const preview = await screen.findByRole('dialog', { name: 'SC-2026-000001' });
    expect(within(preview).getByText('Vratsa retail outlet')).toBeTruthy();
    expect(within(preview).getByText('Serial FX20-00918')).toBeTruthy();
    expect(within(preview).getByText('Preventive maintenance')).toBeTruthy();
    expect(
      within(preview).getByRole('button', { name: 'Back to service subscriptions' }),
    ).toBeTruthy();
  });

  it('adds a sales invoice draft to collections and records a customer payment through Finance navigation', async () => {
    const financeContext = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'view', module: 'erp.finance' },
        { action: 'create', module: 'erp.finance' },
        { action: 'edit', module: 'erp.finance' },
      ],
    };
    storeAuthenticatedSession(financeContext);
    const invoiceDraft = {
      currencyCode: 'BGN',
      customerName: 'River Market Ltd.',
      customerPartnerId: '2f1ac8d4-83ac-48d7-aa0e-57ce1f34dd83',
      id: '7ad369bc-3ad2-4b49-99bf-dab68f7f4b4f',
      number: 'INV-DRAFT-2026-000014',
      recordedAt: '2026-08-14T09:00:00.000Z',
      total: '273.6000',
    };
    let documents: Array<Record<string, unknown>> = [];
    const documentFor = (allocatedTotal: string, paymentStatus: string, payments: unknown[]) => ({
      allocatedTotal,
      bgnTotal: '273.6000',
      createdAt: '2026-08-14T09:05:00.000Z',
      currencyCode: 'BGN',
      customerName: invoiceDraft.customerName,
      customerPartnerId: invoiceDraft.customerPartnerId,
      documentDate: '2026-08-14',
      dueDate: '2026-08-28',
      exchangeRate: '1.00000000',
      id: '95eb49d0-a4f4-4187-a2d4-d608cef393d5',
      number: 'FIN-REV-2026-000001',
      outstandingTotal: allocatedTotal === '0.0000' ? '273.6000' : '148.6000',
      paymentStatus,
      payments,
      rateDate: '2026-08-14',
      rateSource: 'internal_bgn_review',
      reviewState: 'pending_finance_review',
      sourceInvoiceNumber: invoiceDraft.number,
      sourceSalesInvoiceId: invoiceDraft.id,
      statusHistory: [
        {
          changedAt: '2026-08-14T09:05:00.000Z',
          id: 'ba6757d3-7d58-4d09-a1af-2a14a59d0d0a',
          nextStatus: paymentStatus,
          reason: allocatedTotal === '0.0000' ? 'document_imported' : 'payment_recorded',
        },
      ],
      total: '273.6000',
      version: allocatedTotal === '0.0000' ? 1 : 2,
    });
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(financeContext));
      if (input.endsWith('/finance/reference-data'))
        return Promise.resolve(
          jsonResponse({ invoiceDrafts: documents.length ? [] : [invoiceDraft] }),
        );
      if (input.endsWith('/finance/summary'))
        return Promise.resolve(
          jsonResponse({
            activeDocuments: documents.length,
            overdueOutstanding: '0.0000',
            paidDocuments: 0,
            totalOutstanding: documents.length ? '273.6000' : '0.0000',
          }),
        );
      if (input.endsWith('/finance/documents') && (!options?.method || options.method === 'GET'))
        return Promise.resolve(jsonResponse(documents));
      if (input.endsWith('/finance/documents') && options?.method === 'POST') {
        documents = [documentFor('0.0000', 'unpaid', [])];
        return Promise.resolve(jsonResponse(documents[0], 201));
      }
      if (input.endsWith('/payments') && options?.method === 'POST') {
        documents = [
          documentFor('125.0000', 'partially_paid', [
            {
              allocatedAt: '2026-08-14T09:10:00.000Z',
              amount: '125.0000',
              id: '4f30bf42-b0ed-4dc6-ba7d-a8e00d935097',
              number: 'PAY-2026-000001',
              paymentDate: '2026-08-14',
              paymentMethod: 'bank_transfer',
              paymentReference: 'BANK-101',
              recordedAt: '2026-08-14T09:10:00.000Z',
            },
          ]),
        ];
        return Promise.resolve(jsonResponse(documents[0], 201));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/erp.finance']);
    expect(await screen.findByRole('heading', { name: 'Finance' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: /Collections & payments Track partial/u }));
    expect(await screen.findByRole('heading', { name: 'Collections & payments' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to Finance' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add to collections' }));
    let dialog = await screen.findByRole('dialog', { name: 'Add to collections' });
    expect(within(dialog).getByText(invoiceDraft.customerName)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add record' }));
    expect(await screen.findByText('FIN-REV-2026-000001 was added to collections.')).toBeTruthy();

    dialog = await screen.findByRole('dialog', { name: 'FIN-REV-2026-000001' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to finance list' }));
    const register = await screen.findByRole('region', { name: 'Customer collection register' });
    expect(within(register).getByText('FIN-REV-2026-000001')).toBeTruthy();
    expect(within(register).getByText(/0 payments/u)).toBeTruthy();
    fireEvent.click(within(register).getByRole('button', { name: 'Preview' }));
    dialog = await screen.findByRole('dialog', { name: 'FIN-REV-2026-000001' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    dialog = await screen.findByRole('dialog', { name: 'Record payment' });
    fireEvent.change(within(dialog).getByLabelText('Amount (BGN)'), { target: { value: '125' } });
    fireEvent.change(within(dialog).getByLabelText('Reference (optional)'), {
      target: { value: 'BANK-101' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    expect(
      await screen.findByText('FIN-REV-2026-000001 was updated with the payment.'),
    ).toBeTruthy();

    dialog = await screen.findByRole('dialog', { name: 'FIN-REV-2026-000001' });
    expect(within(dialog).getAllByText('Partially paid')).toHaveLength(2);
    expect(within(dialog).getByText('PAY-2026-000001')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to finance list' }));
    fireEvent.click(screen.getByRole('link', { name: 'Collections & payments' }));
    expect(await screen.findByRole('heading', { name: 'Collections & payments' })).toBeTruthy();
    expect(screen.getByText(/1 payment/u)).toBeTruthy();
  });

  it('manages customer credit terms and received advances from Finance', async () => {
    const financeContext = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'view', module: 'erp.finance' },
        { action: 'create', module: 'erp.finance' },
        { action: 'edit', module: 'erp.finance' },
      ],
    };
    storeAuthenticatedSession(financeContext);
    const customerId = 'de41d613-0df0-4455-b3ed-1282e8cb6658';
    const advanceId = '36955864-d3b0-4936-92a7-da716403cb75';
    let account: CustomerPaymentAccount = {
      advanceBalance: '80.0000',
      advances: [
        {
          amount: '80.0000',
          availableAmount: '80.0000',
          customerPartnerId: customerId,
          id: '03dbb5fa-13c2-494f-bd4f-34e9dd345538',
          number: 'DEV-ADV-ALFA-001',
          paymentMethod: 'bank_transfer',
          receivedOn: '2026-09-03',
        },
      ],
      availableCredit: '2000.0000',
      customerName: 'Alfa Market Demo Ltd.',
      customerPartnerId: customerId,
      entries: [],
      outstandingBalance: '0.0000',
      terms: {
        creditLimitBgn: '2000.0000',
        id: '4d263df9-af2a-4f30-9fd1-999325135f39',
        onAccountEnabled: true,
        paymentTermsDays: 14,
        status: 'active',
        validFrom: '2026-01-01',
        validTo: '2030-12-31',
        version: 1,
      },
      uic: '206666666',
    };
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(financeContext));
      if (input.endsWith('/finance/customer-accounts/reference-data'))
        return Promise.resolve(
          jsonResponse({
            customers: [{ id: customerId, name: account.customerName, uic: account.uic }],
          }),
        );
      if (
        input.endsWith('/finance/customer-accounts') &&
        (!options?.method || options.method === 'GET')
      )
        return Promise.resolve(jsonResponse([account]));
      if (input.endsWith(`/finance/customer-accounts/${customerId}/terms`)) {
        const body = JSON.parse(typeof options?.body === 'string' ? options.body : '') as {
          creditLimitBgn: string;
        };
        account = {
          ...account,
          availableCredit: Number(body.creditLimitBgn).toFixed(4),
          terms: {
            ...account.terms!,
            creditLimitBgn: Number(body.creditLimitBgn).toFixed(4),
            version: 2,
          },
        };
        return Promise.resolve(jsonResponse(account));
      }
      if (input.endsWith('/finance/customer-accounts/advances') && options?.method === 'POST') {
        const advance = {
          amount: '100.0000',
          availableAmount: '100.0000',
          customerPartnerId: customerId,
          id: advanceId,
          number: 'ADV-2026-000001',
          paymentMethod: 'bank_transfer' as const,
          paymentReference: 'TEST-ADV-0904',
          receivedOn: '2026-09-04',
        };
        account = {
          ...account,
          advanceBalance: '180.0000',
          advances: [...account.advances, advance],
        };
        return Promise.resolve(jsonResponse(advance, 201));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/erp.finance/customer-accounts']);
    expect(await screen.findByRole('heading', { name: 'Customer payment accounts' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    let dialog = await screen.findByRole('dialog', { name: 'Alfa Market Demo Ltd.' });
    expect(within(dialog).getByText('DEV-ADV-ALFA-001')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit terms' }));
    dialog = await screen.findByRole('dialog', { name: 'Set payment terms' });
    fireEvent.change(within(dialog).getByLabelText('Credit limit (BGN)'), {
      target: { value: '1500' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save payment terms' }));
    expect(
      await screen.findByText('Payment terms for Alfa Market Demo Ltd. were saved.'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Record advance' }));
    dialog = await screen.findByRole('dialog', { name: 'Record customer advance' });
    fireEvent.change(within(dialog).getByLabelText('Payment reference (optional)'), {
      target: { value: 'TEST-ADV-0904' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record advance' }));
    expect(await screen.findByText('ADV-2026-000001 was recorded.')).toBeTruthy();
  });

  it('moves a supplier invoice through payable, payment, advance allocation, and offset screens', async () => {
    const financeContext = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'view', module: 'erp.finance' },
        { action: 'create', module: 'erp.finance' },
        { action: 'edit', module: 'erp.finance' },
      ],
    };
    storeAuthenticatedSession(financeContext);
    const supplierId = 'd761e9db-721e-48a7-bca9-0a28e29161de';
    const supplierInvoiceId = '1956c116-32ad-4c92-a2c2-7de4e0732fee';
    const payableId = '888f4b93-7c3c-47b4-9b94-075ae83891a8';
    const receivableId = 'b17772ac-4e25-4ab2-81fa-c566bb01673b';
    const references = {
      businessDate: '2026-08-20',
      openReceivables: [
        {
          customerName: 'Dual-role Technical Supply Ltd.',
          customerPartnerId: supplierId,
          dueDate: '2026-09-03',
          id: receivableId,
          number: 'FIN-REV-2026-000041',
          outstandingTotal: '24.0000',
          sourceInvoiceNumber: 'INV-DRAFT-2026-000041',
          version: 1,
        },
      ],
      supplierInvoices: [
        {
          currencyCode: 'BGN',
          id: supplierInvoiceId,
          invoiceDate: '2026-08-18',
          invoiceNumber: 'SUP-2026-0042',
          paymentTermsDays: 14,
          suggestedDueDate: '2026-09-01',
          supplierName: 'Dual-role Technical Supply Ltd.',
          supplierPartnerId: supplierId,
          total: '80.0000',
        },
      ],
      suppliers: [{ id: supplierId, name: 'Dual-role Technical Supply Ltd.' }],
    };
    let payable: FinanceSupplierPayable | undefined;
    let advances: FinanceSupplierPayment[] = [];
    let offsets: FinanceSupplierOffset[] = [];

    const paymentFor = (
      overrides: Partial<FinanceSupplierPayment> = {},
    ): FinanceSupplierPayment => ({
      allocatedTotal: '20.0000',
      allocations: [
        {
          allocatedAt: '2026-08-20T10:05:00.000Z',
          amount: '20.0000',
          id: 'c726dd2c-ce40-4c41-a66f-eb84cc720c5d',
          payableNumber: 'SP-2026-000001',
          supplierPayableId: payableId,
        },
      ],
      amount: '20.0000',
      availableTotal: '0.0000',
      id: '73132729-d025-41c1-9536-84c92187ff0e',
      kind: 'payment',
      number: 'SPAY-2026-000001',
      paymentDate: '2026-08-20',
      paymentMethod: 'bank_transfer',
      paymentReference: 'SUP-2026-0042',
      recordedAt: '2026-08-20T10:05:00.000Z',
      supplierName: 'Dual-role Technical Supply Ltd.',
      supplierPartnerId: supplierId,
      version: 1,
      ...overrides,
    });
    const payableFor = (
      allocatedTotal: string,
      outstandingTotal: string,
      payments: FinanceSupplierPayment[],
      version: number,
    ): FinanceSupplierPayable => ({
      allocatedTotal,
      bgnTotal: '80.0000',
      createdAt: '2026-08-20T10:00:00.000Z',
      currencyCode: 'BGN',
      documentDate: '2026-08-18',
      dueDate: '2026-09-01',
      exchangeRate: '1.00000000',
      id: payableId,
      number: 'SP-2026-000001',
      outstandingTotal,
      paymentStatus: allocatedTotal === '0.0000' ? 'unpaid' : 'partially_paid',
      payments,
      rateDate: '2026-08-18',
      rateSource: 'internal_bgn_review',
      sourceSupplierInvoiceId: supplierInvoiceId,
      sourceSupplierInvoiceNumber: 'SUP-2026-0042',
      supplierName: 'Dual-role Technical Supply Ltd.',
      supplierPartnerId: supplierId,
      total: '80.0000',
      version,
    });
    const page = <T,>(items: T[]) => ({
      items,
      page: 1,
      pageSize: 25,
      totalItems: items.length,
      totalPages: 1,
    });

    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(financeContext));
      if (input.endsWith('/finance/supplier-reference-data'))
        return Promise.resolve(
          jsonResponse({
            ...references,
            supplierInvoices: payable ? [] : references.supplierInvoices,
          }),
        );
      if (input.endsWith('/finance/supplier-payables') && options?.method === 'POST') {
        payable = payableFor('0.0000', '80.0000', [], 1);
        return Promise.resolve(jsonResponse(payable, 201));
      }
      if (input.endsWith('/finance/supplier-payables'))
        return Promise.resolve(jsonResponse(page(payable ? [payable] : [])));
      if (input.endsWith(`/finance/supplier-payables/${payableId}/payments`)) {
        payable = payableFor('20.0000', '60.0000', [paymentFor()], 2);
        return Promise.resolve(jsonResponse(payable, 201));
      }
      if (input.endsWith(`/finance/supplier-payables/${payableId}`))
        return Promise.resolve(jsonResponse(payable));
      if (input.endsWith('/finance/supplier-advances') && options?.method === 'POST') {
        advances = [
          paymentFor({
            allocatedTotal: '0.0000',
            allocations: [],
            amount: '15.0000',
            availableTotal: '15.0000',
            id: '28b57f4b-d43a-47c7-bc99-90c90aad9fd5',
            kind: 'advance',
            number: 'SADV-2026-000001',
            paymentReference: 'ADV-2026-08',
          }),
        ];
        return Promise.resolve(jsonResponse(advances[0], 201));
      }
      if (input.endsWith('/finance/supplier-advances'))
        return Promise.resolve(jsonResponse(page(advances)));
      if (input.includes('/finance/supplier-advances/') && input.endsWith('/allocations')) {
        advances = [
          {
            ...advances[0]!,
            allocatedTotal: '15.0000',
            allocations: [
              {
                allocatedAt: '2026-08-20T10:10:00.000Z',
                amount: '15.0000',
                id: '1ce27336-43dc-4296-bbb6-4171989bfa4e',
                payableNumber: 'SP-2026-000001',
                supplierPayableId: payableId,
              },
            ],
            availableTotal: '0.0000',
            version: 2,
          },
        ];
        payable = payableFor('35.0000', '45.0000', [paymentFor(), advances[0]!], 3);
        return Promise.resolve(jsonResponse(advances[0]));
      }
      if (input.endsWith('/finance/supplier-offsets') && options?.method === 'POST') {
        offsets = [
          {
            amount: '10.0000',
            createdAt: '2026-08-20T10:15:00.000Z',
            customerDocumentId: receivableId,
            customerDocumentNumber: 'FIN-REV-2026-000041',
            id: 'c0dc3143-9926-4788-a54b-ddaf856349fb',
            number: 'OFF-2026-000001',
            offsetDate: '2026-08-20',
            partnerId: supplierId,
            partnerName: 'Dual-role Technical Supply Ltd.',
            reason: 'Mutual balance compensation',
            supplierPayableId: payableId,
            supplierPayableNumber: 'SP-2026-000001',
          },
        ];
        payable = payableFor('45.0000', '35.0000', payable?.payments ?? [], 4);
        return Promise.resolve(jsonResponse(offsets[0], 201));
      }
      if (input.endsWith('/finance/supplier-offsets'))
        return Promise.resolve(jsonResponse(page(offsets)));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/erp.finance']);
    expect(await screen.findByRole('heading', { name: 'Finance' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: /Supplier payables Track supplier/u }));
    expect(await screen.findByRole('heading', { name: 'Supplier payables' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add supplier invoice' }));
    let dialog = await screen.findByRole('dialog', { name: 'Add supplier invoice' });
    expect(within(dialog).getByLabelText<HTMLInputElement>('Due date').value).toBe('2026-09-01');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add payable' }));
    expect(await screen.findByText('SP-2026-000001 was added to supplier payables.')).toBeTruthy();

    dialog = await screen.findByRole('dialog', { name: 'SP-2026-000001' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    fireEvent.change(within(dialog).getByLabelText(/^Amount/u), { target: { value: '20' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByText('Payment applied to SP-2026-000001.')).toBeTruthy();
    expect(
      within(await screen.findByRole('dialog', { name: 'SP-2026-000001' })).getByText(
        'SPAY-2026-000001',
      ),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to supplier payables' }));

    fireEvent.click(screen.getByRole('button', { name: 'New advance' }));
    dialog = await screen.findByRole('dialog', { name: 'New supplier advance' });
    fireEvent.change(within(dialog).getByLabelText(/^Amount/u), { target: { value: '15' } });
    fireEvent.change(within(dialog).getByLabelText('Reference (optional)'), {
      target: { value: 'ADV-2026-08' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record advance' }));
    expect(
      await screen.findByText('SADV-2026-000001 was recorded as an available supplier advance.'),
    ).toBeTruthy();
    dialog = await screen.findByRole('dialog', { name: 'SADV-2026-000001' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply to payable' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply advance' }));
    expect(await screen.findByText('SADV-2026-000001 was allocated.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to supplier payables' }));

    fireEvent.click(await screen.findByRole('button', { name: /Payable register/u }));
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    dialog = await screen.findByRole('dialog', { name: 'SP-2026-000001' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create offset' }));
    dialog = await screen.findByRole('dialog', { name: 'New compensation offset' });
    fireEvent.change(within(dialog).getByLabelText('Offset amount'), {
      target: { value: '10' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create offset' }));
    expect(await screen.findByText('OFF-2026-000001 settled both partner balances.')).toBeTruthy();
  });

  it('prepares and reviews a structured financial document from a Sales draft', async () => {
    const financeContext = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'view', module: 'erp.finance' },
        { action: 'create', module: 'erp.finance' },
        { action: 'edit', module: 'erp.finance' },
      ],
    };
    storeAuthenticatedSession(financeContext);
    const customerId = 'a46f4919-aa4c-48bf-9a4d-52171402be3a';
    const productId = '820e681c-7f92-4c93-8b69-46eec9755140';
    const locationId = 'e4ac37f5-f248-43f9-89bd-075789c04867';
    const entityId = '3672be17-7f40-4181-96e2-b91c2f7508a5';
    const sourceId = '5adb13c9-fe79-451a-9ebd-0832b5fa63f1';
    const references = {
      businessTimezone: 'Europe/Sofia',
      correctionDocuments: [],
      customers: [{ id: customerId, name: 'River Market Ltd.', uic: '207000111' }],
      products: [
        {
          code: 'ROLL-80',
          id: productId,
          name: 'Receipt paper roll',
          unitCode: 'PCS',
          unitName: 'Pieces',
        },
      ],
      salesDrafts: [
        {
          currencyCode: 'BGN',
          customerName: 'River Market Ltd.',
          customerPartnerId: customerId,
          id: sourceId,
          linkedDocumentTypes: [],
          lines: [
            {
              description: 'Receipt paper roll',
              discountPercent: '0.0000',
              productId,
              quantity: '2.0000',
              unitCode: 'PCS',
              unitPrice: '50.0000',
              vatTreatment: 'standard_20',
            },
          ],
          number: 'INV-DRAFT-2026-000014',
          total: '120.0000',
        },
      ],
      serviceDrafts: [],
      scopes: [
        {
          branchId: '02bdb60e-8565-4725-896f-8c21cd7238ec',
          branchName: 'Vratsa Operations',
          cashRegisters: [],
          legalEntityId: entityId,
          legalEntityName: 'Vista Service Demo Ltd.',
          locationId,
          locationName: 'Vratsa Service Centre',
          operators: [],
        },
      ],
    };
    const document = {
      bgnGrossTotal: '120.0000',
      bgnNetTotal: '100.0000',
      bgnVatTotal: '20.0000',
      branchName: 'Vratsa Operations',
      businessLocationId: locationId,
      businessLocationName: 'Vratsa Service Centre',
      createdAt: '2026-08-19T08:00:00.000Z',
      currencyCode: 'BGN',
      customerPartnerId: customerId,
      customerSnapshot: {
        address: '1 Customer Street, Vratsa, BG',
        name: 'River Market Ltd.',
        uic: '207000111',
      },
      documentType: 'invoice',
      dueDate: '2026-09-02',
      exchangeRate: '1.00000000',
      grossTotal: '120.0000',
      id: 'af33b448-171a-4a18-8fdf-afb12968ee76',
      issueDate: '2026-08-19',
      issuerSnapshot: {
        address: '1 Service Street, Vratsa, BG',
        name: 'Vista Service Demo Ltd.',
        uic: '207000222',
      },
      legalEntityId: entityId,
      lines: [
        {
          description: 'Receipt paper roll',
          discountPercent: '0.0000',
          grossTotal: '120.0000',
          id: '3a12e929-a6f8-47c2-a0ec-f6d46a35ea20',
          lineNumber: 1,
          netTotal: '100.0000',
          productId,
          quantity: '2.0000',
          unitCode: 'PCS',
          unitPrice: '50.0000',
          vatAmount: '20.0000',
          vatRate: '20.0000',
          vatTreatment: 'standard_20',
        },
      ],
      netTotal: '100.0000',
      number: 'DINV-VRATSA-2026-000001',
      rateDate: '2026-08-19',
      rateSource: 'internal_bgn',
      sourceSalesInvoiceId: sourceId,
      sourceSalesInvoiceNumber: 'INV-DRAFT-2026-000014',
      status: 'draft',
      taxEventDate: '2026-08-19',
      vatSummary: [
        {
          netTotal: '100.0000',
          vatAmount: '20.0000',
          vatRate: '20.0000',
          vatTreatment: 'standard_20',
        },
      ],
      vatTotal: '20.0000',
      version: 1,
    };
    let documents: unknown[] = [];
    let attached = false;
    const attachment = {
      id: 'ace56756-038f-4f8a-8384-3bfba4785ca2',
      originalName: 'support.pdf',
      mediaType: 'application/pdf',
      byteSize: 100,
      createdAt: '2026-09-09T12:00:00Z',
      version: 1,
      versionCount: 1,
      status: 'available',
      isCurrent: true,
    };
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.includes('/files?'))
        return Promise.resolve(
          jsonResponse({
            items: attached ? [attachment] : [],
            page: 1,
            total: attached ? 1 : 0,
            totalPages: 1,
          }),
        );
      if (input.endsWith('/files') && options?.method === 'POST') {
        const body = options.body as FormData;
        expect(body.get('parentType')).toBe('financial_document');
        expect(body.get('parentId')).toBe(document.id);
        attached = true;
        return Promise.resolve(jsonResponse(attachment, 201));
      }
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(financeContext));
      if (input.endsWith('/finance/financial-documents/reference-data'))
        return Promise.resolve(jsonResponse(references));
      if (input.endsWith('/finance/financial-documents') && options?.method === 'POST') {
        documents = [document];
        return Promise.resolve(jsonResponse(document, 201));
      }
      if (input.endsWith('/finance/financial-documents'))
        return Promise.resolve(
          jsonResponse({
            items: documents,
            page: 1,
            pageSize: 25,
            totalItems: documents.length,
            totalPages: 1,
          }),
        );
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/erp.finance/invoices']);
    expect(await screen.findByRole('heading', { name: 'Financial documents' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New financial document' }));
    const dialog = await screen.findByRole('dialog', { name: 'New financial document' });
    expect(within(dialog).getByText('Receipt paper roll')).toBeTruthy();
    expect(within(dialog).getAllByText(/120\.00/u).length).toBeGreaterThan(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Prepare draft' }));

    expect(await screen.findByText('DINV-VRATSA-2026-000001 was prepared.')).toBeTruthy();
    const preview = await screen.findByRole('dialog', { name: 'DINV-VRATSA-2026-000001' });
    expect(within(preview).getByText('No official number allocated')).toBeTruthy();
    expect(within(preview).getByText('INV-DRAFT-2026-000014')).toBeTruthy();
    expect(within(preview).getByText('Standard 20% (20.0000%)')).toBeTruthy();
    expect(await within(preview).findByText('No attachments yet')).toBeTruthy();
    fireEvent.click(within(preview).getByRole('button', { name: 'Add attachment' }));
    fireEvent.change(within(preview).getByLabelText('Choose file'), {
      target: {
        files: [
          new File(['%PDF-1.4 supporting document'], 'support.pdf', { type: 'application/pdf' }),
        ],
      },
    });
    fireEvent.click(within(preview).getByRole('button', { name: 'Upload' }));
    expect(await within(preview).findByText('support.pdf')).toBeTruthy();
    expect(within(preview).getByRole('button', { name: 'Replace' })).toBeTruthy();
    expect(
      within(preview).getByRole('button', { name: 'Back to financial documents' }),
    ).toBeTruthy();
    cleanup();
    financeContext.permissions = financeContext.permissions.filter(
      (permission) => !(permission.module === 'erp.finance' && permission.action === 'edit'),
    );
    storeAuthenticatedSession(financeContext);
    renderApplication(['/modules/erp.finance/invoices']);
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    const readOnlyPreview = await screen.findByRole('dialog', { name: document.number });
    expect(await within(readOnlyPreview).findByText('support.pdf')).toBeTruthy();
    expect(within(readOnlyPreview).queryByRole('button', { name: 'Add attachment' })).toBeNull();
    expect(within(readOnlyPreview).queryByRole('button', { name: 'Replace' })).toBeNull();
  });

  it('hands completed Service charges to Finance and keeps the work order link visible', async () => {
    const context = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'view', module: 'erp.service' },
        { action: 'edit', module: 'erp.service' },
        { action: 'approve', module: 'erp.service' },
        { action: 'view', module: 'erp.finance' },
        { action: 'create', module: 'erp.finance' },
      ],
    };
    storeAuthenticatedSession(context);
    const customerId = '173bf6d2-ed2b-47b9-8622-40f37cce89a6';
    const workOrderId = '6ea32bc2-3df9-428e-8c0c-d16d5b1089c8';
    const locationId = 'ae8242a7-1744-4d0e-8ac1-32776f479672';
    const entityId = 'd3695a90-2eb1-45f3-ad1d-a129ec31d983';
    const workOrder = {
      assignedTechnician: {
        accountId: loginResponse.account.id,
        displayName: 'Mila Petrova',
        email: 'mila@example.invalid',
        warehouseId: '3d5c14c5-c927-4116-98bb-832013a72c6e',
        warehouseName: 'Technician van 1',
      },
      completedAt: '2026-08-24T12:00:00.000Z',
      completionNotes: 'Printer feed adjusted and final test passed.',
      createdAt: '2026-08-24T09:00:00.000Z',
      customerEquipmentId: 'b3d80ea3-3b8b-469d-9b9f-8d48494e9374',
      customerLocationId: 'f58ccfd8-054c-4563-ab90-af5ee609b489',
      customerLocationName: 'Vratsa retail outlet',
      customerName: 'River Market Ltd.',
      customerPartnerId: customerId,
      deviceName: 'Fiscal register FX-20',
      history: [
        {
          changedAt: '2026-08-24T12:00:00.000Z',
          id: 'b2951fd8-389a-46de-bc81-ad90d3758c2a',
          nextStatus: 'completed',
          previousStatus: 'in_progress',
          reason: 'work_completed',
        },
      ],
      id: workOrderId,
      laborCostBgn: '75.0000',
      laborMinutes: 90,
      number: 'DEV-WO-FIN-0001',
      parts: [],
      partsCostBgn: '0.0000',
      photos: [],
      priority: 'normal',
      problemDescription: 'Printer feed requires adjustment.',
      requestId: '409de106-ac44-473a-9a91-ffb6f78b6de2',
      requestNumber: 'DEV-SRV-FIN-0001',
      scheduledEnd: '2026-08-24T12:00:00.000Z',
      scheduledStart: '2026-08-24T10:00:00.000Z',
      serialNumber: 'FX20-00918',
      serviceType: 'out_of_warranty',
      signature: { signedAt: '2026-08-24T12:00:00.000Z', signerName: 'Customer signer' },
      startedAt: '2026-08-24T10:00:00.000Z',
      status: 'completed',
      timeEntries: [],
      totalCostBgn: '90.0000',
      transportCostBgn: '15.0000',
      updatedAt: '2026-08-24T12:00:00.000Z',
      version: 3,
    };
    const serviceLines = [
      {
        description: 'Service labour · DEV-WO-FIN-0001',
        discountPercent: '0.0000',
        quantity: '1.0000',
        unitCode: 'SERVICE',
        unitPrice: '75.0000',
        vatTreatment: 'standard_20',
      },
      {
        description: 'Transport · DEV-WO-FIN-0001',
        discountPercent: '0.0000',
        quantity: '1.0000',
        unitCode: 'SERVICE',
        unitPrice: '15.0000',
        vatTreatment: 'standard_20',
      },
    ];
    const references = {
      businessTimezone: 'Europe/Sofia',
      correctionDocuments: [],
      customers: [{ id: customerId, name: 'River Market Ltd.' }],
      products: [],
      salesDrafts: [],
      serviceDrafts: [
        {
          currencyCode: 'BGN',
          customerName: 'River Market Ltd.',
          customerPartnerId: customerId,
          id: workOrderId,
          linkedDocumentTypes: [],
          lines: serviceLines,
          number: 'DEV-WO-FIN-0001',
          total: '90.0000',
        },
      ],
      scopes: [
        {
          branchId: 'b06734ec-5a19-40a9-89a8-aa8c57c47411',
          branchName: 'Vratsa Operations',
          cashRegisters: [],
          legalEntityId: entityId,
          legalEntityName: 'Vista Service Demo Ltd.',
          locationId,
          locationName: 'Vratsa Service Centre',
          operators: [],
        },
      ],
    };
    const financialDocument = {
      bgnGrossTotal: '108.0000',
      bgnNetTotal: '90.0000',
      bgnVatTotal: '18.0000',
      branchName: 'Vratsa Operations',
      businessLocationId: locationId,
      businessLocationName: 'Vratsa Service Centre',
      createdAt: '2026-08-25T08:00:00.000Z',
      currencyCode: 'BGN',
      customerPartnerId: customerId,
      customerSnapshot: { address: '1 Customer Street, Vratsa, BG', name: 'River Market Ltd.' },
      documentType: 'invoice',
      dueDate: '2026-09-08',
      exchangeRate: '1.00000000',
      grossTotal: '108.0000',
      id: '44a1a302-4353-4b2e-a95a-e9023848b4ea',
      issueDate: '2026-08-25',
      issuerSnapshot: { address: '1 Service Street, Vratsa, BG', name: 'Vista Service Demo Ltd.' },
      legalEntityId: entityId,
      lines: serviceLines.map((line, index) => ({
        ...line,
        grossTotal: index ? '18.0000' : '90.0000',
        id: index ? 'dbe84bb9-7a79-43d1-9993-a32705a81dbe' : '7da9b87b-b947-4ad0-8a33-af7f511a20d7',
        lineNumber: index + 1,
        netTotal: index ? '15.0000' : '75.0000',
        vatAmount: index ? '3.0000' : '15.0000',
        vatRate: '20.0000',
      })),
      netTotal: '90.0000',
      number: 'DINV-VRATSA-2026-000021',
      rateDate: '2026-08-25',
      rateSource: 'internal_bgn',
      sourceServiceWorkOrderId: workOrderId,
      sourceServiceWorkOrderNumber: 'DEV-WO-FIN-0001',
      status: 'draft',
      taxEventDate: '2026-08-25',
      vatSummary: [
        {
          netTotal: '90.0000',
          vatAmount: '18.0000',
          vatRate: '20.0000',
          vatTreatment: 'standard_20',
        },
      ],
      vatTotal: '18.0000',
      version: 1,
    };
    let documents: unknown[] = [];
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(context));
      if (input.endsWith('/service/reference-data'))
        return Promise.resolve(
          jsonResponse({
            businessTimezone: 'Europe/Sofia',
            customers: [],
            equipment: [],
            locations: [],
            parts: [],
            subscriptions: [],
            technicians: [],
          }),
        );
      if (input.includes('/service/requests'))
        return Promise.resolve(
          jsonResponse({
            items: [],
            page: 1,
            pageSize: 25,
            summary: { completed: 0, inProgress: 0, new: 0, scheduled: 0 },
            total: 0,
            totalPages: 0,
          }),
        );
      if (input.endsWith(`/service/work-orders/${workOrderId}`))
        return Promise.resolve(jsonResponse(workOrder));
      if (input.includes('/service/work-orders'))
        return Promise.resolve(
          jsonResponse({
            items: [{ ...workOrder, status: 'scheduled' }],
            page: 1,
            pageSize: 25,
            total: 1,
            totalPages: 1,
          }),
        );
      if (input.endsWith('/finance/financial-documents/reference-data'))
        return Promise.resolve(jsonResponse(references));
      if (input.endsWith('/finance/financial-documents') && options?.method === 'POST') {
        documents = [financialDocument];
        return Promise.resolve(jsonResponse(financialDocument, 201));
      }
      if (input.endsWith('/finance/financial-documents'))
        return Promise.resolve(
          jsonResponse({
            items: documents,
            page: 1,
            pageSize: 25,
            totalItems: documents.length,
            totalPages: 1,
          }),
        );
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/erp.service/work-orders']);
    fireEvent.click(await screen.findByRole('button', { name: /DEV-WO-FIN-0001/u }));
    let dialog = await screen.findByRole('dialog', { name: 'DEV-WO-FIN-0001' });
    expect(
      fetchMock.mock.calls.some(([url]) => url.endsWith(`/service/work-orders/${workOrderId}`)),
    ).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: /Prepare invoice draft/u }));

    dialog = await screen.findByRole('dialog', { name: 'New financial document' });
    expect(within(dialog).getByText('Service labour · DEV-WO-FIN-0001')).toBeTruthy();
    expect(within(dialog).getAllByText('Service charge')).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Prepare draft' }));

    const preview = await screen.findByRole('dialog', { name: 'DINV-VRATSA-2026-000021' });
    expect(within(preview).getByText('DEV-WO-FIN-0001')).toBeTruthy();
    const createCall = fetchMock.mock.calls.find(
      ([url, options]) =>
        url.endsWith('/finance/financial-documents') && options?.method === 'POST',
    );
    expect(JSON.parse((createCall?.[1] as RequestInit).body as string)).toMatchObject({
      currencyCode: 'BGN',
      lines: serviceLines,
      sourceServiceWorkOrderId: workOrderId,
    });
  });

  it('issues a collection-linked cash receipt and shows it in the daily cash report', async () => {
    const financeContext = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'view', module: 'erp.finance' },
        { action: 'create', module: 'erp.finance' },
        { action: 'edit', module: 'erp.finance' },
      ],
    };
    storeAuthenticatedSession(financeContext);
    const registerId = '8412cc12-9766-49b6-9fd8-b54f92714a61';
    const operatorId = '54218542-85e8-44e2-b103-c0ace9e6ca3f';
    const collectionId = '409053c3-4538-41fb-9830-6439245b3efd';
    const customerId = '9043e858-019b-4ec4-b059-9b08afe5034d';
    const references = {
      businessDate: '2026-08-20',
      cashRegisters: [
        {
          branchName: 'Vratsa Operations',
          businessLocationId: 'abf5cd43-bc29-45e4-bbe8-421dbdc97ee5',
          businessLocationName: 'Vratsa Service & Retail Centre',
          code: 'POS-01',
          id: registerId,
          name: 'Demo POS terminal',
          operators: [{ code: 'MGR-01', id: operatorId, name: 'Vista Demo Manager' }],
        },
      ],
      openCollections: [
        {
          customerName: 'Balkan Retail Demo Ltd.',
          customerPartnerId: customerId,
          dueDate: '2026-09-03',
          id: collectionId,
          number: 'FIN-REV-2026-000002',
          outstandingTotal: '60.0000',
          sourceInvoiceNumber: 'INV-DRAFT-2026-000002',
        },
      ],
      partners: [{ id: customerId, name: 'Balkan Retail Demo Ltd.', roles: ['customer'] }],
    };
    const voucher: FinanceCashVoucher = {
      amount: '60.0000',
      branchName: 'Vratsa Operations',
      businessLocationId: references.cashRegisters[0]!.businessLocationId,
      businessLocationName: references.cashRegisters[0]!.businessLocationName,
      cashRegisterCode: 'POS-01',
      cashRegisterId: registerId,
      cashRegisterName: 'Demo POS terminal',
      collectionNumber: 'FIN-REV-2026-000002',
      counterpartyName: 'Balkan Retail Demo Ltd.',
      counterpartyPartnerId: customerId,
      createdAt: '2026-08-20T10:00:00.000Z',
      currencyCode: 'BGN',
      customerDocumentId: collectionId,
      direction: 'receipt',
      id: '5048ff04-f004-4462-a4be-dcd160bda357',
      issuedByName: 'Mila Petrova',
      number: 'CRV-POS-01-MGR-01-2026-000001',
      operatorCode: 'MGR-01',
      operatorId,
      operatorName: 'Vista Demo Manager',
      paymentNumber: 'PAY-2026-000007',
      paymentReference: 'Cash payment for FIN-REV-2026-000002',
      purpose: 'Customer cash payment',
      status: 'issued',
      version: 1,
      voucherDate: '2026-08-20',
    };
    let vouchers: FinanceCashVoucher[] = [];
    let submitted: Record<string, unknown> | undefined;
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(financeContext));
      if (input.endsWith('/finance/cash/reference-data'))
        return Promise.resolve(jsonResponse(references));
      if (input.includes('/finance/cash/daily-report'))
        return Promise.resolve(
          jsonResponse({
            cashRegisterCode: 'POS-01',
            cashRegisterId: registerId,
            cashRegisterName: 'Demo POS terminal',
            closingBalance: vouchers.length ? '60.0000' : '0.0000',
            generatedAt: '2026-08-20T10:01:00.000Z',
            openingBalance: '0.0000',
            paymentCount: 0,
            paymentTotal: '0.0000',
            receiptCount: vouchers.length,
            receiptTotal: vouchers.length ? '60.0000' : '0.0000',
            reportDate: '2026-08-20',
            vouchers,
          }),
        );
      if (input.endsWith('/finance/cash/vouchers') && options?.method === 'POST') {
        if (typeof options.body !== 'string') throw new Error('Expected a JSON request body');
        submitted = JSON.parse(options.body) as Record<string, unknown>;
        vouchers = [voucher];
        return Promise.resolve(jsonResponse(voucher, 201));
      }
      if (input.endsWith(`/finance/cash/vouchers/${voucher.id}`))
        return Promise.resolve(jsonResponse(voucher));
      if (input.endsWith('/finance/cash/vouchers'))
        return Promise.resolve(
          jsonResponse({
            items: vouchers,
            page: 1,
            pageSize: 25,
            totalItems: vouchers.length,
            totalPages: 1,
          }),
        );
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/erp.finance/cash']);
    expect(await screen.findByRole('heading', { name: 'Cash operations' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /New cash voucher/u }));
    const dialog = await screen.findByRole('dialog', { name: 'New cash voucher' });
    fireEvent.change(within(dialog).getByLabelText('Customer collection (optional)'), {
      target: { value: collectionId },
    });
    fireEvent.change(within(dialog).getByLabelText('Reason'), {
      target: { value: 'Customer cash payment' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Issue voucher' }));

    expect(await screen.findByText(`${voucher.number} was issued.`)).toBeTruthy();
    expect(submitted).toMatchObject({
      amount: '60.0000',
      cashRegisterId: registerId,
      customerDocumentId: collectionId,
      direction: 'receipt',
      operatorId,
      purpose: 'Customer cash payment',
    });
    const preview = await screen.findByRole('dialog', { name: voucher.number });
    expect(within(preview).getByText('PAY-2026-000007')).toBeTruthy();
    expect(within(preview).queryByRole('button', { name: 'Cancel voucher' })).toBeNull();
    fireEvent.click(within(preview).getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Daily cash report' }));
    expect(await screen.findByText('1 receipt')).toBeTruthy();
    expect(screen.getAllByText(/BGN\s*60\.00/u).length).toBeGreaterThan(0);
  });

  it('keeps statement lines separate and automatically matches only an exact reference', async () => {
    const financeContext = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'view', module: 'erp.finance' },
        { action: 'create', module: 'erp.finance' },
        { action: 'edit', module: 'erp.finance' },
      ],
    };
    storeAuthenticatedSession(financeContext);
    const statement: FinanceBankStatement = {
      accountIban: 'BG76DEMO00000000000000',
      bankName: 'Demo Bank',
      closingBalance: '140.0000',
      createdAt: '2026-08-19T09:00:00.000Z',
      currencyCode: 'BGN',
      id: '19e23adf-78dd-4f87-b680-e6254dfb6d17',
      incomingTotal: '40.0000',
      matchedIncomingCount: 1,
      matchedOutgoingCount: 0,
      number: 'BST-2026-000001',
      openingBalance: '100.0000',
      outgoingTotal: '0.0000',
      statementDate: '2026-08-19',
      statementReference: 'DEMO-STATEMENT-0819',
      status: 'open',
      transactionCount: 2,
      transactions: [
        {
          amount: '15.0000',
          counterpartyName: 'Alfa Market Demo Ltd.',
          direction: 'incoming',
          id: '8e087e25-8240-430e-9256-7090270e3d19',
          lineNumber: 1,
          match: {
            customerDocumentId: '31a738e3-117e-4eab-b528-513230f482f9',
            customerName: 'Alfa Market Demo Ltd.',
            documentNumber: 'DEV-FIN-REV-0001',
            matchedAt: '2026-08-19T09:00:00.000Z',
            method: 'automatic_reference',
            paymentNumber: 'PAY-2026-000002',
          },
          matchStatus: 'matched',
          paymentReference: 'Payment for DEV-FIN-REV-0001',
          transactionDate: '2026-08-19',
          valueDate: '2026-08-19',
          version: 2,
        },
        {
          amount: '25.0000',
          counterpartyName: 'Alfa Market Demo Ltd.',
          direction: 'incoming',
          id: '4afbfa44-b764-4da2-84f4-d8a4edf784c0',
          lineNumber: 2,
          matchStatus: 'unmatched',
          paymentReference: 'August customer transfer',
          transactionDate: '2026-08-19',
          valueDate: '2026-08-19',
          version: 1,
        },
      ],
      unmatchedIncomingCount: 1,
      unmatchedOutgoingCount: 0,
      version: 2,
    };
    let saved = false;
    let submittedLines: { amount: string; paymentReference: string }[] = [];
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(financeContext));
      if (input.endsWith('/finance/bank-statements') && options?.method === 'POST') {
        if (typeof options.body !== 'string') throw new Error('Expected a JSON request body');
        const submitted = JSON.parse(options.body) as {
          lines: { amount: string; paymentReference: string }[];
        };
        submittedLines = submitted.lines;
        saved = true;
        return Promise.resolve(jsonResponse(statement, 201));
      }
      if (input.endsWith('/finance/bank-statements'))
        return Promise.resolve(
          jsonResponse({
            items: saved ? [statement] : [],
            page: 1,
            pageSize: 20,
            totalItems: saved ? 1 : 0,
            totalPages: 1,
          }),
        );
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/erp.finance/cash-bank']);
    expect(await screen.findByRole('heading', { name: 'Bank reconciliation' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New statement' }));
    const dialog = await screen.findByRole('dialog', { name: 'New bank statement' });
    fireEvent.change(within(dialog).getByLabelText('Bank name'), {
      target: { value: 'Demo Bank' },
    });
    fireEvent.change(within(dialog).getByLabelText('Statement reference'), {
      target: { value: 'DEMO-STATEMENT-0819' },
    });
    fireEvent.change(within(dialog).getByLabelText('Company account IBAN'), {
      target: { value: statement.accountIban },
    });
    fireEvent.change(within(dialog).getByLabelText('Opening balance'), {
      target: { value: '100' },
    });
    fireEvent.change(within(dialog).getByLabelText('Transaction 1 amount'), {
      target: { value: '15' },
    });
    fireEvent.change(within(dialog).getByLabelText('Transaction 1 counterparty'), {
      target: { value: 'Alfa Market Demo Ltd.' },
    });
    fireEvent.change(within(dialog).getByLabelText('Transaction 1 payment reference'), {
      target: { value: 'Payment for DEV-FIN-REV-0001' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add line' }));
    fireEvent.change(within(dialog).getByLabelText('Transaction 2 amount'), {
      target: { value: '25' },
    });
    fireEvent.change(within(dialog).getByLabelText('Transaction 2 counterparty'), {
      target: { value: 'Alfa Market Demo Ltd.' },
    });
    fireEvent.change(within(dialog).getByLabelText('Transaction 2 payment reference'), {
      target: { value: 'August customer transfer' },
    });
    expect(within(dialog).getByText('Reference: August customer transfer')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use calculated balance' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add statement' }));

    expect(
      await screen.findByText('BST-2026-000001 was added with 1 transaction requiring review.'),
    ).toBeTruthy();
    expect(submittedLines).toEqual([
      expect.objectContaining({
        amount: '15',
        paymentReference: 'Payment for DEV-FIN-REV-0001',
      }),
      expect.objectContaining({ amount: '25', paymentReference: 'August customer transfer' }),
    ]);
    const preview = await screen.findByRole('dialog', { name: 'BST-2026-000001' });
    expect(
      within(preview).getByText(
        (_content, element) =>
          element?.tagName === 'P' &&
          element.textContent?.includes('Reference matched automatically') === true,
      ),
    ).toBeTruthy();
    expect(within(preview).getByText('PAY-2026-000002', { exact: false })).toBeTruthy();
    expect(within(preview).getByText('Needs review')).toBeTruthy();
  });

  it('confirms an outgoing bank transfer against a supplier payable', async () => {
    const financeContext = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'view', module: 'erp.finance' },
        { action: 'create', module: 'erp.finance' },
        { action: 'edit', module: 'erp.finance' },
      ],
    };
    storeAuthenticatedSession(financeContext);
    const transactionId = '42ff637e-d520-4c76-95ca-974c00f80efb';
    const payableId = '79e11300-0268-42c4-9846-334a15c61122';
    const supplierId = '267f244f-7ac1-4db3-a749-975f8acc28be';
    const statementId = '37f38c1d-0691-4fe3-b7be-9bdaee3a33ed';
    let statement: FinanceBankStatement = {
      accountIban: 'BG76DEMO00000000000000',
      bankName: 'Vista Demo Bank',
      closingBalance: '87.0000',
      createdAt: '2026-08-20T11:00:00.000Z',
      currencyCode: 'BGN',
      id: statementId,
      incomingTotal: '0.0000',
      matchedIncomingCount: 0,
      matchedOutgoingCount: 0,
      number: 'BST-2026-000009',
      openingBalance: '100.0000',
      outgoingTotal: '13.0000',
      statementDate: '2026-08-20',
      statementReference: 'SUPPLIER-PAYMENT-TEST',
      status: 'open',
      transactionCount: 1,
      transactions: [
        {
          amount: '13.0000',
          counterpartyName: 'TechSupply Demo Ltd.',
          direction: 'outgoing',
          id: transactionId,
          lineNumber: 1,
          matchStatus: 'unmatched',
          paymentReference: 'Payment for SP-2026-000001',
          transactionDate: '2026-08-20',
          valueDate: '2026-08-20',
          version: 1,
        },
      ],
      unmatchedIncomingCount: 0,
      unmatchedOutgoingCount: 1,
      version: 1,
    };
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(financeContext));
      if (input.endsWith('/finance/supplier-reference-data'))
        return Promise.resolve(
          jsonResponse({
            businessDate: '2026-08-20',
            openReceivables: [],
            supplierInvoices: [],
            suppliers: [{ id: supplierId, name: 'TechSupply Demo Ltd.' }],
          }),
        );
      if (input.endsWith(`/finance/bank-transactions/${transactionId}/supplier-match-candidates`))
        return Promise.resolve(
          jsonResponse([
            {
              dueDate: '2026-09-15',
              outstandingTotal: '13.0000',
              payableNumber: 'SP-2026-000001',
              referenceMatched: true,
              score: 100,
              sourceSupplierInvoiceNumber: 'DEV-SUP-INV-001',
              supplierName: 'TechSupply Demo Ltd.',
              supplierPartnerId: supplierId,
              supplierPayableId: payableId,
            },
          ]),
        );
      if (
        input.endsWith(`/finance/bank-transactions/${transactionId}/supplier-match`) &&
        options?.method === 'POST'
      ) {
        statement = {
          ...statement,
          matchedOutgoingCount: 1,
          status: 'reconciled',
          transactions: [
            {
              ...statement.transactions[0]!,
              matchStatus: 'matched',
              supplierMatch: {
                kind: 'payment',
                matchedAt: '2026-08-20T11:05:00.000Z',
                method: 'manual',
                paymentNumber: 'SPAY-2026-000002',
                supplierName: 'TechSupply Demo Ltd.',
                supplierPartnerId: supplierId,
                supplierPayableId: payableId,
                supplierPayableNumber: 'SP-2026-000001',
              },
              version: 2,
            },
          ],
          unmatchedOutgoingCount: 0,
          version: 2,
        };
        return Promise.resolve(
          jsonResponse({
            allocatedTotal: '13.0000',
            allocations: [],
            amount: '13.0000',
            availableTotal: '0.0000',
            id: '5d29ab7a-ebeb-4df2-ac34-58b8de8e7e32',
            kind: 'payment',
            number: 'SPAY-2026-000002',
            paymentDate: '2026-08-20',
            paymentMethod: 'bank_transfer',
            paymentReference: 'Payment for SP-2026-000001',
            recordedAt: '2026-08-20T11:05:00.000Z',
            supplierName: 'TechSupply Demo Ltd.',
            supplierPartnerId: supplierId,
            version: 1,
          }),
        );
      }
      if (input.endsWith(`/finance/bank-statements/${statementId}`))
        return Promise.resolve(jsonResponse(statement));
      if (input.endsWith('/finance/bank-statements'))
        return Promise.resolve(
          jsonResponse({
            items: [statement],
            page: 1,
            pageSize: 20,
            totalItems: 1,
            totalPages: 1,
          }),
        );
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/erp.finance/cash-bank']);
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    let dialog = await screen.findByRole('dialog', { name: 'BST-2026-000009' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review match' }));
    dialog = await screen.findByRole('dialog', { name: 'Review supplier transfer' });
    expect(within(dialog).getByText('Reference match')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm supplier match' }));

    dialog = await screen.findByRole('dialog', { name: 'BST-2026-000009' });
    expect(within(dialog).getByText('SPAY-2026-000002', { exact: false })).toBeTruthy();
    expect(within(dialog).getAllByText('Matched').length).toBeGreaterThan(0);
  });

  it('plans a delivery from a completed Sales shipment and dispatches it from the delivery board', async () => {
    const logisticsContext = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'view', module: 'erp.logistics' },
        { action: 'create', module: 'erp.logistics' },
        { action: 'edit', module: 'erp.logistics' },
      ],
    };
    storeAuthenticatedSession(logisticsContext);
    const shipmentId = '02427517-cad3-4d92-9774-7765198e65ce';
    const locationId = '950acac8-e75e-434c-9124-51c09f23d37d';
    const deliveryId = 'eb26eaa9-c67d-45b8-9876-0e0dd2e02740';
    const references = {
      assignees: [
        {
          accountId: loginResponse.account.id,
          displayName: loginResponse.account.displayName,
          email: loginResponse.account.email,
        },
      ],
      businessTimezone: 'Europe/Sofia',
      courierConnections: [
        { connected: false, provider: 'econt' },
        { connected: false, provider: 'speedy' },
      ],
      equipment: [],
      locations: [
        {
          addressLine1: '12 Hristo Botev Blvd.',
          city: 'Vratsa',
          countryCode: 'BG',
          customerId: partner.id,
          id: locationId,
          name: 'Vratsa retail outlet',
          postalCode: '3000',
        },
      ],
      serviceStops: [],
      shipments: [
        {
          customerId: partner.id,
          customerName: partner.displayName,
          handoverCertificateId: '7915ab0c-ccf1-45b9-8d90-0d97ddbc0052',
          handoverStatus: 'prepared',
          handoverVersion: 1,
          id: shipmentId,
          lines: [],
          number: 'SHP-2026-000014',
          shippedAt: '2026-08-25T08:00:00.000Z',
        },
      ],
      warehouses: [warehouseFixture],
    };
    let deliveries: Record<string, unknown>[] = [];
    const plannedDelivery = {
      addressLine1: '12 Hristo Botev Blvd.',
      city: 'Vratsa',
      countryCode: 'BG',
      createdAt: '2026-08-25T09:00:00.000Z',
      customerId: partner.id,
      customerLocationId: locationId,
      customerLocationName: 'Vratsa retail outlet',
      customerName: partner.displayName,
      deliveryMethod: 'company_transport',
      handoverCertificateId: references.shipments[0]!.handoverCertificateId,
      handoverStatus: 'prepared',
      history: [
        {
          changedAt: '2026-08-25T09:00:00.000Z',
          changedBy: loginResponse.account.displayName,
          nextStatus: 'planned',
          note: 'Delivery planned',
        },
      ],
      id: deliveryId,
      instructions: 'Call the customer before arrival.',
      number: 'DLV-2026-000014',
      postalCode: '3000',
      scheduledEnd: '2026-08-26T09:00:00.000Z',
      scheduledStart: '2026-08-26T07:00:00.000Z',
      shipmentId,
      shipmentNumber: 'SHP-2026-000014',
      status: 'planned',
      version: 1,
    };
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(logisticsContext));
      if (input.endsWith('/logistics/reference-data')) {
        return Promise.resolve(jsonResponse(references));
      }
      if (input.includes('/logistics/deliveries') && options?.method === 'POST') {
        if (input.endsWith(`/${deliveryId}/dispatch`)) {
          const dispatched = {
            ...plannedDelivery,
            history: [
              ...plannedDelivery.history,
              {
                changedAt: '2026-08-26T07:00:00.000Z',
                changedBy: loginResponse.account.displayName,
                nextStatus: 'in_transit',
                note: 'Driver departed',
                previousStatus: 'planned',
              },
            ],
            status: 'in_transit',
            version: 2,
          };
          deliveries = [dispatched];
          return Promise.resolve(jsonResponse(dispatched, 201));
        }
        deliveries = [plannedDelivery];
        return Promise.resolve(jsonResponse(plannedDelivery, 201));
      }
      if (input.includes('/logistics/deliveries')) {
        return Promise.resolve(
          jsonResponse({
            items: deliveries,
            page: 1,
            pageSize: 50,
            total: deliveries.length,
            totalPages: deliveries.length ? 1 : 0,
          }),
        );
      }
      if (input.includes('/logistics/returns')) {
        return Promise.resolve(
          jsonResponse({ items: [], page: 1, pageSize: 50, total: 0, totalPages: 0 }),
        );
      }
      if (input.includes('/logistics/routes')) {
        return Promise.resolve(
          jsonResponse({ items: [], page: 1, pageSize: 50, total: 0, totalPages: 0 }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/erp.logistics/deliveries']);
    expect(await screen.findByRole('heading', { name: 'Deliveries' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to Logistics' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Plan delivery' }));
    const planDialog = await screen.findByRole('dialog', { name: 'Plan delivery' });
    fireEvent.change(within(planDialog).getByLabelText('Instructions (optional)'), {
      target: { value: 'Call the customer before arrival.' },
    });
    fireEvent.click(within(planDialog).getByRole('button', { name: 'Plan delivery' }));

    const deliveryDialog = await screen.findByRole('dialog', { name: 'DLV-2026-000014' });
    expect(within(deliveryDialog).getByText('Vratsa retail outlet')).toBeTruthy();
    fireEvent.click(within(deliveryDialog).getByRole('button', { name: 'Dispatch' }));
    expect(await screen.findByText('DLV-2026-000014 is on the way.')).toBeTruthy();
    await waitFor(() =>
      expect(
        within(screen.getByRole('dialog', { name: 'DLV-2026-000014' })).getAllByText('On the way')
          .length,
      ).toBeGreaterThan(0),
    );

    const createCall = fetchMock.mock.calls.find(
      ([url, options]) => url.endsWith('/logistics/deliveries') && options?.method === 'POST',
    );
    expect(JSON.parse((createCall?.[1] as RequestInit).body as string)).toMatchObject({
      customerLocationId: locationId,
      deliveryMethod: 'company_transport',
      instructions: 'Call the customer before arrival.',
      shipmentId,
    });
  });

  it('keeps the authoritative Service appointment instant when planning its route', async () => {
    const logisticsContext = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'view', module: 'erp.logistics' },
        { action: 'create', module: 'erp.logistics' },
      ],
    };
    storeAuthenticatedSession(logisticsContext);
    const workOrderId = '481ba138-38a8-4b49-bf20-c5896684ebdb';
    const scheduledStart = '2026-08-27T10:00:00.000Z';
    const scheduledEnd = '2026-08-27T11:00:00.000Z';
    const references = {
      assignees: [
        {
          accountId: loginResponse.account.id,
          displayName: loginResponse.account.displayName,
          email: loginResponse.account.email,
        },
      ],
      businessTimezone: 'Europe/Sofia',
      courierConnections: [
        { connected: false, provider: 'econt' },
        { connected: false, provider: 'speedy' },
      ],
      equipment: [],
      locations: [],
      serviceStops: [
        {
          assignedAccountId: loginResponse.account.id,
          assignedTo: loginResponse.account.displayName,
          customerName: 'Alfa Market Demo Ltd.',
          id: workOrderId,
          label: 'SR-2026-000021 · Demo Receipt Printer',
          scheduledEnd,
          scheduledStart,
        },
      ],
      shipments: [],
      warehouses: [],
    };
    const emptyPage = { items: [], page: 1, pageSize: 50, total: 0, totalPages: 0 };
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(logisticsContext));
      if (input.endsWith('/logistics/reference-data'))
        return Promise.resolve(jsonResponse(references));
      if (input.endsWith('/logistics/routes') && options?.method === 'POST')
        return Promise.resolve(
          jsonResponse(
            {
              assignedAccountId: loginResponse.account.id,
              assignedTo: loginResponse.account.displayName,
              createdAt: '2026-08-26T12:00:00.000Z',
              id: '9c1bb414-cadf-4722-b192-55024fcb2b4c',
              number: 'RTE-2026-000021',
              routeDate: '2026-08-27',
              status: 'planned',
              stops: [],
              title: 'Alfa printer visits',
            },
            201,
          ),
        );
      if (input.includes('/logistics/deliveries')) return Promise.resolve(jsonResponse(emptyPage));
      if (input.includes('/logistics/returns')) return Promise.resolve(jsonResponse(emptyPage));
      if (input.includes('/logistics/routes')) return Promise.resolve(jsonResponse(emptyPage));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/erp.logistics/routes']);
    expect(await screen.findByRole('heading', { name: 'Routes' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Plan route' }));
    const dialog = await screen.findByRole('dialog', { name: 'Plan route' });
    expect(within(dialog).getByLabelText('Planned arrival')).toHaveProperty(
      'value',
      '2026-08-27T13:00',
    );
    expect(within(dialog).getByDisplayValue('60')).toHaveProperty('value', '60');
    fireEvent.change(within(dialog).getByLabelText('Route title'), {
      target: { value: 'Alfa printer visits' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Plan route' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) => url.endsWith('/logistics/routes') && options?.method === 'POST',
        ),
      ).toBe(true),
    );
    const createCall = fetchMock.mock.calls.find(
      ([url, options]) => url.endsWith('/logistics/routes') && options?.method === 'POST',
    );
    expect(JSON.parse((createCall?.[1] as RequestInit).body as string)).toMatchObject({
      assignedAccountId: loginResponse.account.id,
      routeDate: '2026-08-27',
      stops: [
        {
          plannedArrival: scheduledStart,
          plannedDurationMinutes: 60,
          serviceWorkOrderId: workOrderId,
          stopType: 'service',
        },
      ],
      title: 'Alfa printer visits',
    });
  });

  it('navigates from ERP Service to request intake and creates a dispatch-ready service request', async () => {
    const serviceContext = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'view', module: 'erp.service' },
        { action: 'create', module: 'erp.service' },
        { action: 'edit', module: 'erp.service' },
        { action: 'approve', module: 'erp.service' },
      ],
    };
    storeAuthenticatedSession(serviceContext);

    const customerId = '70f5a1e9-0a41-470e-87cf-67f699573f42';
    const locationId = '8403ff16-4e6f-40ce-9abb-7d02a4a94b43';
    const equipmentId = 'c8c5f3a4-dc2f-43f1-bac7-4dca0a6e5f4a';
    const request = {
      createdAt: '2026-08-14T09:00:00.000Z',
      customerEquipmentId: equipmentId,
      customerLocationId: locationId,
      customerLocationName: 'Vratsa retail outlet',
      customerName: 'Mountain Retail Ltd.',
      customerPartnerId: customerId,
      deviceName: 'Fiscal register FX-20',
      id: '91d7d617-55d0-4d2f-b46b-9146d42aa4c3',
      number: 'SR-2026-000001',
      priority: 'high' as const,
      problemDescription: 'The receipt printer intermittently stops during a sale.',
      serialNumber: 'FX20-00918',
      serviceType: 'warranty' as const,
      sourceChannel: 'email' as const,
      status: 'new' as const,
      updatedAt: '2026-08-14T09:00:00.000Z',
      version: 1,
    };
    let requests: (typeof request)[] = [];
    const page = () => ({
      items: requests,
      page: 1,
      pageSize: 25,
      summary: { completed: 0, inProgress: 0, new: requests.length, scheduled: 0 },
      total: requests.length,
      totalPages: requests.length ? 1 : 0,
    });
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(serviceContext));
      if (input.endsWith('/service/reference-data')) {
        return Promise.resolve(
          jsonResponse({
            businessTimezone: 'Europe/Sofia',
            customers: [{ id: customerId, name: 'Mountain Retail Ltd.' }],
            equipment: [
              {
                active: true,
                customerLocationId: locationId,
                customerPartnerId: customerId,
                deviceName: 'Fiscal register FX-20',
                id: equipmentId,
                serialNumber: 'FX20-00918',
                status: 'active',
                warrantyEndsOn: '2027-08-14',
              },
            ],
            locations: [
              {
                customerPartnerId: customerId,
                id: locationId,
                name: 'Vratsa retail outlet',
              },
            ],
            parts: [],
            subscriptions: [],
            technicians: [
              {
                accountId: loginResponse.account.id,
                displayName: loginResponse.account.displayName,
                email: loginResponse.account.email,
                warehouseId: technicianWarehouseFixture.id,
                warehouseName: technicianWarehouseFixture.name,
              },
            ],
          }),
        );
      }
      if (input.includes('/service/requests') && (!options?.method || options.method === 'GET')) {
        return Promise.resolve(jsonResponse(page()));
      }
      if (
        input.includes('/service/work-orders') &&
        (!options?.method || options.method === 'GET')
      ) {
        return Promise.resolve(
          jsonResponse({ items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 }),
        );
      }
      if (input.endsWith('/service/requests') && options?.method === 'POST') {
        requests = [request];
        return Promise.resolve(jsonResponse(request, 201));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/']);
    expect(
      await screen.findByRole('heading', { name: `${messages.home.title}, Mila.` }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('link', { name: 'Service' }));
    expect(await screen.findByRole('heading', { name: 'Service' })).toBeTruthy();
    fireEvent.click(
      screen.getByRole('link', { name: /Service requests Capture and dispatch service requests/u }),
    );
    expect(await screen.findByRole('heading', { name: 'Service requests' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'New service request' }));
    const dialog = await screen.findByRole('dialog', { name: 'New service request' });
    fireEvent.change(within(dialog).getByLabelText('Request source'), {
      target: { value: 'email' },
    });
    fireEvent.change(within(dialog).getByLabelText('Priority'), { target: { value: 'high' } });
    fireEvent.change(within(dialog).getByLabelText('Problem description'), {
      target: { value: request.problemDescription },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create request' }));

    expect(await screen.findByText('SR-2026-000001 is ready for dispatch.')).toBeTruthy();
    expect(await screen.findByRole('dialog', { name: 'SR-2026-000001' })).toBeTruthy();
    const createCall = fetchMock.mock.calls.find(
      ([url, options]) => url.endsWith('/service/requests') && options?.method === 'POST',
    );
    expect(createCall).toBeTruthy();
    expect(JSON.parse((createCall?.[1] as RequestInit).body as string)).toMatchObject({
      customerEquipmentId: equipmentId,
      customerLocationId: locationId,
      customerPartnerId: customerId,
      priority: 'high',
      problemDescription: request.problemDescription,
      serviceType: 'warranty',
      sourceChannel: 'email',
    });
  });

  it('manages a warranty claim and records a completed device inspection', async () => {
    const serviceContext = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'view', module: 'erp.service' },
        { action: 'create', module: 'erp.service' },
        { action: 'edit', module: 'erp.service' },
        { action: 'approve', module: 'erp.service' },
      ],
    };
    storeAuthenticatedSession(serviceContext);
    const customerId = '70f5a1e9-0a41-470e-87cf-67f699573f42';
    const locationId = '8403ff16-4e6f-40ce-9abb-7d02a4a94b43';
    const equipmentId = 'c8c5f3a4-dc2f-43f1-bac7-4dca0a6e5f4a';
    const claim: WarrantyClaim = {
      attachments: [],
      customerEquipmentId: equipmentId,
      customerLocationId: locationId,
      customerLocationName: 'Vratsa retail outlet',
      customerName: 'Mountain Retail Ltd.',
      customerPartnerId: customerId,
      description: 'The printer feed stops intermittently during a sale.',
      deviceName: 'Fiscal register FX-20',
      history: [
        {
          changedAt: '2026-08-26T08:00:00.000Z',
          id: '9cc41d47-f285-49c4-9283-c7e49a629e15',
          nextStatus: 'received',
        },
      ],
      id: '41a5d738-beb1-42c2-a2db-1b3c47b37d09',
      number: 'WCL-2026-000001',
      receivedAt: '2026-08-26T08:00:00.000Z',
      serialNumber: 'FX20-00918',
      status: 'received',
      updatedAt: '2026-08-26T08:00:00.000Z',
      version: 1,
    };
    const inspection: ServiceInspectionPlan = {
      active: true,
      customerLocationName: 'Vratsa retail outlet',
      customerName: 'Mountain Retail Ltd.',
      deviceName: 'Fiscal register FX-20',
      equipmentId,
      id: 'd9ac7c92-539c-4f21-b716-3f1f7b752660',
      inspectionType: 'technical',
      intervalMonths: 12,
      nextDueDate: '2026-08-26',
      records: [],
      reminderLeadDays: 30,
      serialNumber: 'FX20-00918',
      version: 1,
    };
    let currentClaim = claim;
    let currentInspection = inspection;
    const overview = () => ({
      businessTimezone: 'Europe/Sofia',
      claims: [currentClaim],
      inspections: [currentInspection],
      warranties: [
        {
          activeClaimCount: 1,
          claimCount: 1,
          customerLocationName: 'Vratsa retail outlet',
          customerName: 'Mountain Retail Ltd.',
          deviceName: 'Fiscal register FX-20',
          equipmentId,
          remainingDays: 353,
          serialNumber: 'FX20-00918',
          status: 'active',
          warrantyEndsOn: '2027-08-14',
        },
      ],
    });
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(serviceContext));
      if (input.endsWith('/service/reference-data'))
        return Promise.resolve(
          jsonResponse({
            businessTimezone: 'Europe/Sofia',
            customers: [{ id: customerId, name: 'Mountain Retail Ltd.' }],
            equipment: [
              {
                active: true,
                customerLocationId: locationId,
                customerPartnerId: customerId,
                deviceName: 'Fiscal register FX-20',
                id: equipmentId,
                serialNumber: 'FX20-00918',
                status: 'active',
                warrantyEndsOn: '2027-08-14',
              },
            ],
            locations: [
              { customerPartnerId: customerId, id: locationId, name: 'Vratsa retail outlet' },
            ],
            parts: [],
            subscriptions: [],
            technicians: [],
          }),
        );
      if (input.endsWith('/service/care')) return Promise.resolve(jsonResponse(overview()));
      if (input.includes('/service/requests'))
        return Promise.resolve(
          jsonResponse({
            items: [],
            page: 1,
            pageSize: 25,
            summary: { completed: 0, inProgress: 0, new: 0, scheduled: 0 },
            total: 0,
            totalPages: 0,
          }),
        );
      if (input.includes('/service/work-orders'))
        return Promise.resolve(
          jsonResponse({ items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 }),
        );
      if (
        input.endsWith(`/service/warranty-claims/${claim.id}/transition`) &&
        options?.method === 'POST'
      ) {
        currentClaim = {
          ...currentClaim,
          history: [
            ...currentClaim.history,
            {
              changedAt: '2026-08-26T09:00:00.000Z',
              id: '971bb2d7-1953-458a-a210-cc1be4911699',
              nextStatus: 'under_review',
              previousStatus: 'received',
            },
          ],
          status: 'under_review',
          version: 2,
        };
        return Promise.resolve(jsonResponse(currentClaim));
      }
      if (
        input.endsWith(`/service/inspection-plans/${inspection.id}/complete`) &&
        options?.method === 'POST'
      ) {
        currentInspection = {
          ...currentInspection,
          lastCompletedOn: '2026-08-26',
          nextDueDate: '2027-08-26',
          records: [
            {
              completedOn: '2026-08-26',
              dueDate: '2026-08-26',
              id: 'b33edf27-45a1-4d29-84d5-206866277b94',
              notes: 'All functional checks passed.',
              outcome: 'passed',
            },
          ],
          version: 2,
        };
        return Promise.resolve(jsonResponse(currentInspection));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/erp.service/care']);

    expect(await screen.findByRole('heading', { name: 'Warranty & inspections' })).toBeTruthy();
    expect(await screen.findByText('WCL-2026-000001')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /WCL-2026-000001/u }));
    let dialog = await screen.findByRole('dialog', { name: 'WCL-2026-000001' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start review' }));
    expect((await within(dialog).findAllByText('Under review')).length).toBeGreaterThan(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close panel' }));

    fireEvent.click(screen.getByRole('button', { name: /Technical Fiscal register FX-20/u }));
    dialog = await screen.findByRole('dialog', { name: 'Technical inspection' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record completed inspection' }));
    fireEvent.change(within(dialog).getByLabelText('Findings'), {
      target: { value: 'All functional checks passed.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save inspection result' }));

    expect(await within(dialog).findByText('All functional checks passed.')).toBeTruthy();
    const transitionCall = fetchMock.mock.calls.find(
      ([url, options]) =>
        url.endsWith(`/service/warranty-claims/${claim.id}/transition`) &&
        options?.method === 'POST',
    );
    expect(JSON.parse((transitionCall?.[1] as RequestInit).body as string)).toMatchObject({
      expectedVersion: 1,
      nextStatus: 'under_review',
    });
    const inspectionCall = fetchMock.mock.calls.find(
      ([url, options]) =>
        url.endsWith(`/service/inspection-plans/${inspection.id}/complete`) &&
        options?.method === 'POST',
    );
    const inspectionBody = JSON.parse(
      (inspectionCall?.[1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(inspectionBody).toMatchObject({
      expectedVersion: 1,
      notes: 'All functional checks passed.',
      outcome: 'passed',
    });
    expect(inspectionBody.completedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  it('reviews Service performance and opens an account-scoped report export panel', async () => {
    const serviceContext = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'view', module: 'erp.service' },
        { action: 'create', module: 'erp.service' },
        { action: 'approve', module: 'erp.service' },
      ],
    };
    storeAuthenticatedSession(serviceContext);
    const overview: ServiceReportOverview = {
      dateFrom: '2026-08-01',
      dateTo: '2026-08-26',
      generatedAt: '2026-08-26T12:00:00.000Z',
      statusTotals: [
        { count: 1, status: 'in_progress' },
        { count: 2, status: 'completed' },
      ],
      technicians: [
        {
          assignedCount: 3,
          completedCount: 2,
          displayName: 'Mila Petrova',
          laborMinutes: 150,
          totalCostBgn: '170.0000',
        },
      ],
      totals: {
        cancelledRequests: 0,
        completedRequests: 2,
        laborMinutes: 150,
        openRequests: 1,
        totalCostBgn: '170.0000',
        totalRequests: 3,
      },
      typeTotals: [
        {
          completedCount: 2,
          requestCount: 3,
          serviceType: 'warranty',
          totalCostBgn: '170.0000',
        },
      ],
    };
    const definitions: ServiceReportDefinition[] = [
      {
        description: 'Detailed Service requests and recorded cost.',
        formats: ['csv', 'xlsx', 'pdf'],
        key: 'service.request-register',
        name: 'Service request register',
        requiresDateRange: true,
      },
    ];
    const emptyRequestPage = {
      items: [],
      page: 1,
      pageSize: 25,
      summary: { completed: 0, inProgress: 0, new: 0, scheduled: 0 },
      total: 0,
      totalPages: 0,
    };
    const emptyWorkPage = { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 };
    const fetchMock = vi.fn((input: string) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(serviceContext));
      if (input.endsWith('/service/reference-data'))
        return Promise.resolve(
          jsonResponse({
            businessTimezone: 'Europe/Sofia',
            customers: [],
            equipment: [],
            locations: [],
            parts: [],
            subscriptions: [],
            technicians: [],
          }),
        );
      if (input.includes('/service/requests?'))
        return Promise.resolve(jsonResponse(emptyRequestPage));
      if (input.includes('/service/work-orders'))
        return Promise.resolve(jsonResponse(emptyWorkPage));
      if (input.includes('/service/reports/overview'))
        return Promise.resolve(jsonResponse(overview));
      if (input.endsWith('/service/report-exports/definitions'))
        return Promise.resolve(jsonResponse(definitions));
      if (input.includes('/service/saved-reports?'))
        return Promise.resolve(jsonResponse({ items: [], page: 1, total: 0, totalPages: 0 }));
      if (input.includes('/service/report-exports?'))
        return Promise.resolve(
          jsonResponse({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 }),
        );
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/erp.service']);

    expect(await screen.findByRole('heading', { name: 'Service' })).toBeTruthy();
    fireEvent.click(
      screen.getByRole('link', {
        name: /Service reports Review request volume, completion, technician workload/u,
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Service reports' })).toBeTruthy();
    expect((await screen.findAllByText('Mila Petrova')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('2h 30m')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/BGN\s*170\.00/u)).length).toBeGreaterThan(0);
    const serviceTabs = screen.getByRole('navigation', { name: 'Service sections' });
    expect(serviceTabs.classList.contains('service-tabs')).toBe(true);
    expect(
      within(serviceTabs).getByRole('link', { name: 'Reports' }).classList.contains('is-active'),
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Export report' }));
    const dialog = await screen.findByRole('dialog', { name: 'Export Service report' });
    expect(within(dialog).getByLabelText('Report')).toHaveProperty(
      'value',
      'service.request-register',
    );
    expect(within(dialog).getByRole('button', { name: 'Prepare export' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('shows technician workload and saves working hours from the service schedule', async () => {
    const serviceContext = {
      ...authenticationContext,
      permissions: [
        ...authenticationContext.permissions,
        { action: 'view', module: 'erp.service' },
        { action: 'approve', module: 'erp.service' },
      ],
    };
    storeAuthenticatedSession(serviceContext);
    const technician = {
      accountId: loginResponse.account.id,
      displayName: loginResponse.account.displayName,
      email: loginResponse.account.email,
      warehouseId: technicianWarehouseFixture.id,
      warehouseName: technicianWarehouseFixture.name,
    };
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(serviceContext));
      if (input.endsWith('/service/reference-data'))
        return Promise.resolve(
          jsonResponse({
            businessTimezone: 'Europe/Sofia',
            customers: [],
            equipment: [],
            locations: [],
            parts: [],
            subscriptions: [],
            technicians: [technician],
          }),
        );
      if (input.includes('/service/schedule?')) {
        const url = new URL(input, 'http://localhost');
        const dateFrom = url.searchParams.get('dateFrom') ?? '2026-08-24';
        const dates = Array.from({ length: 7 }, (_, index) => {
          const date = new Date(`${dateFrom}T12:00:00.000Z`);
          date.setUTCDate(date.getUTCDate() + index);
          return date.toISOString().slice(0, 10);
        });
        return Promise.resolve(
          jsonResponse({
            businessTimezone: 'Europe/Sofia',
            dateFrom,
            dateTo: dates[6],
            technicians: [
              {
                bookedMinutes: 60,
                capacityMinutes: 2400,
                days: dates.map((date, index) => ({
                  bookedMinutes: index === 2 ? 60 : 0,
                  ...(index < 5
                    ? {
                        capacityMinutes: 480,
                        endsAt: '17:00',
                        maxVisits: 6,
                        remainingMinutes: index === 2 ? 420 : 480,
                        startsAt: '08:00',
                      }
                    : {}),
                  date,
                  visits:
                    index === 2
                      ? [
                          {
                            customerLocationName: 'Vratsa retail outlet',
                            customerName: 'Mountain Retail Ltd.',
                            deviceName: 'Fiscal register FX-20',
                            priority: 'high',
                            requestNumber: 'SR-2026-000001',
                            scheduledEnd: `${date}T10:00:00.000Z`,
                            scheduledStart: `${date}T09:00:00.000Z`,
                            status: 'scheduled',
                            workOrderId: '8ff82289-4e28-4a7f-87d0-409ed7124e47',
                            workOrderNumber: 'WO-2026-000001',
                          },
                        ]
                      : [],
                })),
                policy: {
                  configured: true,
                  technicianAccountId: technician.accountId,
                  version: 1,
                  windows: Array.from({ length: 5 }, (_, index) => ({
                    capacityMinutes: 480,
                    endsAt: '17:00',
                    maxVisits: 6,
                    startsAt: '08:00',
                    weekday: index + 1,
                  })),
                },
                remainingMinutes: 2340,
                technician,
                visitCount: 1,
              },
            ],
          }),
        );
      }
      if (
        input.includes(`/service/technicians/${technician.accountId}/schedule-policy`) &&
        options?.method === 'PUT'
      )
        return Promise.resolve(
          jsonResponse({
            configured: true,
            technicianAccountId: technician.accountId,
            version: 2,
            windows: [],
          }),
        );
      if (input.includes('/service/requests'))
        return Promise.resolve(
          jsonResponse({
            items: [],
            page: 1,
            pageSize: 25,
            summary: { completed: 0, inProgress: 0, new: 0, scheduled: 0 },
            total: 0,
            totalPages: 0,
          }),
        );
      if (input.includes('/service/work-orders'))
        return Promise.resolve(
          jsonResponse({ items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 }),
        );
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/erp.service/schedule']);

    expect(await screen.findByText('Mountain Retail Ltd.')).toBeTruthy();
    expect(screen.getByText('1 visit')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Manage working hours/u }));
    const dialog = await screen.findByRole('dialog', { name: 'Working hours and capacity' });
    expect(within(dialog).getByLabelText('Monday')).toHaveProperty('checked', true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use Mon–Fri template' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save working hours' }));

    expect(await screen.findByText('Mila Petrova’s working hours were updated.')).toBeTruthy();
    const saveCall = fetchMock.mock.calls.find(
      ([url, options]) =>
        url.includes(`/service/technicians/${technician.accountId}/schedule-policy`) &&
        options?.method === 'PUT',
    );
    const saved = JSON.parse((saveCall?.[1] as RequestInit).body as string) as {
      expectedVersion: number;
      windows: unknown[];
    };
    expect(saved.expectedVersion).toBe(1);
    expect(saved.windows).toHaveLength(5);
  });

  it('explores reproducible CRM analytics and opens a fitted export panel', async () => {
    const crmContext = {
      ...authenticationContext,
      permissions: [
        { action: 'view', module: 'crm' },
        { action: 'create', module: 'crm' },
      ],
    };
    storeAuthenticatedSession(crmContext);
    const overview: CrmAnalyticsOverview = {
      customerMetrics: {
        activeCustomers: 2,
        averageTransactionValueBgn: '72.00',
        churnPercent: '0.00',
        observedLifetimeValueBgn: '100.00',
        purchaseFrequency: '1.50',
        retentionPercent: '100.00',
      },
      dateFrom: '2026-06-05',
      dateTo: '2026-09-02',
      definitions: [
        {
          dataSources: ['finance.financial_documents'],
          dateWindow: 'Invoice issue dates in the selected period.',
          formula: 'Invoice count divided by active customers.',
          key: 'customer-activity',
          label: 'Customer activity',
          statusFilters: ['Non-cancelled invoices only.'],
        },
      ],
      employees: [
        {
          displayName: 'Mila Petrova',
          requestsProcessed: 1,
          salesCompleted: 2,
          ticketsResolved: 3,
          totalCompleted: 6,
        },
      ],
      generatedAt: '2026-09-02T12:00:00.000Z',
      pipeline: {
        createdOpportunities: 2,
        estimatedRevenueBgn: '1800.00',
        lostCount: 0,
        openPipelineValueBgn: '800.00',
        stages: [
          { currentCount: 0, enteredCount: 2, stage: 'new' },
          {
            conversionFromPreviousPercent: '50.00',
            currentCount: 1,
            enteredCount: 1,
            stage: 'qualified',
          },
          {
            conversionFromPreviousPercent: '100.00',
            currentCount: 1,
            enteredCount: 1,
            stage: 'quotation_sent',
          },
          {
            conversionFromPreviousPercent: '0.00',
            currentCount: 0,
            enteredCount: 0,
            stage: 'negotiation',
          },
          {
            conversionFromPreviousPercent: '0.00',
            currentCount: 0,
            enteredCount: 0,
            stage: 'won',
          },
          { currentCount: 0, enteredCount: 0, stage: 'lost' },
        ],
        winRatePercent: '0.00',
        wonCount: 0,
      },
      preferences: [
        {
          documentCount: 2,
          kind: 'product',
          label: 'Demo Fiscal Register X1',
          netRevenueBgn: '100.00',
          quantity: '2.0000',
        },
      ],
      previousCustomerMetrics: {
        activeCustomers: 1,
        averageTransactionValueBgn: '60.00',
        churnPercent: '0.00',
        observedLifetimeValueBgn: '80.00',
        purchaseFrequency: '1.00',
        retentionPercent: '100.00',
      },
      previousDateFrom: '2026-03-07',
      previousDateTo: '2026-06-04',
      revenue: [
        {
          dimension: 'product',
          documentCount: 2,
          key: 'product-1',
          label: 'Demo Fiscal Register X1',
          netRevenueBgn: '100.00',
          sharePercent: '100.00',
        },
        {
          dimension: 'customer',
          documentCount: 2,
          key: partner.id,
          label: 'Alfa Market Demo Ltd.',
          netRevenueBgn: '100.00',
          sharePercent: '100.00',
        },
      ],
      timezone: 'Europe/Sofia',
      totalNetRevenueBgn: '100.00',
    };
    const definitions: CrmReportDefinition[] = [
      {
        description: 'Customer activity, retention, churn, and observed value.',
        formats: ['xlsx', 'csv', 'pdf'],
        key: 'crm.customer-value',
        name: 'Customer value and retention',
        requiresDateRange: true,
      },
    ];
    const completedExport: CrmReportExport = {
      attemptCount: 1,
      completedAt: '2026-09-02T12:01:00.000Z',
      createdAt: '2026-09-02T12:00:00.000Z',
      definitionKey: 'crm.customer-value',
      fileName: 'customer-value-2026-09-02.xlsx',
      format: 'xlsx',
      id: 'e2b4db34-4bed-48dd-a0ab-d97db5f06639',
      name: 'Customer value and retention',
      rowCount: 2,
      sizeBytes: 7283,
      status: 'completed',
    };
    const fetchMock = vi.fn((input: string) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(crmContext));
      if (input.includes('/crm/analytics/overview')) return Promise.resolve(jsonResponse(overview));
      if (input.endsWith('/crm/report-exports/definitions')) {
        return Promise.resolve(jsonResponse(definitions));
      }
      if (input.includes('/crm/saved-reports?'))
        return Promise.resolve(jsonResponse({ items: [], page: 1, total: 0, totalPages: 0 }));
      if (input.includes('/crm/report-exports?')) {
        return Promise.resolve(
          jsonResponse({
            items: [completedExport],
            page: 1,
            pageSize: 20,
            total: 1,
            totalPages: 1,
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/crm/analytics']);

    expect(await screen.findByRole('heading', { name: 'Customer analytics' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Analytics' }).classList.contains('is-active')).toBe(
      true,
    );
    expect((await screen.findAllByText('Demo Fiscal Register X1')).length).toBeGreaterThan(0);
    expect(screen.getByText('Completed work by employee')).toBeTruthy();
    expect(screen.getByRole('button', { name: '90 days' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'This year' }));
    expect(screen.getByRole('button', { name: 'This year' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: '90 days' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Customer' }));
    expect(await screen.findByText('Alfa Market Demo Ltd.')).toBeTruthy();
    fireEvent.click(screen.getByText('How these numbers are calculated'));
    expect(screen.getByText('Invoice count divided by active customers.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Export report/u }));
    const dialog = await screen.findByRole('dialog', { name: 'Export CRM report' });
    expect(
      within(dialog).getByRole('option', { name: 'Customer value and retention' }),
    ).toBeTruthy();
    expect(within(dialog).getByText('Ready')).toBeTruthy();
    const body = dialog.querySelector('.report-export-drawer-body');
    const actions = dialog.querySelector(':scope > footer.security-drawer-actions');
    expect(body).toBeTruthy();
    expect(actions).toBeTruthy();
    expect(
      within(actions as HTMLElement).getByRole('button', { name: 'Prepare export' }),
    ).toBeTruthy();
  });

  it('connects warranty, feedback, and referral work in CRM customer care', async () => {
    const crmContext = {
      ...authenticationContext,
      permissions: [
        { action: 'view', module: 'crm' },
        { action: 'create', module: 'crm' },
        { action: 'edit', module: 'crm' },
      ],
    };
    storeAuthenticatedSession(crmContext);
    const overview = {
      assignees: [{ displayName: 'Mila Petrova', id: loginResponse.account.id }],
      businessTimezone: 'Europe/Sofia',
      claims: [],
      customers: [{ id: partner.id, name: partner.displayName }],
      nps: { detractors: 0, passives: 0, promoters: 0, responses: 0, trend: [] },
      referrals: [],
      surveySources: [
        {
          customerLocationId: 'f9fe18c8-f654-4305-8e36-687563318b0c',
          customerName: partner.displayName,
          customerPartnerId: partner.id,
          id: 'f3e45425-7e87-4449-aa56-7b2bbf4da71b',
          label: 'DEV-WO-0001 · completed Service job',
          sourceKind: 'service',
        },
      ],
      surveys: [],
      warrantyCards: [
        {
          claimCount: 0,
          customerEquipmentId: 'c98388f7-0578-4f39-85d0-d28a8dc61ea8',
          customerLocationId: 'f9fe18c8-f654-4305-8e36-687563318b0c',
          customerLocationName: 'Central Store',
          customerName: partner.displayName,
          customerPartnerId: partner.id,
          deviceName: 'Fiscal Register X1',
          id: '76d38aa6-ada6-8b23-3c5b-c15be78edc09',
          issuedAt: '2026-08-20T09:00:00.000Z',
          number: 'WCR-2026-000001',
          offerStatus: 'not_offered',
          remainingDays: 600,
          serialNumber: 'TRACE-FR-0001',
          status: 'active',
          warrantyEndsOn: '2028-08-20',
          warrantyStartsOn: '2026-08-20',
        },
      ],
    };
    const fetchMock = vi.fn((input: string, options?: RequestInit) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(jsonResponse(crmContext));
      if (input.endsWith('/crm/after-sales')) return Promise.resolve(jsonResponse(overview));
      if (
        input.endsWith(
          '/crm/after-sales/warranty-cards/76d38aa6-ada6-8b23-3c5b-c15be78edc09/offer',
        ) &&
        options?.method === 'POST'
      )
        return Promise.resolve(
          jsonResponse({ ...overview.warrantyCards[0], offerStatus: 'offered' }),
        );
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApplication(['/modules/crm/customer-care']);

    expect(await screen.findByRole('heading', { name: 'Customer care' })).toBeTruthy();
    const warrantiesTab = screen.getByRole('tab', { name: 'Warranties' });
    expect(warrantiesTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByText('Protected session')).toBeNull();
    expect(await screen.findByText('WCR-2026-000001')).toBeTruthy();
    fireEvent.click(screen.getByText('WCR-2026-000001'));
    let warrantyDialog = await screen.findByRole('dialog', { name: 'WCR-2026-000001' });
    fireEvent.click(within(warrantyDialog).getByRole('button', { name: /New claim/u }));
    const claimDialog = await screen.findByRole('dialog', { name: 'New warranty claim' });
    const claimBody = claimDialog.querySelector('.crm-care-drawer-body');
    const claimForm = claimBody?.querySelector(':scope > .crm-care-form');
    const claimActions = claimForm?.querySelector(':scope > .crm-care-drawer-actions:last-child');
    expect(claimBody).toBeTruthy();
    expect(claimForm).toBeTruthy();
    expect(claimActions).toBeTruthy();
    fireEvent.click(within(claimActions as HTMLElement).getByRole('button', { name: 'Back' }));

    fireEvent.click(screen.getByText('WCR-2026-000001'));
    warrantyDialog = await screen.findByRole('dialog', { name: 'WCR-2026-000001' });
    const offerSelect = warrantyDialog.querySelector('select');
    expect(offerSelect).toBeTruthy();
    fireEvent.change(offerSelect!, { target: { value: 'offered' } });
    fireEvent.click(within(warrantyDialog).getByRole('button', { name: 'Save status' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            url.endsWith(
              '/crm/after-sales/warranty-cards/76d38aa6-ada6-8b23-3c5b-c15be78edc09/offer',
            ) && options?.method === 'POST',
        ),
      ).toBe(true),
    );

    const feedbackTab = await screen.findByRole('tab', { name: 'Feedback & NPS' });
    fireEvent.click(feedbackTab);
    expect(feedbackTab.getAttribute('aria-selected')).toBe('true');
    expect(warrantiesTab.getAttribute('aria-selected')).toBe('false');
    expect(screen.getByText('Net Promoter Score')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Send survey/u }));
    const surveyDialog = await screen.findByRole('dialog', { name: 'Send customer survey' });
    expect(surveyDialog).toBeTruthy();
    expect(
      screen.getByRole('option', { name: /DEV-WO-0001 · completed Service job/u }),
    ).toBeTruthy();
    fireEvent.click(within(surveyDialog).getByRole('button', { name: 'Close panel' }));

    fireEvent.click(screen.getByRole('tab', { name: 'Referrals' }));
    fireEvent.click(screen.getByRole('button', { name: /Record referral/u }));
    expect(await screen.findByRole('dialog', { name: 'Record referral' })).toBeTruthy();
    expect(screen.getByText('A new referral lead will be created automatically.')).toBeTruthy();
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
