import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { messages } from './messages';

afterEach(cleanup);

describe('POS application shell', () => {
  beforeEach(() => {
    sessionStorage.clear();
    storeSession(posContext);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(posContext)));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('presents an authenticated sale terminal without claiming unavailable integrations', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'New sale' })).toBeTruthy();
    expect(screen.getByLabelText('Search or scan')).toBeTruthy();
    expect(screen.getByText('No items in this sale')).toBeTruthy();
    expect(screen.getByText(messages.status)).toBeTruthy();
    expect(screen.getByText('Fiscal device not assigned')).toBeTruthy();
  });

  it('keeps every POS register page reachable from the authenticated terminal navigation', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'New sale' });

    for (const [navigationLabel, heading] of [
      ['Customers & loyalty', 'Customers & loyalty'],
      ['POS reports', 'POS reports'],
      ['Returns', 'Returns & warranty claims'],
      ['Sale history', 'Sale history'],
      ['Shifts', 'Cashier shifts'],
      ['Sync & devices', 'Sync & devices'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: navigationLabel }));
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
  });

  it('clears the POS browser session when the employee signs out', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'New sale' });

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in to continue' })).toBeTruthy();
    expect(sessionStorage.getItem('vista.pos.session.v1')).toBeNull();
  });

  it('signs an employee into the POS terminal only after the backend returns POS access', async () => {
    sessionStorage.clear();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(loginResponse))
      .mockResolvedValueOnce(jsonResponse(posContext));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Sign in to continue' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Work email'), {
      target: { value: 'pos.operator@vista.local' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'ValidPassword!42' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'New sale' })).toBeTruthy();
    expect(screen.getByText('Mila POS')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps an authenticated employee without POS access outside the terminal', async () => {
    const restrictedContext = {
      ...posContext,
      permissions: [{ action: 'view', module: 'crm' }],
    };
    sessionStorage.clear();
    storeSession(restrictedContext);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(restrictedContext)));
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'POS access is not assigned' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'New sale' })).toBeNull();
  });
});

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
  permissions: [{ action: 'view', module: 'pos' }],
  sessionId: '6d2decae-3d3b-4224-9caa-679d51b8e5d3',
  twoFactorVerified: true,
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
