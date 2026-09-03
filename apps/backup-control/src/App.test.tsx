import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { messages } from './messages';

afterEach(cleanup);

describe('backup-control application shell', () => {
  beforeEach(() => {
    sessionStorage.clear();
    storeSession(backupContext);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(backupContext)));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('presents an authenticated backup and disaster-recovery workspace', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Backup operations' })).toBeTruthy();
    expect(screen.getByText(messages.status)).toBeTruthy();
    expect(screen.getByText('Source inventory')).toBeTruthy();
    expect(screen.getByText('No records yet')).toBeTruthy();
  });

  it('keeps every backup and recovery page reachable from the authenticated navigation', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });

    for (const [navigationLabel, heading] of [
      ['Restores & approvals', 'Restore requests & approvals'],
      ['Alerts & audit', 'Alerts & audit'],
      ['DR tests', 'Disaster recovery tests'],
      ['Jobs & restore points', 'Jobs & restore points'],
      ['Policies & schedules', 'Policies & schedules'],
      ['Sources & inventory', 'Sources & data inventory'],
      ['Overview', 'Backup operations'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: navigationLabel }));
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
  });

  it('clears the Backup Control browser session when the employee signs out', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Open recovery centre' })).toBeTruthy();
    expect(sessionStorage.getItem('vista.backup-control.session.v1')).toBeNull();
  });

  it('signs an employee into Backup Control only after the backend returns backup access', async () => {
    sessionStorage.clear();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(loginResponse))
      .mockResolvedValueOnce(jsonResponse(backupContext));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Open recovery centre' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Work email'), {
      target: { value: 'backup.operator@vista.local' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'ValidPassword!42' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Backup operations' })).toBeTruthy();
    expect(screen.getByText('Mila Backup')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps an authenticated employee without Backup Control access outside the console', async () => {
    const restrictedContext = {
      ...backupContext,
      permissions: [{ action: 'view', module: 'crm' }],
    };
    sessionStorage.clear();
    storeSession(restrictedContext);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(restrictedContext)));
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Backup access is not assigned' }),
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Backup operations' })).toBeNull();
  });
});

const loginResponse = {
  account: {
    displayName: 'Mila Backup',
    email: 'backup.operator@vista.local',
    id: '0d2a311e-6df2-482a-9e0b-855074b4b999',
    isAdministrative: false,
  },
  expiresAt: '2099-08-06T12:00:00.000Z',
  sessionToken: 'opaque-backup-session',
};

const backupContext = {
  accountId: loginResponse.account.id,
  displayName: loginResponse.account.displayName,
  email: loginResponse.account.email,
  employeeId: '0f4d5ad3-b55c-4a57-9a6e-ec2d0da8874d',
  isAdministrative: false,
  permissions: [{ action: 'view', module: 'backup' }],
  sessionId: '95aa43ee-875c-455b-9543-9be89b882e10',
  twoFactorVerified: true,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

function storeSession(context: typeof backupContext): void {
  sessionStorage.setItem(
    'vista.backup-control.session.v1',
    JSON.stringify({ ...loginResponse, context }),
  );
}
