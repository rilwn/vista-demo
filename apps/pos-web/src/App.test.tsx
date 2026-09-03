import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

afterEach(cleanup);

describe('POS application', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    localStorage.clear();
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
    expect(screen.getByText('Test receipt mode')).toBeTruthy();
  });

  it('keeps every available POS area reachable through terminal navigation', async () => {
    installApiMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'New sale' });

    for (const [navigationLabel, heading] of [
      ['Returns', 'Returns'],
      ['Sale history', 'Sale history'],
      ['Shifts', 'Cashier shift'],
      ['Reports', 'Reports'],
    ] as const) {
      fireEvent.click(screen.getByRole('link', { name: navigationLabel }));
      expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
    }
  });

  it('opens a POS route directly after a browser reload', async () => {
    window.history.replaceState(null, '', '/reports');
    installApiMock();
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Reports' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Reports' }).getAttribute('aria-current')).toBe('page');
    expect(window.location.pathname).toBe('/reports');
  });

  it('lets the cashier configure register shortcuts after opening a shift', async () => {
    installApiMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'New sale' });

    fireEvent.click(screen.getByRole('link', { name: 'Shifts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open cashier shift' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit shortcuts' }));

    expect(await screen.findByRole('heading', { name: 'Quick-access products' })).toBeTruthy();
    expect(screen.getByText('1 / 12 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /Demo 12 V Power Adapter/u }));
    expect(screen.getByText('0 / 12 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save shortcuts' }));
    expect(await screen.findByText('Quick-access products updated.')).toBeTruthy();
  });

  it('shows operational shift reporting with clear simulator evidence', async () => {
    installApiMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'New sale' });

    fireEvent.click(screen.getByRole('link', { name: 'Reports' }));
    expect((await screen.findAllByText('Net revenue')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: 'Locations' }));
    expect(screen.getByText('Location sales')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Compare locations' }));
    expect(screen.getByText('Location comparison')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Shifts' }));
    fireEvent.click(screen.getByRole('button', { name: 'View X report' }));

    expect(await screen.findByRole('heading', { name: 'X report' })).toBeTruthy();
    expect(
      screen.getByText('Preview from the test register. No certified H-18 report was issued.'),
    ).toBeTruthy();
    expect(screen.getByText('Expected cash').nextElementSibling?.textContent).toBe('160.00 BGN');
  });

  it('opens a shift, sells a live catalog item for cash, and shows change and receipt', async () => {
    installApiMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'New sale' });

    fireEvent.click(screen.getByRole('link', { name: 'Shifts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open cashier shift' }));

    expect(await screen.findByRole('heading', { name: 'New sale' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /Demo 12 V Power Adapter/u }));
    fireEvent.change(screen.getByLabelText('Cash received'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: /Complete sale · 60.00 BGN/u }));

    expect(await screen.findByRole('heading', { name: sale.fiscalReceiptNumber })).toBeTruthy();
    expect(screen.getByText('40.00 BGN')).toBeTruthy();
    expect(screen.getByText('No certified fiscal receipt was issued.')).toBeTruthy();
  });

  it('guides a cashier through a split cash and card payment', async () => {
    installApiMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'New sale' });

    fireEvent.click(screen.getByRole('link', { name: 'Shifts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open cashier shift' }));
    fireEvent.click(await screen.findByRole('button', { name: /Demo 12 V Power Adapter/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Split' }));
    fireEvent.change(screen.getByLabelText('Cash portion'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Cash received'), { target: { value: '30' } });

    expect(screen.getByText('Card portion').nextElementSibling?.textContent).toBe('40.00 BGN');
    expect(screen.getAllByText('10.00 BGN').length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByRole('button', { name: /Complete sale · 60.00 BGN/u }));
    expect(await screen.findByRole('heading', { name: sale.fiscalReceiptNumber })).toBeTruthy();
  });

  it('shows automatic offers, approved discounts, and a customer rewards ledger', async () => {
    const fetchMock = installApiMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'New sale' });

    fireEvent.click(screen.getByRole('link', { name: 'Shifts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open cashier shift' }));
    fireEvent.click(await screen.findByRole('button', { name: /Demo 12 V Power Adapter/u }));
    fireEvent.click(
      screen.getByRole('button', { name: /Increase Demo 12 V Power Adapter quantity/u }),
    );

    expect(await screen.findByText('Two adapters save 10%')).toBeTruthy();
    expect(screen.getAllByText('−10.00 BGN').length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByRole('button', { name: 'Add customer' }));
    fireEvent.click(await screen.findByRole('button', { name: /Alfa Market Demo Ltd\./u }));
    fireEvent.click(screen.getByRole('button', { name: 'Use customer' }));
    expect(await screen.findByText('300 reward points')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Manual discount/u }));
    const passwordInput = screen.getByLabelText('Password');
    fireEvent.change(passwordInput, { target: { value: 'ValidManagerPassword!42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve discount' }));
    expect(await screen.findByText('Manual discount approved')).toBeTruthy();
    expect(screen.getAllByText(/Vista Demo Manager/u).length).toBeGreaterThanOrEqual(2);

    fireEvent.change(screen.getByLabelText('Points to use'), { target: { value: '100' } });
    expect(await screen.findByText('−1.00 BGN')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /300 reward points/u }));
    expect(await screen.findByRole('heading', { name: 'Alfa Market Demo Ltd.' })).toBeTruthy();
    expect(screen.getByText('Opening reward balance')).toBeTruthy();
    expect(screen.getByText('300 balance')).toBeTruthy();

    expect(
      fetchMock.mock.calls.some(([input]) => {
        const requestUrl =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        return requestUrl.includes('/pos/discount-authorizations');
      }),
    ).toBe(true);
  });

  it('completes a linked receipt return and shows its reversal record', async () => {
    installApiMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'New sale' });

    fireEvent.click(screen.getByRole('link', { name: 'Shifts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open cashier shift' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Returns' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start return' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Demo 12 V Power Adapter/u }));
    fireEvent.click(screen.getByRole('button', { name: /Complete return · 60.00 BGN/u }));

    expect(await screen.findByRole('heading', { name: posReturn.returnNumber })).toBeTruthy();
    expect(screen.getByText(posReturn.fiscalReversalNumber)).toBeTruthy();
    expect(screen.getAllByText('60.00 BGN').length).toBeGreaterThanOrEqual(2);
  });

  it('records the counted drawer amount when the cashier closes a shift', async () => {
    installApiMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'New sale' });

    fireEvent.click(screen.getByRole('link', { name: 'Shifts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open cashier shift' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Shifts' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Open account menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Open the counter' })).toBeTruthy();
    expect(sessionStorage.getItem('vista.pos.session.v1')).toBeNull();
  });

  it('keeps the cashier sound preference with the employee account', async () => {
    installApiMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'New sale' });

    fireEvent.click(screen.getByRole('button', { name: 'Open account menu' }));
    const soundSetting = screen.getByRole('switch', { name: /Sale sounds/u });
    expect(soundSetting.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(soundSetting);

    expect(soundSetting.getAttribute('aria-checked')).toBe('false');
    expect(localStorage.getItem(`vista.pos.preferences.${posContext.accountId}`)).toBe(
      JSON.stringify({ sounds: false }),
    );
  });

  it('signs an employee in only after the backend returns POS access', async () => {
    sessionStorage.clear();
    const fetchMock = installApiMock();
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Open the counter' })).toBeTruthy();
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
    if (url.pathname.endsWith('/pos/quick-access'))
      return jsonResponse({
        cashRegisterId: register.id,
        items: [catalogItem],
        productIds: [catalogItem.id],
      });
    if (url.pathname.endsWith('/pos/baskets/price') && method === 'POST') {
      const requestBody = typeof init?.body === 'string' ? init.body : '{}';
      const body = JSON.parse(requestBody) as {
        lines?: Array<{ quantity: string }>;
        loyaltyPointsToRedeem?: number;
        manualDiscount?: { discountType: string; discountValue: string };
      };
      const quantity = Number(body.lines?.[0]?.quantity ?? 1);
      const base = quantity * 50;
      const automatic = quantity >= 2 ? base * 0.1 : 0;
      const manual = body.manualDiscount
        ? body.manualDiscount.discountType === 'percentage'
          ? (base - automatic) * (Number(body.manualDiscount.discountValue) / 100)
          : Number(body.manualDiscount.discountValue)
        : 0;
      const loyalty = Number(body.loyaltyPointsToRedeem ?? 0) * 0.01;
      const net = base - automatic - manual - loyalty;
      return jsonResponse({
        automaticDiscountTotal: automatic.toFixed(4),
        baseNetTotal: base.toFixed(4),
        grossTotal: (net * 1.2).toFixed(4),
        lines: [
          {
            automaticDiscountTotal: automatic.toFixed(4),
            baseNetTotal: base.toFixed(4),
            grossTotal: (net * 1.2).toFixed(4),
            loyaltyDiscountTotal: loyalty.toFixed(4),
            manualDiscountTotal: manual.toFixed(4),
            netTotal: net.toFixed(4),
            pricingAdjustments: [
              ...(automatic
                ? [
                    {
                      amount: automatic.toFixed(4),
                      code: 'DEMO-QTY-ADAPTER',
                      label: 'Two adapters save 10%',
                      source: 'automatic',
                    },
                  ]
                : []),
            ],
            productId: catalogItem.id,
            vatTotal: (net * 0.2).toFixed(4),
          },
        ],
        loyaltyBalance: customer.loyalty.balance,
        loyaltyDiscountTotal: loyalty.toFixed(4),
        loyaltyPointsRedeemed: Number(body.loyaltyPointsToRedeem ?? 0),
        manualDiscountTotal: manual.toFixed(4),
        netTotal: net.toFixed(4),
        vatTotal: (net * 0.2).toFixed(4),
      });
    }
    if (url.pathname.endsWith('/pos/discount-authorizations') && method === 'POST')
      return jsonResponse(discountAuthorization, 201);
    if (url.pathname.includes('/pos/loyalty/customers/')) return jsonResponse(loyaltyLedger);
    if (url.pathname.endsWith('/pos/reports/reference-data')) return jsonResponse(reportReferences);
    if (url.pathname.endsWith('/pos/reports/overview')) return jsonResponse(reportOverview);
    if (url.pathname.endsWith('/pos/report-exports/definitions'))
      return jsonResponse(reportDefinitions);
    if (url.pathname.endsWith('/pos/report-exports'))
      return jsonResponse({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 });
    if (url.pathname.endsWith('/pos/customers')) return jsonResponse([customer]);
    if (url.pathname.endsWith('/pos/sales') && method === 'POST') return jsonResponse(sale, 201);
    if (url.pathname.endsWith('/pos/sales'))
      return jsonResponse({ items: [sale], page: 1, pageSize: 50, total: 1, totalPages: 1 });
    if (url.pathname.endsWith('/pos/returns') && method === 'POST')
      return jsonResponse(posReturn, 201);
    if (url.pathname.endsWith('/pos/returns'))
      return jsonResponse({ items: [], page: 1, pageSize: 50, total: 0, totalPages: 0 });
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
    { action: 'edit', module: 'pos' },
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
  paymentTerminalLabel: 'Development card terminal',
  paymentTerminalMode: 'simulator',
  serviceReturnWarehouseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  serviceReturnWarehouseName: 'Demo Service Warehouse',
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
  loyalty: {
    balance: 300,
    cardNumber: 'VISTA-DEMO-ALFA',
    id: '89898989-8989-4989-8989-898989898989',
    programName: 'Vista Rewards',
    redemptionValueBgn: '0.0100',
    status: 'active',
  },
  locations: [
    { city: 'Vratsa', id: '99999999-9999-4999-8999-999999999999', name: 'Central Store' },
  ],
  name: 'Alfa Market Demo Ltd.',
  uic: '206666666',
};
const sale = {
  automaticDiscountTotal: '0.0000',
  baseNetTotal: '50.0000',
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
      automaticDiscountTotal: '0.0000',
      baseNetTotal: '50.0000',
      grossTotal: '60.0000',
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      loyaltyDiscountTotal: '0.0000',
      manualDiscountTotal: '0.0000',
      netTotal: '50.0000',
      productCode: catalogItem.productCode,
      productId: catalogItem.id,
      productName: catalogItem.name,
      pricingAdjustments: [],
      quantity: '1.0000',
      returnableQuantity: '1.0000',
      returnableSerialNumbers: [],
      returnedQuantity: '0.0000',
      serialNumbers: [],
      unitPrice: '50.0000',
      vatTotal: '10.0000',
      vatTreatment: 'standard_20',
    },
  ],
  loyaltyDiscountTotal: '0.0000',
  loyaltyPointsEarned: 0,
  loyaltyPointsRedeemed: 0,
  manualDiscountTotal: '0.0000',
  netTotal: '50.0000',
  payments: [
    {
      adapter: 'cash-drawer',
      amount: '60.0000',
      changeAmount: '40.0000',
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      method: 'cash',
      refundableAmount: '60.0000',
      status: 'completed',
      tenderedAmount: '100.0000',
    },
  ],
  saleNumber: 'SALE-POS-01-POS-01-2026-000001',
  shiftId: shift.id,
  status: 'completed',
  vatTotal: '10.0000',
};

