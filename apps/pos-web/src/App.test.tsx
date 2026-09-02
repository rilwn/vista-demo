import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

afterEach(cleanup);

describe('POS application', () => {
  beforeEach(() => {
    sessionStorage.clear();
    storeSession(posContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('guides an authenticated cashier to open the assigned register', async () => {
    installApiMock();
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'New sale' })).toBeTruthy();
    expect(screen.getByLabelText('Search or scan').hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('heading', { name: 'The counter is closed' })).toBeTruthy();
    expect(screen.getByText('Development receipt simulator')).toBeTruthy();
  });

  it('keeps every available POS area reachable through terminal navigation', async () => {
    installApiMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'New sale' });

    for (const [navigationLabel, heading] of [
      ['Sale history', 'Sale history'],
      ['Shifts', 'Cashier shift'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: navigationLabel }));
      expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
    }
  });

  it('opens a shift, sells a live catalog item for cash, and shows change and receipt', async () => {
    installApiMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'New sale' });

    fireEvent.click(screen.getByRole('button', { name: 'Shifts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open cashier shift' }));

    expect(await screen.findByRole('heading', { name: 'New sale' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /Demo 12 V Power Adapter/u }));
    fireEvent.change(screen.getByLabelText('Cash received'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: /Pay cash · 60.00 BGN/u }));

    expect(await screen.findByRole('heading', { name: sale.fiscalReceiptNumber })).toBeTruthy();
    expect(screen.getByText('40.00 BGN')).toBeTruthy();
    expect(screen.getByText('No certified fiscal receipt was issued.')).toBeTruthy();
  });

  it('records the counted drawer amount when the cashier closes a shift', async () => {
    installApiMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'New sale' });

    fireEvent.click(screen.getByRole('button', { name: 'Shifts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open cashier shift' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Shifts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close cashier shift' }));

    expect(await screen.findByRole('button', { name: 'Open cashier shift' })).toBeTruthy();
    expect(
      screen.getByText('Cashier shift closed and the drawer count was recorded.'),
    ).toBeTruthy();
  });

  it('clears the browser session when the cashier signs out', async () => {
    installApiMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'New sale' });

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in to continue' })).toBeTruthy();
    expect(sessionStorage.getItem('vista.pos.session.v1')).toBeNull();
  });

  it('signs an employee in only after the backend returns POS access', async () => {
    sessionStorage.clear();
    const fetchMock = installApiMock();
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Sign in to continue' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Work email'), {
      target: { value: 'pos.operator@vista.local' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'ValidPassword!42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'New sale' })).toBeTruthy();
    expect(screen.getByText('Mila POS')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('keeps an employee without POS access outside the terminal', async () => {
    const restrictedContext = { ...posContext, permissions: [{ action: 'view', module: 'crm' }] };
    storeSession(restrictedContext);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(restrictedContext)));
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'POS access is not assigned' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'New sale' })).toBeNull();
  });
});

