import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DashboardCards, SearchableSelects } from '@vista/ui';
import {
  dashboardCardKeys,
  type LibraryDefinition,
  type LibraryView,
  type ReportDashboardScope,
} from '@vista/contracts';
import { RouterProvider } from '../routing/Router';
import { reportingHubApi as api } from '../api/reporting-hub';
import { ReportingHub } from './ReportingHubPage';
vi.mock('../api/reporting-hub');
const definition: LibraryDefinition = {
  key: 'warehouse.stock-balances',
  name: 'Stock and valuation',
  description: 'Current stock',
  scope: 'warehouse',
  canCreate: true,
  requiresDateRange: false,
  formats: ['csv', 'xlsx', 'pdf'],
  columns: [{ key: 'productName', label: 'Product', type: 'text' }],
};
const view: LibraryView = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Weekly stock review',
  scope: 'warehouse',
  canCreate: true,
  configuration: { definitionKey: definition.key, format: 'csv', columns: ['productName'] },
};
beforeEach(() => {
  vi.resetAllMocks();
  if (!HTMLDialogElement.prototype.showModal)
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      writable: true,
      value: function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
      },
    });
  if (!HTMLDialogElement.prototype.close)
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      writable: true,
      value: function (this: HTMLDialogElement) {
        this.removeAttribute('open');
      },
    });
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute('open', '');
  });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.removeAttribute('open');
  });
  vi.mocked(api.definitions).mockResolvedValue([definition]);
  vi.mocked(api.context).mockResolvedValue({ timezone: 'Europe/Sofia' });
  vi.mocked(api.views).mockResolvedValue({ items: [view], page: 1, total: 1, totalPages: 1 });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount(view: 'report-library' | 'scheduled-exports' = 'report-library') {
  render(
    <RouterProvider>
      <SearchableSelects />
      <ReportingHub token="test" view={view} />
    </RouterProvider>,
  );
}
it('reviews a saved view and retains its submission id after a lost schedule response', async () => {
  vi.mocked(api.schedule).mockRejectedValueOnce(Error('Lost response')).mockResolvedValueOnce({
    id: 'schedule',
    viewId: view.id,
    scope: 'warehouse',
    name: view.name,
    cadence: 'daily',
    period: 'current',
    firstRunLocal: '2026-09-09T09:00',
    enabled: true,
    version: 0,
    nextRunAt: '2026-09-09T06:00:00Z',
    timezone: 'Europe/Sofia',
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Review saved view' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('Product')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule this view' }));
  fireEvent.change(within(dialog).getByLabelText('First run'), {
    target: { value: '2026-09-09T09:00' },
  });
  await waitFor(() =>
    expect(dialog.querySelectorAll('.vista-search-select-listbox').length).toBe(2),
  );
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
  await screen.findByText(/Your choices have been kept/);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
  await screen.findByText('Your schedule is saved.');
  expect(api.schedule).toHaveBeenCalledTimes(2);
  expect(vi.mocked(api.schedule).mock.calls[0]![1]).toEqual(
    vi.mocked(api.schedule).mock.calls[1]![1],
  );
  expect(vi.mocked(api.schedule).mock.calls[0]![1]).toMatchObject({
    period: 'current',
    scope: 'warehouse',
    viewId: view.id,
  });
});
it('keeps read-only views readable without offering export or schedule writes', async () => {
  vi.mocked(api.views).mockResolvedValue({
    items: [{ ...view, canCreate: false }],
    page: 1,
    total: 1,
    totalPages: 1,
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Review saved view' }));
  expect(screen.queryByRole('button', { name: 'Schedule this view' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Prepare export/ })).toBeNull();
});
it('pauses a schedule with its revision and opens its run history', async () => {
  const schedule = {
    id: 'schedule',
    viewId: view.id,
    scope: 'warehouse' as const,
    name: 'Morning stock',
    cadence: 'daily' as const,
    period: 'current' as const,
    firstRunLocal: '2026-09-09T09:00',
    enabled: true,
    version: 4,
    nextRunAt: '2026-09-09T06:00:00Z',
    timezone: 'Europe/Sofia',
  };
  vi.mocked(api.schedules).mockResolvedValue({
    items: [schedule],
    page: 1,
    total: 1,
    totalPages: 1,
  });
  vi.mocked(api.state).mockImplementation(() => {
    vi.mocked(api.schedules).mockResolvedValue({
      items: [{ ...schedule, enabled: false, version: 5 }],
      page: 1,
      total: 1,
      totalPages: 1,
    });
    return Promise.resolve({ ...schedule, enabled: false, version: 5 });
  });
  vi.mocked(api.runs).mockResolvedValue({ items: [], page: 1, total: 0, totalPages: 0 });
  mount('scheduled-exports');
  fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
  await screen.findByText('Paused');
  expect(api.state).toHaveBeenCalledWith('test', 'schedule', false, 4);
  fireEvent.click(screen.getByRole('button', { name: 'Run history' }));
  await screen.findByText('No runs yet. The first export will appear after its scheduled time.');
  fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Back' })[0]!);
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('shows a recoverable initial schedule-list error without an endless loading message', async () => {
  vi.mocked(api.schedules)
    .mockRejectedValueOnce(Error())
    .mockResolvedValueOnce({ items: [], page: 1, total: 0, totalPages: 0 });
  mount('scheduled-exports');
  await screen.findByText(/Your choices have been kept/);
  expect(screen.queryByText('Loading reports…')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText(/No schedules yet/);
});
it.each(Object.keys(dashboardCardKeys) as ReportDashboardScope[])(
  'persists private %s card choices across remounts',
  async (scope) => {
    let preferences = { hiddenCards: [] as string[], version: 0 };
    const fetcher = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        preferences = {
          ...(JSON.parse(init.body as string) as typeof preferences),
          version: preferences.version + 1,
        };
      }
      return Promise.resolve(new Response(JSON.stringify(preferences), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetcher);
    const keys = dashboardCardKeys[scope];
    const element = (
      <DashboardCards
        token="test"
        apiBaseUrl="/api/v1"
        scope={scope}
        labels={[...keys]}
        className="cards"
      >
        {keys.map((k) => (
          <article key={k}>{`Card ${k}`}</article>
        ))}
      </DashboardCards>
    );
    render(element);
    fireEvent.click(screen.getByText('Customize cards'));
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save layout' }).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: keys[0] }));
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await screen.findByText('Your layout is saved.');
    expect(screen.queryByText(`Card ${keys[0]}`)).toBeNull();
    cleanup();
    render(element);
    await waitFor(() => expect(screen.queryByText(`Card ${keys[0]}`)).toBeNull());
    expect(screen.getByText(`Card ${keys[1]}`)).toBeTruthy();
  },
);
