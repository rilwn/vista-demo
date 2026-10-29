import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { OrganizationTopology } from '@vista/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../api/organization';
import { LocalizationProvider } from '../i18n/LocalizationProvider';
import { OrganizationPage } from './OrganizationPage';

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: () => true, session: { sessionToken: 'ui-test-token' } }),
}));
vi.mock('../api/organization', () => ({
  getOrganizationTopology: vi.fn(),
  listOrganizationMembers: vi.fn(),
  createBusinessBranch: vi.fn(),
  createBusinessLocation: vi.fn(),
  createBusinessOperator: vi.fn(),
  createCashRegister: vi.fn(),
  createLegalBusinessEntity: vi.fn(),
  setOrganizationRecordActive: vi.fn(),
  updateBusinessBranch: vi.fn(),
  updateBusinessLocation: vi.fn(),
  updateBusinessOperator: vi.fn(),
  updateCashRegister: vi.fn(),
  updateLegalBusinessEntity: vi.fn(),
}));

const topology: OrganizationTopology = {
  legalEntities: [
    { id: 'entity-1', code: 'VISTA', name: 'Vista Service Ltd.', active: true, version: 1 },
  ],
  branches: [
    {
      id: 'branch-1',
      legalEntityId: 'entity-1',
      code: 'VR',
      name: 'Vratsa branch',
      active: true,
      version: 1,
    },
  ],
  locations: [
    {
      id: 'location-1',
      branchId: 'branch-1',
      code: 'VR-01',
      name: 'Vratsa Service',
      locationType: 'service_and_retail',
      addressLine1: '1 Operations Blvd.',
      city: 'Vratsa',
      countryCode: 'BG',
      active: true,
      version: 1,
    },
  ],
  cashRegisters: [
    {
      id: 'register-1',
      businessLocationId: 'location-1',
      code: 'POS-01',
      name: 'Service counter',
      operatorIds: ['operator-1'],
      active: true,
      version: 1,
    },
  ],
  operators: [
    {
      id: 'operator-1',
      businessLocationId: 'location-1',
      accountId: 'employee-1',
      code: 'OP-01',
      displayName: 'Mila Ivanova',
      email: 'mila@example.invalid',
      active: true,
      version: 1,
    },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.mocked(api.getOrganizationTopology).mockResolvedValue(topology);
  vi.mocked(api.listOrganizationMembers).mockResolvedValue([topology.operators[0]!]);
});
afterEach(cleanup);

async function showPage(locale = 'en') {
  localStorage.setItem('vista.operations.locale', locale);
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  const view = render(
    <LocalizationProvider>
      <OrganizationPage />
    </LocalizationProvider>,
    { container: root },
  );
  await screen.findByRole('heading', { name: 'Vista Service Ltd.' });
  return { root, ...view };
}

