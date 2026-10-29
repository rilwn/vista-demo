import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SecurityAccount, SecurityRole } from '@vista/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api/security-administration';
import { LocalizationProvider } from '../i18n/LocalizationProvider';
import { SecurityAdministrationPage } from './SecurityAdministrationPage';

const access = vi.hoisted(() => ({ admin: true, verified: true }));
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    hasPermission: () => true,
    session: {
      sessionToken: 'ui-token',
      context: {
        accountId: 'current-account',
        sessionId: 'current-session',
        isAdministrative: access.admin,
        twoFactorVerified: access.verified,
      },
    },
  }),
}));
vi.mock('../api/security-administration', () => ({
  listSecurityAccounts: vi.fn(),
  listSecurityRoles: vi.fn(),
  listSecuritySessions: vi.fn(),
  listAuditEvents: vi.fn(),
  verifyAuditIntegrity: vi.fn(),
  createSecurityAccount: vi.fn(),
  createSecurityRole: vi.fn(),
  updateSecurityRole: vi.fn(),
  replaceSecurityAccountRoles: vi.fn(),
  changeSecurityAccountStatus: vi.fn(),
  issueAccountRecoveryHandoff: vi.fn(),
  revokeSecuritySession: vi.fn(),
}));
const roles: SecurityRole[] = [
  {
    id: 'service-role',
    code: 'service.viewer',
    name: 'Service viewer',
    description: 'Reviews assigned Service work.',
    isAdministrative: false,
    isSystemRole: false,
    version: 1,
    permissions: [{ module: 'erp.service', action: 'view' }],
  },
  {
    id: 'warehouse-role',
    code: 'warehouse.editor',
    name: 'Warehouse editor',
    isAdministrative: false,
    isSystemRole: false,
    version: 1,
    permissions: [
      { module: 'erp.warehouse', action: 'view' },
      { module: 'erp.warehouse', action: 'edit' },
    ],
  },
  {
    id: 'admin-role',
    code: 'administrator',
    name: 'Administrator',
    isAdministrative: true,
    isSystemRole: true,
    version: 1,
    permissions: [
      { module: 'platform', action: 'approve' },
      { module: 'platform', action: 'view' },
    ],
  },
];
const employee: SecurityAccount = {
  accountId: 'employee-account',
  employeeId: 'employee',
  employeeNumber: 'EMP-017',
  displayName: 'Mila Ivanova',
  email: 'mila@example.invalid',
  status: 'active',
  roles: [roles[0]!],
  activeSessionCount: 0,
  twoFactorEnrolled: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  version: 1,
};

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  access.admin = true;
  access.verified = true;
  vi.mocked(api.listSecurityAccounts).mockResolvedValue({
    items: [employee],
    page: 1,
    pageSize: 100,
    total: 1,
    totalPages: 1,
  });
  vi.mocked(api.listSecurityRoles).mockResolvedValue(roles);
  vi.mocked(api.listSecuritySessions).mockResolvedValue([]);
  vi.mocked(api.listAuditEvents).mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 100,
    total: 0,
    totalPages: 1,
  });
  vi.mocked(api.verifyAuditIntegrity).mockResolvedValue({
    valid: true,
    checkedEvents: 0,
    headHash: '',
  });
});
afterEach(cleanup);

async function showPage(locale = 'en') {
  localStorage.setItem('vista.operations.locale', locale);
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  render(
    <LocalizationProvider>
      <SecurityAdministrationPage />
    </LocalizationProvider>,
    { container: root },
  );
  await screen.findByRole('heading', { name: locale === 'bg' ? 'Сигурност' : 'Security' });
  return root;
}

function openEmployee() {
  fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
  return screen.getByRole('dialog', { name: employee.displayName });
}
function openRole(name = 'Service viewer') {
  fireEvent.click(screen.getByRole('tab', { name: /^Roles/u }));
  const row = screen.getByRole('heading', { name }).closest('article')!;
  const trigger = within(row).getByRole('button', { name: 'Edit access' });
  trigger.focus();
  fireEvent.click(trigger);
  return { dialog: screen.getByRole('dialog', { name: `Edit ${name}` }), trigger };
}