function installApiMock() {
  let shiftOpen = false;
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      'http://localhost',
    );
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (url.pathname.endsWith('/auth/login')) return jsonResponse(loginResponse);
    if (url.pathname.endsWith('/auth/me')) return jsonResponse(posContext);
    if (url.pathname.endsWith('/auth/logout')) return new Response(null, { status: 204 });
    if (url.pathname.endsWith('/pos/terminal-context'))
      return jsonResponse({ ...(shiftOpen ? { currentShift: shift } : {}), registers: [register] });
    if (url.pathname.endsWith('/pos/shifts') && method === 'POST') {
      shiftOpen = true;
      return jsonResponse(shift, 201);
    }
    if (/\/pos\/shifts\/[^/]+\/close$/u.test(url.pathname) && method === 'POST') {
      shiftOpen = false;
      return jsonResponse({
        ...shift,
        closedAt: '2026-09-02T13:00:00.000Z',
        closingCashBgn: shift.expectedCashBgn,
        status: 'closed',
        version: 2,
      });
    }
    if (url.pathname.endsWith('/pos/catalog'))
      return jsonResponse({
        items: [catalogItem],
        page: 1,
        pageSize: 100,
        total: 1,
        totalPages: 1,
      });
    if (url.pathname.endsWith('/pos/customers')) return jsonResponse([customer]);
    if (url.pathname.endsWith('/pos/sales') && method === 'POST') return jsonResponse(sale, 201);
    if (url.pathname.endsWith('/pos/sales'))
      return jsonResponse({ items: [sale], page: 1, pageSize: 50, total: 1, totalPages: 1 });
    return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Unexpected test request' } }, 404);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const loginResponse = {
  account: {
    displayName: 'Mila POS',
    email: 'pos.operator@vista.local',
    id: 'a9f0cc4c-aefa-42fb-9d44-76b4aacba43d',
    isAdministrative: false,
  },
  expiresAt: '2099-08-06T12:00:00.000Z',
  sessionToken: 'opaque-pos-session',
};
const posContext = {
  accountId: loginResponse.account.id,
  displayName: loginResponse.account.displayName,
  email: loginResponse.account.email,
  employeeId: '126e0897-4ed2-46d5-9bfb-1c42e7f24839',
  isAdministrative: false,
  permissions: [
    { action: 'view', module: 'pos' },
    { action: 'create', module: 'pos' },
  ],
  sessionId: '6d2decae-3d3b-4224-9caa-679d51b8e5d3',
  twoFactorVerified: true,
};
const register = {
  businessLocationId: '11111111-1111-4111-8111-111111111111',
  businessLocationName: 'Vratsa Service & Retail Centre',
  code: 'POS-01',
  fiscalDeviceLabel: 'Vista development receipt simulator',
  fiscalMode: 'simulator',
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Demo POS terminal',
  operatorCode: 'POS-01',
  operatorId: '33333333-3333-4333-8333-333333333333',
  warehouseId: '44444444-4444-4444-8444-444444444444',
  warehouseName: 'Demo Central Warehouse',
};
const shift = {
  cashRegisterId: register.id,
  cashRegisterName: register.name,
  expectedCashBgn: '100.0000',
  id: '55555555-5555-4555-8555-555555555555',
  openedAt: '2026-09-02T12:00:00.000Z',
  openingCashBgn: '100.0000',
  operatorCode: register.operatorCode,
  operatorId: register.operatorId,
  shiftNumber: 'SHIFT-POS-01-POS-01-2026-000001',
  status: 'open',
  version: 1,
  warehouseId: register.warehouseId,
  warehouseName: register.warehouseName,
};
const catalogItem = {
  availableQuantity: '12.0000',
  barcodes: ['3801234567898'],
  batches: [],
  currencyCode: 'BGN',
  id: '66666666-6666-4666-8666-666666666666',
  name: 'Demo 12 V Power Adapter',
  priceListId: '77777777-7777-4777-8777-777777777777',
  priceListName: 'Demo counter prices',
  productCode: 'DEV-ADAPTER-12V',
  serialNumbers: [],
  trackingMode: 'none',
  unitCode: 'PCS',
  unitPrice: '50.0000',
  vatTreatment: 'standard_20',
};
const customer = {
  id: '88888888-8888-4888-8888-888888888888',
  locations: [
    { city: 'Vratsa', id: '99999999-9999-4999-8999-999999999999', name: 'Central Store' },
  ],
  name: 'Alfa Market Demo Ltd.',
  uic: '206666666',
};
const sale = {
  cashTendered: '100.0000',
  changeAmount: '40.0000',
  completedAt: '2026-09-02T12:10:00.000Z',
  currencyCode: 'BGN',
  fiscalAdapter: 'development-simulator',
  fiscalReceiptNumber: 'SIM-RECEIPT-POS-01-POS-01-2026-000001',
  fiscalStatus: 'simulated',
  grossTotal: '60.0000',
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  lines: [
    {
      grossTotal: '60.0000',
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      netTotal: '50.0000',
      productCode: catalogItem.productCode,
      productId: catalogItem.id,
      productName: catalogItem.name,
      quantity: '1.0000',
      serialNumbers: [],
      unitPrice: '50.0000',
      vatTotal: '10.0000',
      vatTreatment: 'standard_20',
    },
  ],
  netTotal: '50.0000',
  saleNumber: 'SALE-POS-01-POS-01-2026-000001',
  shiftId: shift.id,
  status: 'completed',
  vatTotal: '10.0000',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

function storeSession(context: typeof posContext): void {
  sessionStorage.setItem('vista.pos.session.v1', JSON.stringify({ ...loginResponse, context }));
}