const posReturn = {
  completedAt: '2026-09-02T12:20:00.000Z',
  fiscalAdapter: 'development-simulator',
  fiscalReversalNumber: 'SIM-REVERSAL-POS-01-POS-01-2026-000001',
  grossTotal: '60.0000',
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  lines: [
    {
      destinationWarehouseId: register.warehouseId,
      destinationWarehouseName: register.warehouseName,
      disposition: 'restock',
      grossTotal: '60.0000',
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      netTotal: '50.0000',
      originalSaleLineId: sale.lines[0]!.id,
      productCode: catalogItem.productCode,
      productId: catalogItem.id,
      productName: catalogItem.name,
      quantity: '1.0000',
      serialNumbers: [],
      vatTotal: '10.0000',
    },
  ],
  loyaltyPointsEarnedReversed: 0,
  loyaltyPointsRedeemedRestored: 0,
  netTotal: '50.0000',
  originalSaleId: sale.id,
  originalSaleNumber: sale.saleNumber,
  reason: 'Customer returned the item',
  refunds: [
    {
      adapter: 'cash-drawer',
      amount: '60.0000',
      id: '12121212-1212-4212-8212-121212121212',
      method: 'cash',
      status: 'completed',
    },
  ],
  returnNumber: 'RETURN-POS-01-POS-01-2026-000001',
  shiftId: shift.id,
  vatTotal: '10.0000',
};