describe('Security administration panels', () => {
  it('opens employee access outside the page with a separate full-width action footer', async () => {
    const root = await showPage();
    const trigger = screen.getByRole('button', { name: 'Manage' });
    trigger.focus();
    const dialog = openEmployee();
    expect(root.contains(dialog)).toBe(false);
    expect(root.inert).toBe(true);
    expect(within(dialog).getByRole('heading', { name: 'Employee access' })).toBeTruthy();
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Back to security' }),
    );
    expect(
      within(dialog).getByRole('button', { name: 'Save roles' }).closest('.admin-drawer-body'),
    ).toBeNull();
    expect(dialog.querySelector('footer')?.parentElement).toBe(
      dialog.querySelector('.admin-drawer-layout'),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(root.inert).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(api.replaceSecurityAccountRoles).not.toHaveBeenCalled();
  });

  it('retains selected roles through filtering and a failed save', async () => {
    vi.mocked(api.replaceSecurityAccountRoles).mockRejectedValue(new Error('connection failure'));
    await showPage();
    const dialog = openEmployee();
    fireEvent.change(within(dialog).getByLabelText('Find a role'), {
      target: { value: 'warehouse' },
    });
    expect(within(dialog).queryByRole('checkbox', { name: /Service viewer/u })).toBeNull();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Warehouse editor/u }));
    fireEvent.change(within(dialog).getByLabelText('Find a role'), { target: { value: '' } });
    expect(
      within(dialog).getByRole<HTMLInputElement>('checkbox', { name: /Service viewer/u }).checked,
    ).toBe(true);
    expect(within(dialog).getByText('2 roles selected')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save roles' }));
    await within(dialog).findByRole('alert');
    expect(api.replaceSecurityAccountRoles).toHaveBeenCalledWith(
      'ui-token',
      expect.any(String),
      employee,
      ['service-role', 'warehouse-role'],
    );
    expect(
      within(dialog).getByRole<HTMLInputElement>('checkbox', { name: /Warehouse editor/u }).checked,
    ).toBe(true);
  });

  it('retains hidden module permissions while editing a filtered module', async () => {
    vi.mocked(api.updateSecurityRole).mockRejectedValue(new Error('connection failure'));
    await showPage();
    const { dialog } = openRole();
    fireEvent.change(within(dialog).getByLabelText('Find a module'), {
      target: { value: 'warehouse' },
    });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Warehouse Edit' }));
    expect(
      within(dialog).getByText(/Selected actions have no View access for Warehouse/u),
    ).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Find a module'), {
      target: { value: 'not a module' },
    });
    expect(within(dialog).getByText('No matching modules')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Find a module'), { target: { value: '' } });
    expect(
      within(dialog).getByRole<HTMLInputElement>('checkbox', { name: 'Service View' }).checked,
    ).toBe(true);
    fireEvent.submit(dialog.querySelector('form')!);
    await within(dialog).findByRole('alert');
    expect(api.updateSecurityRole).toHaveBeenCalledWith(
      'ui-token',
      expect.any(String),
      roles[0],
      expect.objectContaining({
        permissions: [
          { module: 'erp.warehouse', action: 'edit' },
          { module: 'erp.service', action: 'view' },
        ],
      }),
    );
  });

  it('prevents dismissal while saving and preserves the directory on refresh', async () => {
    let complete: (role: SecurityRole) => void = () => undefined;
    vi.mocked(api.updateSecurityRole).mockReturnValue(
      new Promise<SecurityRole>((resolve) => {
        complete = resolve;
      }),
    );
    const root = await showPage();
    const page = root.firstElementChild;
    const { dialog } = openRole();
    fireEvent.submit(dialog.querySelector('form')!);
    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Close panel' }).disabled,
    ).toBe(true);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBe(dialog);
    await act(async () => {
      complete(roles[0]!);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(root.firstElementChild).toBe(page);
    expect(root.inert).toBe(false);
  });

  it('keeps protected administrative permissions disabled without verified administrator access', async () => {
    access.verified = false;
    await showPage();
    const { dialog } = openRole('Administrator');
    expect(
      within(dialog)
        .getByRole<HTMLInputElement>('checkbox', { name: 'Platform Approve' })
        .matches(':disabled'),
    ).toBe(true);
    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Save access' }).disabled,
    ).toBe(true);
    expect(
      within(dialog).getByText('Verify your authenticator before changing this role.'),
    ).toBeTruthy();
    expect(api.updateSecurityRole).not.toHaveBeenCalled();
  });

  it('contains keyboard focus and restores the role-edit trigger on Escape', async () => {
    await showPage();
    const { dialog, trigger } = openRole();
    const back = within(dialog).getByRole('button', { name: 'Back to security' });
    const save = within(dialog).getByRole('button', { name: 'Save access' });
    back.focus();
    fireEvent.keyDown(back, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(save);
    fireEvent.keyDown(save, { key: 'Tab' });
    expect(document.activeElement).toBe(back);
    fireEvent.keyDown(back, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps account creation and permission labels Bulgarian', async () => {
    await showPage('bg');
    fireEvent.click(screen.getByRole('button', { name: 'Добавяне на служител' }));
    let dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Служебен номер')).toBeTruthy();
    expect(within(dialog).getByLabelText('Първоначална парола')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отказ' }));
    fireEvent.click(screen.getByRole('tab', { name: /^Роли/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавяне на роля' }));
    dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Намиране на модул'), {
      target: { value: 'Склад' },
    });
    expect(within(dialog).getByRole('checkbox', { name: 'Склад Преглед' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Отказ' }).closest('footer')).toBeTruthy();
  });

  it('filters the role directory without changing access', async () => {
    await showPage();
    fireEvent.click(screen.getByRole('tab', { name: /^Roles/u }));
    fireEvent.change(screen.getByLabelText('Find a role'), { target: { value: 'warehouse' } });
    expect(screen.getByRole('heading', { name: 'Warehouse editor' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Service viewer' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Find a role'), {
      target: { value: 'no matching role' },
    });
    expect(screen.getByText('No matching roles')).toBeTruthy();
    expect(api.updateSecurityRole).not.toHaveBeenCalled();
  });
});
