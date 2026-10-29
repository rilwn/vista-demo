import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BackupRestoreRequest } from '@vista/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { LocalizationProvider } from './i18n/LocalizationProvider';
import { messages } from './messages';

afterEach(cleanup);

describe('backup-control application shell', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.setItem('vista.recovery.locale', 'en');
    storeSession(backupContext);
    vi.stubGlobal('fetch', createFetchMock(backupContext));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('presents an authenticated backup and disaster-recovery workspace', async () => {
    render(
      <LocalizationProvider>
        <App />
      </LocalizationProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Backup operations' })).toBeTruthy();
    expect(screen.getByText(messages.status)).toBeTruthy();
    expect(screen.getByText('Source inventory')).toBeTruthy();
    expect(screen.getByText('No records yet')).toBeTruthy();
  });

  it('does not open Recovery for a backup role with a password-only session', async () => {
    const context = { ...backupContext, twoFactorVerified: false };
    storeSession(context);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(context)));
    render(<App />);
    expect(await screen.findByRole('heading', { name: messages.mfaRequiredTitle })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Backup control navigation' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('keeps every backup and recovery page reachable from the authenticated navigation', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });

    for (const [navigationLabel, heading] of [
      ['Policy approvals', 'Backup policy approvals'],
      ['Restores & approvals', 'Restore requests & approvals'],
      ['Alerts & audit', 'Alerts & audit'],
      ['DR tests', 'Disaster recovery tests'],
      ['Plan review', 'Backup plan review'],
      ['Jobs & restore points', 'Jobs & restore points'],
      ['Policies & schedules', 'Policies & schedules'],
      ['Sources & inventory', 'Sources & data inventory'],
      ['Overview', 'Backup operations'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: navigationLabel }));
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
  });

  it('records the annual backup-plan review only for an approver', async () => {
    sessionStorage.clear();
    const context = {
      ...backupContext,
      permissions: [
        { action: 'view' as const, module: 'backup' as const },
        { action: 'approve' as const, module: 'backup' as const },
      ],
    };
    storeSession(context);
    const fetchMock = createFetchMock(context);
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.click(screen.getByRole('button', { name: 'Plan review' }));

    expect(await screen.findByRole('heading', { name: 'Backup plan review' })).toBeTruthy();
    expect(await screen.findByText('Vista database')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Record review' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Review summary' }), {
      target: {
        value: 'Protected sources and policies were checked against the approved backup plan.',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save signed review' }));

    expect((await screen.findByRole('status')).textContent).toContain(
      'Backup plan review recorded. The signed record is now available in the review history.',
    );
    const reviewWrite = fetchMock.mock.calls.find(
      ([url, init]) =>
        requestUrl(url).endsWith('/api/v1/backup/plan-reviews') && init?.method === 'POST',
    );
    expect(parseJsonBody(reviewWrite?.[1]?.body)).toEqual({
      outcome: 'approved',
      summary: 'Protected sources and policies were checked against the approved backup plan.',
    });
  });

  it('shows the backup run register in Jobs & restore points', async () => {
    const fetchMock = createFetchMock(backupContext);
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.click(screen.getByRole('button', { name: 'Jobs & restore points' }));

    expect(await screen.findByRole('heading', { name: 'No backup runs yet' })).toBeTruthy();
    expect(
      screen.getByText(
        'Activate an approved schedule for a supported source to create the first restore point.',
      ),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/backup/runs'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('lets an authorised backup user request separately approved removal of a restore point', async () => {
    sessionStorage.clear();
    const context = {
      ...backupContext,
      permissions: [
        { action: 'view' as const, module: 'backup' as const },
        { action: 'edit' as const, module: 'backup' as const },
      ],
    };
    storeSession(context);
    const fetchMock = createFetchMock(context, false, false, false, true);
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.click(screen.getByRole('button', { name: 'Jobs & restore points' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Request removal' }));
    expect(
      await screen.findByRole('heading', { name: 'Request restore-point removal' }),
    ).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'This old test restore point is no longer required.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send removal request' }));

    expect((await screen.findByRole('status')).textContent).toContain(
      'Restore-point removal sent for independent approval. The copy remains available until approved.',
    );
    const request = fetchMock.mock.calls.find(
      ([url, init]) => requestUrl(url).endsWith('/deletion-requests') && init?.method === 'POST',
    );
    expect(parseJsonBody(request?.[1]?.body)).toEqual({
      reason: 'This old test restore point is no longer required.',
    });
  });

  it('lets an authorised employee request an isolated restore from a verified backup', async () => {
    sessionStorage.clear();
    const context = {
      ...backupContext,
      permissions: [
        { action: 'view', module: 'backup' },
        { action: 'create', module: 'backup' },
      ],
    };
    storeSession(context);
    const fetchMock = createFetchMock(context, false, false, false, true);
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.click(screen.getByRole('button', { name: 'Jobs & restore points' }));
    expect(await screen.findByText('PostgreSQL archive compression')).toBeTruthy();
    expect(screen.getByText('Original data size')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Request restore' }));
    expect(await screen.findByRole('heading', { name: 'Request database restore' })).toBeTruthy();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Reason for restore *' }), {
      target: { value: 'Verify the latest database recovery before release.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send restore request' }));

    expect((await screen.findByRole('status')).textContent).toContain(
      'Restore request sent for independent approval.',
    );
    const requestWrite = fetchMock.mock.calls.find(
      ([url, init]) => requestUrl(url).includes('/restore-requests') && init?.method === 'POST',
    );
    expect(parseJsonBody(requestWrite?.[1]?.body)).toEqual({
      reason: 'Verify the latest database recovery before release.',
    });
  });

  it('keeps full file-store recovery available for an authorised employee', async () => {
    sessionStorage.clear();
    const context = {
      ...backupContext,
      permissions: [
        { action: 'view', module: 'backup' },
        { action: 'create', module: 'backup' },
      ],
    };
    storeSession(context);
    const fetchMock = createFetchMock(context, false, false, false, false, false, true);
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.click(screen.getByRole('button', { name: 'Jobs & restore points' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Request restore' }));
    expect(await screen.findByRole('heading', { name: 'Request file-store restore' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Restore scope/u, { selector: 'select' }), {
      target: { value: 'complete' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason for restore *' }), {
      target: { value: 'Recover the complete file-store snapshot in isolation.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send restore request' }));

    expect((await screen.findByRole('status')).textContent).toContain(
      'Restore request sent for independent approval.',
    );
    const requestWrite = fetchMock.mock.calls.find(
      ([url, init]) => requestUrl(url).includes('/restore-requests') && init?.method === 'POST',
    );
    expect(parseJsonBody(requestWrite?.[1]?.body)).toEqual({
      reason: 'Recover the complete file-store snapshot in isolation.',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Restores & approvals' }));
    expect(await screen.findByText('Complete file-store snapshot')).toBeTruthy();
  });

  it('lets an authorised employee select one file for isolated recovery', async () => {
    sessionStorage.clear();
    const context = {
      ...backupContext,
      permissions: [
        { action: 'view', module: 'backup' },
        { action: 'create', module: 'backup' },
      ],
    };
    storeSession(context);
    const fetchMock = createFetchMock(context, false, false, false, false, false, true);
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.click(screen.getByRole('button', { name: 'Jobs & restore points' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Request restore' }));
    expect(await screen.findByRole('heading', { name: 'Request file-store restore' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Restore scope/u, { selector: 'select' }), {
      target: { value: 'file' },
    });
    expect(document.querySelector('#backup-restore-file-search')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Search files in restore point/u), {
      target: { value: 'demo-evidence' },
    });
    await screen.findByRole('option', {
      name: 'partners/demo-evidence.pdf · 32 bytes',
      hidden: true,
    });
    fireEvent.change(screen.getByLabelText(/File to restore/u, { selector: 'select' }), {
      target: { value: 'partners/demo-evidence.pdf' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason for restore *' }), {
      target: { value: 'Recover one customer evidence file in an isolated location.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send restore request' }));

    expect((await screen.findByRole('status')).textContent).toContain(
      'Restore request sent for independent approval.',
    );
    const requestWrite = fetchMock.mock.calls.find(
      ([url, init]) => requestUrl(url).includes('/restore-requests') && init?.method === 'POST',
    );
    expect(parseJsonBody(requestWrite?.[1]?.body)).toEqual({
      objectKey: 'partners/demo-evidence.pdf',
      reason: 'Recover one customer evidence file in an isolated location.',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Restores & approvals' }));
    expect(await screen.findByText('File selected for recovery:')).toBeTruthy();
    expect(screen.getByText('partners/demo-evidence.pdf')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/file-restore-options?search=demo-evidence'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('opens the DR-test planning form only for a user with backup create access', async () => {
    sessionStorage.clear();
    const context = {
      ...backupContext,
      permissions: [
        { action: 'view', module: 'backup' },
        { action: 'create', module: 'backup' },
      ],
    };
    storeSession(context);
    vi.stubGlobal('fetch', createFetchMock(context, false, false, false, true));
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.click(screen.getByRole('button', { name: 'DR tests' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Plan DR test' }));

    expect(
      await screen.findByRole('heading', { name: 'Plan disaster-recovery test' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Plan test' }).hasAttribute('disabled')).toBe(false);
  });

  it('lets a different authorised person approve a restore request', async () => {
    sessionStorage.clear();
    const context = {
      ...backupContext,
      permissions: [
        { action: 'view', module: 'backup' },
        { action: 'approve', module: 'backup' },
      ],
    };
    storeSession(context);
    const fetchMock = createFetchMock(context, false, false, false, false, true);
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.click(screen.getByRole('button', { name: 'Restores & approvals' }));
    expect(
      await screen.findByText('Restore this verified backup in isolation for release testing.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve restore' }));

    expect(
      await screen.findByText('Restore approved. The isolated restore will start automatically.'),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        `/api/v1/backup/restore-requests/${restoreRequestFixture.id}/decision`,
      ),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('downloads a completed file restore from its isolated recovery location', async () => {
    sessionStorage.clear();
    storeSession(backupContext);
    const fetchMock = createFetchMock(
      backupContext,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    );
    vi.stubGlobal('fetch', fetchMock);
    const createObjectURL = vi.fn(() => 'blob:recovered-file');
    const revokeObjectURL = vi.fn();
    class TestURL extends URL {}
    Object.assign(TestURL, { createObjectURL, revokeObjectURL });
    vi.stubGlobal('URL', TestURL);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.click(screen.getByRole('button', { name: 'Restores & approvals' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Download recovered file' }));

    expect(await screen.findByText('The recovered file download has started.')).toBeTruthy();
    const downloadCall = fetchMock.mock.calls.find(([input]) =>
      requestUrl(input).includes(
        `/backup/restore-requests/${completedFileRestoreFixture.id}/download`,
      ),
    );
    expect(downloadCall?.[1]?.headers).toBeDefined();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:recovered-file'), {
      timeout: 2_000,
    });
  });

  it('recovers an individual database record from the isolated database copy', async () => {
    sessionStorage.clear();
    storeSession(backupContext);
    const fetchMock = createFetchMock(
      backupContext,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    );
    vi.stubGlobal('fetch', fetchMock);
    const createObjectURL = vi.fn(() => 'blob:recovered-record');
    const revokeObjectURL = vi.fn();
    class TestURL extends URL {}
    Object.assign(TestURL, { createObjectURL, revokeObjectURL });
    vi.stubGlobal('URL', TestURL);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.click(screen.getByRole('button', { name: 'Restores & approvals' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Recover one database record' }));

    fireEvent.change(await screen.findByRole('combobox', { name: 'Database table' }), {
      target: { value: 'public.customers' },
    });
    fireEvent.change(screen.getByLabelText(/Primary-key value: id/u), {
      target: { value: 'customer-42' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download record' }));

    expect(
      await screen.findByText('The recovered database record download has started.'),
    ).toBeTruthy();
    const recordRequest = fetchMock.mock.calls.find(
      ([url, init]) => requestUrl(url).endsWith('/database/record') && init?.method === 'POST',
    );
    expect(parseJsonBody(recordRequest?.[1]?.body)).toEqual({
      primaryKey: { id: 'customer-42' },
      tableName: 'public.customers',
    });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:recovered-record'), {
      timeout: 2_000,
    });
  });

  it('clears the Backup Control browser session when the employee signs out', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Open recovery centre' })).toBeTruthy();
    expect(sessionStorage.getItem('vista.backup-control.session.v1')).toBeNull();
  });

  it('opens an area from the topbar and keeps its navigation state in sync', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.change(screen.getByLabelText(messages.chooseArea), { target: { value: 'policies' } });
    expect(screen.getByRole('heading', { name: 'Policies & schedules' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Policies & schedules' }).getAttribute('aria-current'),
    ).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'Sources & inventory' }));
    expect(screen.getByLabelText<HTMLSelectElement>(messages.chooseArea).value).toBe('sources');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add source' }).disabled).toBe(
      true,
    );
  });

  it('lets a backup administrator add a protected source and shows the saved record', async () => {
    sessionStorage.clear();
    const context = {
      ...backupContext,
      permissions: [
        { action: 'view', module: 'backup' },
        { action: 'create', module: 'backup' },
        { action: 'edit', module: 'backup' },
      ],
    };
    storeSession(context);
    const fetchMock = createFetchMock(context);
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.click(screen.getByRole('button', { name: 'Sources & inventory' }));
    await screen.findByRole('heading', { name: 'No protected sources yet' });
    fireEvent.click(screen.getByRole('button', { name: 'Add source' }));
    fireEvent.change(screen.getByLabelText('Source code *'), { target: { value: 'VISTA-DB' } });
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Vista database' } });
    fireEvent.change(screen.getByLabelText('Location / system *'), {
      target: { value: 'Coolify PostgreSQL' },
    });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add source' }));

    expect(await screen.findByText('Vista database')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/backup/sources'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('records a mounted shared folder relative to the read-only source root', async () => {
    sessionStorage.clear();
    const context = {
      ...backupContext,
      permissions: [
        { action: 'view', module: 'backup' },
        { action: 'create', module: 'backup' },
        { action: 'edit', module: 'backup' },
      ],
    };
    storeSession(context);
    const fetchMock = createFetchMock(context);
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.click(screen.getByRole('button', { name: 'Sources & inventory' }));
    await screen.findByRole('heading', { name: 'No protected sources yet' });
    fireEvent.click(screen.getByRole('button', { name: 'Add source' }));
    fireEvent.change(screen.getByLabelText('Source code *'), {
      target: { value: 'VISTA-FINANCE-SHARE' },
    });
    fireEvent.change(screen.getByLabelText('Name *'), {
      target: { value: 'Finance shared folder' },
    });
    const sourceType = screen.getByLabelText<HTMLSelectElement>('Source type *');
    fireEvent.change(sourceType, {
      target: { value: 'server' },
    });
    expect(sourceType.value).toBe('server');
    const location = screen.getByRole('textbox', { name: 'Path under mounted read-only root' });
    expect(
      screen.getByText(
        'This path is relative to BACKUP_FILE_SOURCE_ROOT. Mount the source or its exported snapshot read-only in the API container. Live device and server snapshots must be created by the source system before this backup runs.',
      ),
    ).toBeTruthy();
    fireEvent.change(location, {
      target: { value: 'finance' },
    });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add source' }));

    expect(await screen.findByText('Finance shared folder')).toBeTruthy();
    const sourceWrite = fetchMock.mock.calls.find(
      ([url, init]) =>
        requestUrl(url).endsWith('/api/v1/backup/sources') && init?.method === 'POST',
    );
    expect(parseJsonBody(sourceWrite?.[1]?.body)).toMatchObject({
      location: 'finance',
      sourceCode: 'VISTA-FINANCE-SHARE',
      sourceType: 'server',
    });
  });

  it('records an email source using its IMAP address while keeping credentials out of the form', async () => {
    sessionStorage.clear();
    const context = {
      ...backupContext,
      permissions: [
        { action: 'view', module: 'backup' },
        { action: 'create', module: 'backup' },
        { action: 'edit', module: 'backup' },
      ],
    };
    storeSession(context);
    const fetchMock = createFetchMock(context);
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.click(screen.getByRole('button', { name: 'Sources & inventory' }));
    await screen.findByRole('heading', { name: 'No protected sources yet' });
    fireEvent.click(screen.getByRole('button', { name: 'Add source' }));
    fireEvent.change(screen.getByLabelText('Source code *'), {
      target: { value: 'VISTA-MAIL-01' },
    });
    fireEvent.change(screen.getByLabelText('Name *'), {
      target: { value: 'Vista service mailbox' },
    });
    fireEvent.change(screen.getByLabelText('Source type *'), {
      target: { value: 'email' },
    });
    const location = screen.getByRole('textbox', { name: 'IMAP server address' });
    expect(
      screen.getByText(
        'Use the configured IMAP address. Mailbox names and credentials are kept in deployment secrets; choose only mailboxes approved for backup.',
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/password|mailbox names/u)).toBeNull();
    fireEvent.change(location, { target: { value: 'imaps://mail.example.invalid:993' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add source' }));

    expect(await screen.findByText('Vista service mailbox')).toBeTruthy();
    const sourceWrite = fetchMock.mock.calls.find(
      ([url, init]) =>
        requestUrl(url).endsWith('/api/v1/backup/sources') && init?.method === 'POST',
    );
    expect(parseJsonBody(sourceWrite?.[1]?.body)).toMatchObject({
      location: 'imaps://mail.example.invalid:993',
      sourceCode: 'VISTA-MAIL-01',
      sourceType: 'email',
    });
    expect(JSON.stringify(parseJsonBody(sourceWrite?.[1]?.body))).not.toContain('not-for-logs');
  });

  it('records a WebDAV cloud folder while keeping endpoint credentials out of the form', async () => {
    sessionStorage.clear();
    const context = {
      ...backupContext,
      permissions: [
        { action: 'view', module: 'backup' },
        { action: 'create', module: 'backup' },
        { action: 'edit', module: 'backup' },
      ],
    };
    storeSession(context);
    const fetchMock = createFetchMock(context);
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.click(screen.getByRole('button', { name: 'Sources & inventory' }));
    await screen.findByRole('heading', { name: 'No protected sources yet' });
    fireEvent.click(screen.getByRole('button', { name: 'Add source' }));
    fireEvent.change(screen.getByLabelText('Source code *'), {
      target: { value: 'CLOUD-DOCUMENTS' },
    });
    fireEvent.change(screen.getByLabelText('Name *'), {
      target: { value: 'Shared cloud documents' },
    });
    fireEvent.change(screen.getByLabelText('Source type *'), {
      target: { value: 'cloud_service' },
    });
    expect(
      screen.getByText(
        'Enter a folder beneath the configured WebDAV endpoint. Keep the endpoint and read-only credentials in deployment secrets; HTTPS is required outside local testing.',
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.queryByLabelText('Username')).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Folder under WebDAV endpoint' }), {
      target: { value: 'Shared/Reports' },
    });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add source' }));

    expect(await screen.findByText('Shared cloud documents')).toBeTruthy();
    const sourceWrite = fetchMock.mock.calls.find(
      ([url, init]) =>
        requestUrl(url).endsWith('/api/v1/backup/sources') && init?.method === 'POST',
    );
    expect(parseJsonBody(sourceWrite?.[1]?.body)).toMatchObject({
      location: 'Shared/Reports',
      sourceCode: 'CLOUD-DOCUMENTS',
      sourceType: 'cloud_service',
    });
    expect(JSON.stringify(parseJsonBody(sourceWrite?.[1]?.body))).not.toContain(
      'deployment-only-password',
    );
  });

  it('lets an operator request recovery of one email message as an isolated EML file', async () => {
    sessionStorage.clear();
    const context = {
      ...backupContext,
      permissions: [
        { action: 'view', module: 'backup' },
        { action: 'create', module: 'backup' },
      ],
    };
    storeSession(context);
    const fetchMock = createFetchMock(
      context,
      false, // protected source
      false, // policy approval
      false, // approved policy
      false, // verified database run
      false, // restore approval
      false, // object-storage run
      false, // pause approval
      false, // paused policy
      false, // artifact deletion
      false, // retention reduction
      true, // email run
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.click(screen.getByRole('button', { name: 'Jobs & restore points' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Request restore' }));

    expect(await screen.findByRole('heading', { name: 'Request email recovery' })).toBeTruthy();
    expect(screen.getByText(/does not add them back to the live mailbox/u)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Restore scope/u, { selector: 'select' }), {
      target: { value: 'file' },
    });
    fireEvent.change(screen.getByLabelText(/Search messages in restore point/u), {
      target: { value: 'sender@example.invalid' },
    });
    await screen.findByRole('option', {
      name: '2026-10-01 · sender@example.invalid · Backup evidence · 104 bytes',
      hidden: true,
    });
    fireEvent.change(screen.getByLabelText(/Email message to restore/u, { selector: 'select' }), {
      target: { value: 'mailboxes/INBOX/uidvalidity-9001/17.eml' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason for restore *' }), {
      target: { value: 'Recover this customer email in isolated storage.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send restore request' }));

    expect((await screen.findByRole('status')).textContent).toContain(
      'Restore request sent for independent approval.',
    );
    const requestWrite = fetchMock.mock.calls.find(
      ([url, init]) => requestUrl(url).includes('/restore-requests') && init?.method === 'POST',
    );
    expect(parseJsonBody(requestWrite?.[1]?.body)).toEqual({
      objectKey: 'mailboxes/INBOX/uidvalidity-9001/17.eml',
      reason: 'Recover this customer email in isolated storage.',
    });
  });

  it('lets a backup administrator prepare a protected source policy without starting a backup', async () => {
    sessionStorage.clear();
    const context = {
      ...backupContext,
      permissions: [
        { action: 'view', module: 'backup' },
        { action: 'create', module: 'backup' },
        { action: 'edit', module: 'backup' },
      ],
    };
    storeSession(context);
    const fetchMock = createFetchMock(context, true);
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.click(screen.getByRole('button', { name: 'Policies & schedules' }));
    await screen.findByRole('heading', { name: 'No backup policies yet' });
    fireEvent.click(screen.getByRole('button', { name: 'Create policy' }));
    expect(await screen.findByText('Vista database')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getByLabelText(/Vista database/u));
    fireEvent.change(screen.getByLabelText('Policy code *'), {
      target: { value: 'VISTA-DB-HOURLY' },
    });
    fireEvent.change(screen.getByLabelText('Policy name *'), {
      target: { value: 'Vista database hourly recovery' },
    });
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Save as draft' }),
    );

    expect(await screen.findByText('Vista database hourly recovery')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/backup/policies'),
      expect.objectContaining({ method: 'POST' }),
    );
    const policyWrite = fetchMock.mock.calls.find(
      ([url, init]) =>
        requestUrl(url).includes('/api/v1/backup/policies') && init?.method === 'POST',
    );
    expect(parseJsonBody(policyWrite?.[1]?.body)).toMatchObject({
      backupType: 'database_snapshot',
      frequency: 'hourly',
      rpoMinutes: 60,
      rtoMinutes: 240,
      sourceIds: [backupSource.id],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Request approval' }));
    fireEvent.change(screen.getByLabelText('Reason for approval *'), {
      target: { value: 'Protect the database on the approved hourly schedule.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    expect(await screen.findByText('Waiting for second-person review.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v1/backup/policies/${policyFixture.id}/approval`),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('lets a separate security officer review a policy approval request', async () => {
    sessionStorage.clear();
    const context = {
      ...backupContext,
      permissions: [
        { action: 'view', module: 'backup' },
        { action: 'approve', module: 'backup' },
      ],
    };
    storeSession(context);
    const fetchMock = createFetchMock(context, false, true);
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.click(screen.getByRole('button', { name: 'Policy approvals' }));
    expect(
      await screen.findByText('Protect the database on the approved hourly schedule.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(
      await screen.findByText(
        'Policy approved. Activate the schedule in Policies & schedules before it runs.',
      ),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        `/api/v1/backup/approval-requests/${policyApprovalFixture.id}/decision`,
      ),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('lets a different backup approver approve restore-point removal', async () => {
    sessionStorage.clear();
    const context = {
      ...backupContext,
      permissions: [
        { action: 'view' as const, module: 'backup' as const },
        { action: 'approve' as const, module: 'backup' as const },
      ],
    };
    storeSession(context);
    const fetchMock = createFetchMock(
      context,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.click(screen.getByRole('button', { name: 'Policy approvals' }));
    expect(
      await screen.findByText('Remove the superseded test restore point after review.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve removal' }));

    expect(
      await screen.findByText(
        'Restore-point removal approved. The backup worker will remove the copy and retain its audit history.',
      ),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        `/api/v1/backup/artifact-deletion-requests/${artifactDeletionFixture.id}/decision`,
      ),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('lets a separate security officer approve a requested schedule pause', async () => {
    sessionStorage.clear();
    const context = {
      ...backupContext,
      permissions: [
        { action: 'view', module: 'backup' },
        { action: 'approve', module: 'backup' },
      ],
    };
    storeSession(context);
    const fetchMock = createFetchMock(context, false, false, false, false, false, false, true);
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.click(screen.getByRole('button', { name: 'Policy approvals' }));
    expect(await screen.findByText('Pause backup schedule')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(
      await screen.findByText('The backup schedule was paused. New scheduled runs will not start.'),
    ).toBeTruthy();
  });

  it('lets a backup administrator activate an independently approved schedule', async () => {
    sessionStorage.clear();
    const context = {
      ...backupContext,
      permissions: [
        { action: 'view', module: 'backup' },
        { action: 'create', module: 'backup' },
        { action: 'edit', module: 'backup' },
      ],
    };
    storeSession(context);
    const fetchMock = createFetchMock(context, false, false, true);
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.click(screen.getByRole('button', { name: 'Policies & schedules' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Activate schedule' }));

    expect(await screen.findByText('The approved backup schedule is active.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v1/backup/policies/${policyFixture.id}/activate`),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('requires a second-person request before pausing an active backup schedule', async () => {
    sessionStorage.clear();
    const context = {
      ...backupContext,
      permissions: [
        { action: 'view', module: 'backup' },
        { action: 'edit', module: 'backup' },
      ],
    };
    storeSession(context);
    const fetchMock = createFetchMock(context, false, false, true);
    vi.stubGlobal('fetch', fetchMock);
    render(
      <LocalizationProvider>
        <App />
      </LocalizationProvider>,
    );
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.click(screen.getByRole('button', { name: 'Policies & schedules' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Activate schedule' }));
    expect(await screen.findByText('The approved backup schedule is active.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Request pause' }));
    fireEvent.change(screen.getByLabelText('Reason for pausing *'), {
      target: { value: 'Pause while the approved recovery target is reviewed.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }));

    expect(
      await screen.findByText(
        'Pause request submitted. The schedule remains active until a different authorised person approves it.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('Pause request awaiting review. Scheduled backups continue until approval.'),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v1/backup/policies/${policyFixture.id}/pause-requests`),
      expect.objectContaining({ method: 'POST' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'BG' }));
    expect(screen.getByRole('button', { name: 'BG' }).getAttribute('aria-pressed')).toBe('true');
    expect(
      await screen.findByText(
        'Заявката за пауза е изпратена. Графикът остава активен, докато друго упълномощено лице не я одобри.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Заявката за пауза очаква преглед. Планираните архивирания продължават до одобрение.',
      ),
    ).toBeTruthy();
  });

  it('resumes a paused backup schedule after source and encryption checks pass', async () => {
    sessionStorage.clear();
    const context = {
      ...backupContext,
      permissions: [
        { action: 'view', module: 'backup' },
        { action: 'edit', module: 'backup' },
      ],
    };
    storeSession(context);
    const fetchMock = createFetchMock(
      context,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.click(screen.getByRole('button', { name: 'Policies & schedules' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Resume schedule' }));

    expect(await screen.findByText('The backup schedule has resumed.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v1/backup/policies/${policyFixture.id}/resume`),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('submits a lower-retention proposal without applying it before approval', async () => {
    sessionStorage.clear();
    const context = {
      ...backupContext,
      permissions: [
        { action: 'view' as const, module: 'backup' as const },
        { action: 'edit' as const, module: 'backup' as const },
      ],
    };
    storeSession(context);
    const fetchMock = createFetchMock(
      context,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.click(screen.getByRole('button', { name: 'Policies & schedules' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Request lower retention' }));

    fireEvent.change(screen.getByRole('spinbutton', { name: /New daily copies/u }), {
      target: { value: '30' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: /New monthly copies/u }), {
      target: { value: '10' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Reason for reducing retention/u }), {
      target: { value: 'Reduce retained copies after reviewing recovery needs.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }));

    expect((await screen.findByRole('status')).textContent).toContain(
      'Retention reduction requested. Current retention stays in effect until a different authorised person approves it.',
    );
    const request = fetchMock.mock.calls.find(
      ([url, init]) =>
        requestUrl(url).endsWith('/retention-reduction-requests') && init?.method === 'POST',
    );
    expect(parseJsonBody(request?.[1]?.body)).toMatchObject({
      expectedVersion: 4,
      justification: 'Reduce retained copies after reviewing recovery needs.',
      retentionDailyCopies: 30,
      retentionMonthlyCopies: 10,
    });
  });

  it('retains sign-out after changing the selected area', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'Backup operations' });
    fireEvent.click(screen.getByRole('button', { name: 'DR tests' }));
    expect(screen.getByRole('heading', { name: 'Disaster recovery tests' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Open recovery centre' })).toBeTruthy();
    expect(sessionStorage.getItem('vista.backup-control.session.v1')).toBeNull();
  });

  it('signs an employee into Backup Control only after the backend returns backup access', async () => {
    sessionStorage.clear();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ enabled: false, emergencyAccessAvailable: false, method: null }),
      )
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
    await waitFor(() => {
      expect(fetchMock.mock.calls.map(([input]) => requestUrl(input))).toEqual(
        expect.arrayContaining([
          expect.stringContaining('/api/v1/auth/login'),
          expect.stringContaining('/api/v1/auth/me'),
          expect.stringContaining('/api/v1/backup/sources'),
          expect.stringContaining('/api/v1/backup/policies'),
          expect.stringContaining('/api/v1/backup/dr-tests'),
        ]),
      );
    });
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

function storeSession(
  context:
    | typeof backupContext
    | (Omit<typeof backupContext, 'permissions'> & {
        permissions: Array<{ action: 'approve' | 'view' | 'create' | 'edit'; module: 'backup' }>;
      }),
): void {
  sessionStorage.setItem(
    'vista.backup-control.session.v1',
    JSON.stringify({ ...loginResponse, context }),
  );
}

type FetchMock = ReturnType<
  typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Response>
>;

function createFetchMock(
  context:
    | typeof backupContext
    | (Omit<typeof backupContext, 'permissions'> & {
        permissions: Array<{ action: 'approve' | 'view' | 'create' | 'edit'; module: 'backup' }>;
      }),
  includeProtectedSource = false,
  includePolicyApproval = false,
  includeApprovedPolicy = false,
  includeVerifiedRun = false,
  includeRestoreApproval = false,
  includeObjectStorageRun = false,
  includePauseApproval = false,
  includePausedPolicy = false,
  includeArtifactDeletion = false,
  includeRetentionReduction = false,
  includeEmailRun = false,
  includeCompletedFileRestore = false,
  includeCompletedDatabaseRestore = false,
): FetchMock {
  let approvalPending = includePolicyApproval || includePauseApproval;
  let artifactDeletionRequests = includeArtifactDeletion ? [artifactDeletionFixture] : [];
  let restoreRequests: BackupRestoreRequest[] = includeCompletedFileRestore
    ? [completedFileRestoreFixture]
    : includeCompletedDatabaseRestore
      ? [completedDatabaseRestoreFixture]
      : includeRestoreApproval
        ? [restoreRequestFixture]
        : [];
  let planReviewRecords: Array<Record<string, unknown>> = [];
  return vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Response>((input, init) => {
    const url = requestUrl(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/api/v1/auth/me')) return jsonResponse(context);
    if (url.includes('/api/v1/backup/reference-data')) return jsonResponse({ employees: [] });
    if (url.endsWith('/api/v1/backup/dr-tests')) return jsonResponse({ items: [], total: 0 });
    if (url.endsWith('/api/v1/backup/plan-reviews')) {
      if (method === 'POST') {
        const body = parseJsonBody(init?.body);
        const review = {
          ...body,
          id: '81057d3f-58c8-41e4-b67d-b1ba8fa6c588',
          nextReviewDueAt: '2027-10-28T12:00:00.000Z',
          planSnapshot: backupPlanSnapshot,
          policyCount: 1,
          protectedSourceCount: 1,
          reviewCode: 'BPR-2026-81057D3F',
          reviewedAt: '2026-10-28T12:00:00.000Z',
          reviewedByName: context.displayName,
          snapshotSha256: 'f'.repeat(64),
          summary: body['summary'],
        };
        planReviewRecords = [review, ...planReviewRecords];
        return jsonResponse(review, 201);
      }
      return jsonResponse({
        currentPlanSnapshot: backupPlanSnapshot,
        currentSnapshotSha256: 'f'.repeat(64),
        items: planReviewRecords,
        reviewRequired: planReviewRecords.length === 0,
        total: planReviewRecords.length,
      });
    }
    if (url.endsWith('/api/v1/backup/runs')) {
      const items = includeEmailRun
        ? [backupEmailRunFixture]
        : includeObjectStorageRun
          ? [backupFileRunFixture]
          : includeVerifiedRun
            ? [backupRunFixture]
            : [];
      return jsonResponse({
        items,
        page: 1,
        pageSize: 50,
        restoreAvailable: includeVerifiedRun,
        total: items.length,
      });
    }
    if (
      url.includes('/api/v1/backup/runs/') &&
      url.endsWith('/deletion-requests') &&
      method === 'POST'
    ) {
      const body = parseJsonBody(init?.body);
      artifactDeletionRequests = [
        {
          ...artifactDeletionFixture,
          reason: body['reason'] as string,
          requestedBy: context.accountId,
          requestedByName: context.displayName,
        },
      ];
      return jsonResponse(artifactDeletionRequests[0], 201);
    }
    if (url.includes('/api/v1/backup/artifact-deletion-requests/') && method === 'POST') {
      const body = parseJsonBody(init?.body);
      const current = artifactDeletionRequests[0] ?? artifactDeletionFixture;
      const decided = {
        ...current,
        ...(body['decision'] === 'approve' ? { approvedByName: context.displayName } : {}),
        status: body['decision'] === 'approve' ? ('approved' as const) : ('rejected' as const),
      };
      artifactDeletionRequests = [];
      return jsonResponse(decided);
    }
    if (url.endsWith('/api/v1/backup/artifact-deletion-requests')) {
      return jsonResponse({
        items: artifactDeletionRequests,
        total: artifactDeletionRequests.length,
      });
    }
    if (url.includes('/api/v1/backup/runs/') && url.includes('/file-restore-options')) {
      return jsonResponse({
        items: [
          includeEmailRun
            ? {
                key: 'mailboxes/INBOX/uidvalidity-9001/17.eml',
                label: '2026-10-01 · sender@example.invalid · Backup evidence',
                sizeBytes: '104',
              }
            : { key: 'partners/demo-evidence.pdf', sizeBytes: '32' },
        ],
        total: 1,
      });
    }
    if (
      url.includes('/api/v1/backup/runs/') &&
      url.endsWith('/restore-requests') &&
      method === 'POST'
    ) {
      restoreRequests = [
        {
          ...restoreRequestFixture,
          ...(includeEmailRun
            ? { sourceType: 'email' as const }
            : includeObjectStorageRun
              ? { sourceType: 'object_storage' as const }
              : {}),
          ...(parseJsonBody(init?.body)['objectKey']
            ? { restoreObjectKey: parseJsonBody(init?.body)['objectKey'] as string }
            : {}),
          reason: parseJsonBody(init?.body)['reason'] as string,
          requestedBy: context.accountId,
          requestedByName: context.displayName,
        },
      ];
      return jsonResponse(restoreRequests[0], 201);
    }
    if (url.includes('/api/v1/backup/restore-requests/') && method === 'POST') {
      const payload = parseJsonBody(init?.body);
      const current = restoreRequests[0] ?? restoreRequestFixture;
      const decided = {
        ...current,
        approvedByName: context.displayName,
        status: payload['decision'] === 'approve' ? ('approved' as const) : ('rejected' as const),
      };
      restoreRequests = [decided];
      return jsonResponse(decided);
    }
    if (
      url.includes('/api/v1/backup/restore-requests/') &&
      url.endsWith('/database/tables') &&
      method === 'GET'
    ) {
      return jsonResponse({
        items: [{ name: 'public.customers', primaryKeyColumns: ['id'] }],
      });
    }
    if (
      url.includes('/api/v1/backup/restore-requests/') &&
      url.endsWith('/database/record') &&
      method === 'POST'
    ) {
      return jsonResponse({
        databaseEngine: 'postgresql',
        format: 'vista-database-record-recovery-v1',
        primaryKey: { id: 'customer-42' },
        record: { id: 'customer-42', name: 'Recovered customer' },
        recoveredAt: '2026-10-28T11:30:00.000Z',
        restoreRequestId: completedDatabaseRestoreFixture.id,
        sourceRunId: backupRunFixture.id,
        tableName: 'public.customers',
      });
    }
    if (
      url.includes('/api/v1/backup/restore-requests/') &&
      url.endsWith('/download') &&
      method === 'GET'
    ) {
      return new Response('recovered image bytes', {
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    }
    if (url.endsWith('/api/v1/backup/restore-requests')) {
      return jsonResponse({ items: restoreRequests, total: restoreRequests.length });
    }
    if (url.endsWith(`/api/v1/backup/policies/${policyFixture.id}/activate`) && method === 'POST') {
      return jsonResponse({ ...policyFixture, status: 'active', version: 4 });
    }
    if (
      url.endsWith(`/api/v1/backup/policies/${policyFixture.id}/pause-requests`) &&
      method === 'POST'
    ) {
      return jsonResponse({
        ...policyFixture,
        pauseRequestPending: true,
        status: 'active',
        version: 4,
      });
    }
    if (
      url.endsWith(`/api/v1/backup/policies/${policyFixture.id}/retention-reduction-requests`) &&
      method === 'POST'
    ) {
      return jsonResponse({
        ...policyFixture,
        retentionReductionRequestPending: true,
        status: 'active',
        version: 4,
      });
    }
    if (url.endsWith(`/api/v1/backup/policies/${policyFixture.id}/resume`) && method === 'POST') {
      return jsonResponse({ ...policyFixture, status: 'active', version: 5 });
    }
    if (url.includes('/api/v1/backup/approval-requests/') && method === 'POST') {
      approvalPending = false;
      return jsonResponse({
        ...policyFixture,
        status: includePauseApproval ? 'paused' : 'approved',
        version: 3,
      });
    }
    if (url.endsWith('/api/v1/backup/approval-requests')) {
      return jsonResponse({
        items: approvalPending
          ? [
              {
                ...policyApprovalFixture,
                ...(includePauseApproval ? { action: 'disable_job' as const } : {}),
              },
            ]
          : [],
        total: approvalPending ? 1 : 0,
      });
    }
    if (url.endsWith(`/api/v1/backup/policies/${policyFixture.id}/approval`)) {
      return jsonResponse({ ...policyFixture, status: 'pending_approval', version: 2 });
    }
    if (url.includes('/api/v1/backup/policies')) {
      if (method === 'POST') {
        const body = parseJsonBody(init?.body);
        return jsonResponse(
          {
            ...body,
            createdAt: '2026-10-27T12:00:00.000Z',
            id: policyFixture.id,
            sources: [
              { id: backupSource.id, name: backupSource.name, sourceCode: backupSource.sourceCode },
            ],
            status: 'draft',
            updatedAt: '2026-10-27T12:00:00.000Z',
            version: 1,
          },
          201,
        );
      }
      const items = includePausedPolicy
        ? [{ ...policyFixture, status: 'paused', version: 4 }]
        : includeRetentionReduction
          ? [{ ...policyFixture, status: 'active', version: 4 }]
          : includeApprovedPolicy
            ? [{ ...policyFixture, status: 'approved', version: 3 }]
            : [];
      return jsonResponse({ items, page: 1, pageSize: 50, total: items.length });
    }
    if (url.includes('/api/v1/backup/sources') && method === 'POST') {
      const inputBody = parseJsonBody(init?.body);
      return jsonResponse(
        {
          ...inputBody,
          createdAt: '2026-10-27T12:00:00.000Z',
          dependencies: inputBody['dependencies'] ?? '',
          credentialCustody: inputBody['credentialCustody'] ?? '',
          id: '17e4b3fa-12d6-47a7-85b8-3f453d9d993c',
          restorePrerequisites: inputBody['restorePrerequisites'] ?? '',
          status: 'active',
          updatedAt: '2026-10-27T12:00:00.000Z',
          version: 1,
        },
        201,
      );
    }
    if (url.includes('/api/v1/backup/sources')) {
      if (includeProtectedSource) {
        return jsonResponse({ items: [backupSource], page: 1, pageSize: 50, total: 1 });
      }
      return jsonResponse({ items: [], page: 1, pageSize: 50, total: 0 });
    }
    return jsonResponse({});
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function parseJsonBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== 'string') throw new Error('The test expected a JSON request body.');
  return JSON.parse(body) as Record<string, unknown>;
}

const backupSource = {
  createdAt: '2026-10-27T12:00:00.000Z',
  credentialCustody: '',
  dataClassification: 'critical' as const,
  dependencies: '',
  encryptedAtSource: false,
  id: 'bc8555fa-f52b-4c4b-b846-98f96792e22c',
  location: 'Coolify PostgreSQL',
  name: 'Vista database',
  restorePrerequisites: '',
  sourceCode: 'VISTA-DB',
  sourceType: 'database' as const,
  status: 'active' as const,
  updatedAt: '2026-10-27T12:00:00.000Z',
  version: 1,
};

const backupPlanSnapshot = {
  policies: [
    {
      backupType: 'database_snapshot',
      compressionEnabled: true,
      dayOfMonth: undefined,
      dayOfWeek: undefined,
      encryptionRequired: true,
      frequency: 'hourly',
      policyCode: 'VISTA-DB-HOURLY',
      retentionDailyCopies: 35,
      retentionMonthlyCopies: 12,
      rpoMinutes: 60,
      rtoMinutes: 240,
      runTimeLocal: undefined,
      sourceCodes: ['VISTA-DB'],
      status: 'active',
      verificationRequired: true,
      version: 2,
    },
  ],
  protectedSources: [
    {
      classification: 'critical',
      location: 'Coolify PostgreSQL',
      name: 'Vista database',
      ownerName: 'Mila Backup',
      sourceCode: 'VISTA-DB',
      sourceType: 'database',
      status: 'active',
      stewardName: 'Mila Backup',
      version: 1,
    },
  ],
  storageTarget: 'vista-backups',
};

const policyFixture = {
  backupType: 'database_snapshot' as const,
  compressionEnabled: true,
  createdAt: '2026-10-27T12:00:00.000Z',
  encryptionRequired: true,
  frequency: 'hourly' as const,
  id: 'c8d6d1c4-fef2-45f1-9cf8-1936bb397e61',
  name: 'Vista database hourly recovery',
  policyCode: 'VISTA-DB-HOURLY',
  retentionDailyCopies: 35,
  retentionMonthlyCopies: 12,
  rpoMinutes: 60,
  rtoMinutes: 240,
  sources: [{ id: backupSource.id, name: backupSource.name, sourceCode: backupSource.sourceCode }],
  status: 'draft' as const,
  updatedAt: '2026-10-27T12:00:00.000Z',
  verificationRequired: true,
  version: 1,
};

const policyApprovalFixture = {
  action: 'modify_policy' as const,
  createdAt: '2026-10-27T12:00:00.000Z',
  expiresAt: '2026-11-10T12:00:00.000Z',
  id: 'bd3e0582-f2ed-4e3b-a1c7-45c4b1c8397f',
  justification: 'Protect the database on the approved hourly schedule.',
  policyCode: policyFixture.policyCode,
  policyId: policyFixture.id,
  policyName: policyFixture.name,
  requestedBy: '434477f6-ad82-46fc-9904-b5f41e2a10c2',
  requestedByName: 'Backup Administrator',
  status: 'pending' as const,
  version: 2,
};

const artifactDeletionFixture = {
  createdAt: '2026-10-28T12:00:00.000Z',
  expiresAt: '2026-11-11T12:00:00.000Z',
  id: 'a9522da9-8979-4a40-a754-c65c674dfd82',
  policyCode: 'VISTA-DB-HOURLY',
  policyName: 'Vista database hourly recovery',
  reason: 'Remove the superseded test restore point after review.',
  requestedBy: '92001329-12c4-4e5f-a475-0c5a093bcb1d',
  requestedByName: 'Backup Administrator',
  runId: '9d60710d-0d62-4b93-834e-8c5ae1d67df1',
  scheduledFor: '2026-10-27T11:00:00.000Z',
  status: 'pending_approval' as const,
};

const backupRunFixture = {
  artifactAvailable: true,
  artifactSizeBytes: '1024',
  attemptCount: 1,
  backupType: 'database_snapshot' as const,
  compressionAlgorithm: 'postgres_custom' as const,
  id: '9d60710d-0d62-4b93-834e-8c5ae1d67df1',
  independentCopyStatus: 'not_configured' as const,
  policyCode: policyFixture.policyCode,
  policyName: policyFixture.name,
  restoreAvailable: true,
  scheduledFor: '2026-10-27T10:00:00.000Z',
  sourceType: 'database' as const,
  startedAt: '2026-10-27T10:00:03.000Z',
  status: 'verified' as const,
  verificationAttemptCount: 1,
  verificationStatus: 'verified' as const,
  uncompressedSizeBytes: '4096',
  verifiedAt: '2026-10-27T10:01:00.000Z',
};

const backupFileRunFixture = {
  ...backupRunFixture,
  backupType: 'full' as const,
  compressionAlgorithm: 'gzip' as const,
  sourceType: 'object_storage' as const,
};

const backupEmailRunFixture = {
  ...backupFileRunFixture,
  sourceType: 'email' as const,
};

const restoreRequestFixture = {
  attemptCount: 0,
  createdAt: '2026-10-27T11:00:00.000Z',
  id: 'a2a860da-ae66-4858-b5bd-43c06c5a9760',
  policyCode: policyFixture.policyCode,
  policyName: policyFixture.name,
  reason: 'Restore this verified backup in isolation for release testing.',
  requestedBy: '44590f3e-a8de-4971-8b0b-f2a1d727a8de',
  requestedByName: 'Backup Administrator',
  runId: backupRunFixture.id,
  scheduledFor: backupRunFixture.scheduledFor,
  sourceType: 'database' as const,
  status: 'pending_approval' as const,
};

const completedFileRestoreFixture: BackupRestoreRequest = {
  ...restoreRequestFixture,
  approvedByName: 'Backup Approver',
  completedAt: '2026-10-28T11:30:00.000Z',
  reason: 'Recover the server image to isolated storage.',
  restoreObjectKey: 'images/vista-server.qcow2',
  sourceType: 'file_share',
  status: 'completed',
  targetStorageBucket: 'vista-backup',
  targetStoragePrefix: 'restores/0123456789abcdef0123456789abcdef/attempt-1/',
};

const completedDatabaseRestoreFixture: BackupRestoreRequest = {
  ...restoreRequestFixture,
  approvedByName: 'Backup Approver',
  completedAt: '2026-10-28T11:30:00.000Z',
  reason: 'Recover one customer record from an isolated database copy.',
  sourceType: 'database',
  status: 'completed',
  targetDatabaseName: 'vista_restore_012345abcdef_1',
};
