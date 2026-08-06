import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
      .mockResolvedValueOnce(jsonResponse(partnerPage));
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

    const listRequest = fetchMock.mock.calls[1];
    expect(listRequest?.[0]).toContain('/api/v1/master-data/partners?');
    expect(new Headers((listRequest?.[1] as RequestInit).headers).get('Authorization')).toBe(
      `Bearer ${loginResponse.sessionToken}`,
    );
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
