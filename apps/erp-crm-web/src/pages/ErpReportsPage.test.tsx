import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchableSelects } from '@vista/ui';
import type { ErpReportScope, ErpReportDefinition, SavedErpReport } from '@vista/contracts';
import { RouterProvider } from '../routing/Router';
import { erpReportsApi as api, downloadErpReport } from '../api/erp-reports';
import { ReportsWorkspace } from './ErpReportsPage';
vi.mock('../api/erp-reports');
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const keys = {
  procurement: 'procurement.order-comparison',
  warehouse: 'warehouse.stock-balances',
  sales: 'sales.quotation-register',
  logistics: 'logistics.deliveries',
} as const;
const titles = {
  procurement: 'Purchase order comparison',
  warehouse: 'Stock and valuation',
  sales: 'Quotations and orders',
  logistics: 'Deliveries',
};
function mount(scope: ErpReportScope, canCreate = true) {
  render(
    <RouterProvider>
      <SearchableSelects />
      <ReportsWorkspace scope={scope} token="test-token" canCreate={canCreate} />
    </RouterProvider>,
  );
}
let reports: SavedErpReport[] = [];
function setup(scope: ErpReportScope) {
  const definition: ErpReportDefinition = {
    key: keys[scope],
    name: titles[scope],
    description: 'Report description',
    requiresDateRange: scope !== 'warehouse',
    formats: ['csv', 'xlsx', 'pdf'],
    columns: [
      { key: 'reference', label: 'Reference', type: 'text' },
      { key: 'quantity', label: 'Quantity', type: 'number' },
      { key: 'status', label: 'Status', type: 'text' },
    ],
  };
  vi.mocked(api.definitions).mockResolvedValue([definition]);
  vi.mocked(api.preview).mockResolvedValue({
    columns: definition.columns!,
    rows: [{ reference: 'TEST-001', quantity: '2.0000', status: 'Open' }],
    page: 1,
    total: 1,
    totalPages: 1,
    generatedAt: '2026-09-08T10:00:00Z',
  });
  vi.mocked(api.saved).mockImplementation(() =>
    Promise.resolve({ items: reports, page: 1, total: reports.length, totalPages: 1 }),
  );
  vi.mocked(api.save).mockImplementation((_token, _scope, input) => {
    reports = [input];
    return Promise.resolve(input);
  });
  vi.mocked(api.exports).mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 0,
  });
  vi.mocked(api.create).mockResolvedValue({
    id: 'export-id',
    attemptCount: 0,
    createdAt: '2026-09-08T10:00:00Z',
    definitionKey: keys[scope],
    format: 'csv',
    name: titles[scope],
    status: 'queued',
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  reports = [];
});
describe('ERP reporting workspace', () => {
  it.each(['procurement', 'warehouse', 'sales', 'logistics'] as const)(
    'saves, restores and exports applied %s filters',
    async (scope) => {
      setup(scope);
      mount(scope);
      await screen.findByText('TEST-001');
      expect(
        screen
          .getByRole('link', {
            name:
              'Back to ' +
              {
                procurement: 'Procurement',
                warehouse: 'Warehouse',
                sales: 'Sales',
                logistics: 'Logistics',
              }[scope],
          })
          .getAttribute('href'),
      ).toBe('/modules/erp.' + scope);
      if (scope !== 'warehouse') {
        fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-01' } });
        fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-12-31' } });
      }
      fireEvent.change(screen.getByLabelText('Search report values'), {
        target: { value: 'TEST-001' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      await screen.findByText('TEST-001');
      fireEvent.click(screen.getByText('Saved views & export fields'));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Status' }));
      fireEvent.change(screen.getByLabelText('Report name'), {
        target: { value: 'Monthly review' },
      });
      fireEvent.change(screen.getByLabelText('File type'), { target: { value: 'pdf' } });
      fireEvent.change(screen.getByLabelText('Search report values'), {
        target: { value: 'not yet applied' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save as new report' }));
      await screen.findByText('Your report view is saved.');
      expect(api.save).toHaveBeenLastCalledWith(
        'test-token',
        scope,
        expect.objectContaining({
          search: 'TEST-001',
          columns: ['reference', 'quantity'],
          format: 'pdf',
          name: 'Monthly review',
        }),
      );
      cleanup();
      mount(scope);
      await screen.findByText('TEST-001');
      fireEvent.click(screen.getByText('Saved views & export fields'));
      fireEvent.change(screen.getByLabelText('My saved reports'), {
        target: { value: reports[0]!.id },
      });
      await waitFor(() =>
        expect(screen.getByLabelText<HTMLInputElement>('Search report values').value).toBe(
          'TEST-001',
        ),
      );
      expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Status' }).checked).toBe(
        false,
      );
      expect(screen.getByLabelText<HTMLSelectElement>('File type').value).toBe('pdf');
      for (const format of ['xlsx', 'csv', 'pdf']) {
        fireEvent.change(screen.getByLabelText('File type'), { target: { value: format } });
        await waitFor(() =>
          expect(
            screen.getByRole<HTMLButtonElement>('button', { name: 'Prepare export' }).disabled,
          ).toBe(false),
        );
        fireEvent.click(screen.getByRole('button', { name: 'Prepare export' }));
        await waitFor(() =>
          expect(api.create).toHaveBeenLastCalledWith(
            'test-token',
            scope,
            expect.objectContaining({
              columns: ['reference', 'quantity'],
              format,
              search: 'TEST-001',
            }),
            expect.any(String),
          ),
        );
      }
    },
  );
  it('keeps retry keys after lost responses and blocks an empty field selection', async () => {
    setup('sales');
    vi.mocked(api.save)
      .mockRejectedValueOnce(new Error('Offline'))
      .mockImplementation((_t, _s, input) => Promise.resolve(input));
    mount('sales');
    await screen.findByText('TEST-001');
    fireEvent.click(screen.getByText('Saved views & export fields'));
    fireEvent.change(screen.getByLabelText('Report name'), { target: { value: 'Retry review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as new report' }));
    await screen.findByText(
      'The request could not be completed. Your options are still here. Try again.',
    );
    const first = vi.mocked(api.save).mock.calls[0]![2];
    fireEvent.click(screen.getByRole('button', { name: 'Save as new report' }));
    await screen.findByText('Your report view is saved.');
    expect(vi.mocked(api.save).mock.calls[1]![2]).toEqual(first);
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Prepare export' }).disabled).toBe(
      true,
    );
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Save as new report' }).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2200-01-01' } });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(true);
  });
  it('offers loading recovery and keeps read-only export actions unavailable', async () => {
    setup('warehouse');
    vi.mocked(api.definitions).mockRejectedValueOnce(new Error('Offline'));
    mount('warehouse', false);
    await screen.findByText('The report could not be loaded. Try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('TEST-001');
    fireEvent.click(screen.getByText('Saved views & export fields'));
    expect(screen.queryByRole('button', { name: 'Prepare export' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save as new report' })).toBeNull();
    expect(screen.queryByLabelText('From')).toBeNull();
  });
  it('downloads a completed export from the visible list', async () => {
    setup('procurement');
    const report = {
      id: 'ready-id',
      attemptCount: 1,
      createdAt: '2026-09-08T10:00:00Z',
      definitionKey: keys.procurement,
      format: 'csv' as const,
      name: 'Purchase order comparison',
      status: 'completed' as const,
      fileName: 'review.csv',
    };
    vi.mocked(api.exports).mockResolvedValue({
      items: [report],
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1,
    });
    vi.mocked(downloadErpReport).mockResolvedValue(new Blob(['Reference,Quantity']));
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:report'), revokeObjectURL: vi.fn() }),
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    mount('procurement');
    const recent = await screen.findByRole('heading', { name: 'Recent exports' });
    fireEvent.click(within(recent.closest('section')!).getByRole('button', { name: 'Download' }));
    await waitFor(() =>
      expect(downloadErpReport).toHaveBeenCalledWith('test-token', 'procurement', report),
    );
    await waitFor(() => expect(click).toHaveBeenCalled());
  });
});