describe('Business structure UI', () => {
  it('keeps resources collapsed until requested and displays readable location types', async () => {
    await showPage();
    expect(screen.queryByText('service_and_retail')).toBeNull();
    expect(screen.getByText('Service and retail centre')).toBeTruthy();
    const resources = screen.getByText('1 register').closest('details')!;
    expect(resources.open).toBe(false);
    fireEvent.click(resources.querySelector('summary')!);
    expect(resources.open).toBe(true);
    expect(within(resources).getByText('Service counter')).toBeTruthy();
    expect(within(resources).getByText('Mila Ivanova')).toBeTruthy();
  });

  it.each([
    ['Legal entity', 'Add a legal business entity', 'Legal entity code'],
    ['Branch', 'Add a branch', 'Branch code'],
    ['Location', 'Add an operating location', 'Location code'],
    ['Operator', 'Assign an operator', 'Operator code'],
    ['Cash register', 'Add a cash register', 'Cash register code'],
  ])(
    'opens %s creation in a separate, labelled panel without moving the directory',
    async (button, title, field) => {
      const { root } = await showPage();
      const trigger = screen.getByRole('button', { name: button });
      trigger.focus();
      fireEvent.click(trigger);
      const dialog = screen.getByRole('dialog', { name: title });
      expect(root.contains(dialog)).toBe(false);
      expect(root.inert).toBe(true);
      expect(within(dialog).getByLabelText(field)).toBeTruthy();
      expect(dialog.querySelector('.organization-drawer-body')).toBeTruthy();
      expect(dialog.querySelector('footer')?.parentElement).toBe(dialog.querySelector('form'));
      expect(dialog.querySelector('footer')?.closest('.organization-drawer-body')).toBeNull();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(root.inert).toBe(false);
      expect(document.activeElement).toBe(trigger);
      expect(api.createLegalBusinessEntity).not.toHaveBeenCalled();
      expect(api.createBusinessLocation).not.toHaveBeenCalled();
    },
  );

  it('traps keyboard focus, supports Escape, and restores the edit trigger', async () => {
    await showPage();
    const entity = screen.getByRole('heading', { name: 'Vista Service Ltd.' }).closest('article')!;
    const trigger = within(entity.querySelector('header')!).getByRole('button', {
      name: 'Edit',
    });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Edit legal entity' });
    const back = within(dialog).getByRole('button', { name: 'Back to business structure' });
    const save = within(dialog).getByRole('button', { name: 'Save changes' });
    back.focus();
    fireEvent.keyDown(back, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(save);
    fireEvent.keyDown(save, { key: 'Tab' });
    expect(document.activeElement).toBe(back);
    fireEvent.keyDown(back, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(api.updateLegalBusinessEntity).not.toHaveBeenCalled();
  });

  it('keeps edits and the form panel open after a recoverable save error', async () => {
    vi.mocked(api.updateLegalBusinessEntity).mockRejectedValue(
      new Error('test connection failure'),
    );
    await showPage();
    const entity = screen.getByRole('heading', { name: 'Vista Service Ltd.' }).closest('article')!;
    fireEvent.click(within(entity.querySelector('header')!).getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Legal entity name'), {
      target: { value: 'Vista Updated Ltd.' },
    });
    fireEvent.submit(dialog.querySelector('form')!);
    await waitFor(() =>
      expect(within(dialog).getByRole('alert').textContent).toContain('could not be updated'),
    );
    expect(within(dialog).getByLabelText<HTMLInputElement>('Legal entity name').value).toBe(
      'Vista Updated Ltd.',
    );
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(
      within(dialog).getByRole('button', { name: 'Save changes' }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('keeps the hierarchy mounted during a successful save refresh', async () => {
    const entity = {
      id: 'entity-2',
      code: 'UI-NEW',
      name: 'New entity Ltd.',
      active: true,
      version: 1,
    };
    vi.mocked(api.getOrganizationTopology)
      .mockResolvedValueOnce(topology)
      .mockResolvedValueOnce({ ...topology, legalEntities: [...topology.legalEntities, entity] });
    vi.mocked(api.createLegalBusinessEntity).mockResolvedValue(entity);
    await showPage();
    const directoryPage = screen.getByRole('main');
    fireEvent.click(screen.getByRole('button', { name: 'Legal entity' }));
    const panel = screen.getByRole('dialog');
    fireEvent.change(within(panel).getByLabelText('Legal entity code'), {
      target: { value: entity.code },
    });
    fireEvent.change(within(panel).getByLabelText('Legal entity name'), {
      target: { value: entity.name },
    });
    fireEvent.submit(panel.querySelector('form')!);
    await screen.findByRole('heading', { name: entity.name });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('main')).toBe(directoryPage);
  });

  it('uses Bulgarian labels in the directory and the panel', async () => {
    await showPage('bg');
    expect(screen.getByText('Сервизен и търговски център')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Юридическо лице' }));
    const dialog = screen.getByRole('dialog', { name: 'Добавяне на юридическо лице' });
    expect(within(dialog).getByLabelText('Код на юридическо лице')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Отказ' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Затваряне на формуляра' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