const discountAuthorization = {
  approverName: 'Vista Demo Manager',
  discountType: 'percentage',
  discountValue: '10.0000',
  expiresAt: '2026-09-02T12:15:00.000Z',
  id: '13131313-1313-4313-8313-131313131313',
  reason: 'Customer care discount',
};

const loyaltyLedger = {
  account: customer.loyalty,
  entries: [
    {
      balanceAfter: 300,
      entryType: 'adjustment',
      id: '14141414-1414-4414-8414-141414141414',
      occurredAt: '2026-09-02T10:00:00.000Z',
      points: 300,
      reason: 'Opening reward balance',
    },
  ],
};

const reportReferences = {
  businessTimezone: 'Europe/Sofia',
  locations: [{ id: register.businessLocationId, name: register.businessLocationName }],
  operators: [
    {
      businessLocationId: register.businessLocationId,
      code: register.operatorCode,
      id: register.operatorId,
      name: 'Mila POS',
    },
  ],
  registers: [
    {
      businessLocationId: register.businessLocationId,
      code: register.code,
      id: register.id,
      name: register.name,
    },
  ],
};

const reportShift = {
  cashRegisterCode: register.code,
  cashRegisterId: register.id,
  cashRegisterName: register.name,
  cashRefundsBgn: '0.0000',
  cashSalesBgn: '60.0000',
  expectedCashBgn: '160.0000',
  fiscalMode: 'simulator',
  grossReturnsBgn: '0.0000',
  grossSalesBgn: '60.0000',
  id: shift.id,
  locationName: register.businessLocationName,
  netRevenueBgn: '60.0000',
  openedAt: shift.openedAt,
  openingCashBgn: '100.0000',
  operatorCode: register.operatorCode,
  operatorId: register.operatorId,
  operatorName: 'Mila POS',
  reportType: 'x',
  returnCount: 0,
  saleCount: 1,
  shiftNumber: shift.shiftNumber,
  status: 'open',
};

const reportOverview = {
  cashiers: [],
  categories: [],
  dateFrom: '2026-08-05',
  dateTo: '2026-09-03',
  generatedAt: '2026-09-03T12:00:00.000Z',
  locations: [],
  payments: [],
  products: [],
  shifts: [reportShift],
  timezone: 'Europe/Sofia',
  totals: {
    averageSaleBgn: '60.0000',
    grossReturnsBgn: '0.0000',
    grossSalesBgn: '60.0000',
    itemQuantityReturned: '0.0000',
    itemQuantitySold: '1.0000',
    netRevenueBgn: '60.0000',
    netSalesBgn: '50.0000',
    returnCount: 0,
    saleCount: 1,
    vatSalesBgn: '10.0000',
  },
};

const reportDefinitions = [
  {
    description: 'Opening, takings, refunds, expected cash, and closing differences by shift.',
    formats: ['csv', 'xlsx', 'pdf'],
    key: 'pos.shift-register',
    name: 'Shift register',
    requiresDateRange: true,
    requiresShift: false,
  },
  {
    description: 'Sales, returns, and net revenue by business location.',
    formats: ['csv', 'xlsx', 'pdf'],
    key: 'pos.location-sales',
    name: 'Location sales',
    requiresDateRange: true,
    requiresShift: false,
  },
  {
    description: 'Comparable transaction count and revenue measures across locations.',
    formats: ['csv', 'xlsx', 'pdf'],
    key: 'pos.location-comparison',
    name: 'Location comparison',
    requiresDateRange: true,
    requiresShift: false,
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

function storeSession(context: typeof posContext): void {
  sessionStorage.setItem('vista.pos.session.v1', JSON.stringify({ ...loginResponse, context }));
}
