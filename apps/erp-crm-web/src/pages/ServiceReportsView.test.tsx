import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedServiceReport } from '@vista/contracts';
import { ServiceReportsView } from './ServiceReportsView';
import * as service from '../api/service';
import * as saved from '../api/report-workspace';

vi.mock('../api/service');
vi.mock('../api/report-workspace');
const definitions = [
  {
    key: 'service.request-register',
    name: 'Service request register',
    description: 'Service requests in the selected period.',
    formats: ['xlsx', 'csv', 'pdf'],
    requiresDateRange: true,
    columns: [
      { key: 'requestNumber', label: 'Request', type: 'text' },
      { key: 'customerName', label: 'Customer', type: 'text' },
    ],
  },
  {
    key: 'service.technician-performance',
    name: 'Technician performance',
    description: 'Assigned and completed visits.',
    formats: ['xlsx', 'csv', 'pdf'],
    requiresDateRange: true,
    columns: [{ key: 'displayName', label: 'Technician', type: 'text' }],
  },
] as const;
let reports: SavedServiceReport[];
beforeEach(() => {
  vi.resetAllMocks();
  reports = [];
  vi.mocked(service.getServiceReportOverview).mockResolvedValue({
    dateFrom: '2026-01-01',
    dateTo: '2026-12-31',
    generatedAt: '2026-09-08T00:00:00Z',
    statusTotals: [],
    technicians: [],
    typeTotals: [],
    totals: {
      cancelledRequests: 0,
      completedRequests: 0,
      laborMinutes: 0,
      openRequests: 0,
      totalCostBgn: '0',
      totalRequests: 0,
    },
  });
  vi.mocked(service.getServiceReportDefinitions).mockResolvedValue(
    structuredClone(definitions) as unknown as Awaited<
      ReturnType<typeof service.getServiceReportDefinitions>
    >,
  );
  vi.mocked(service.listServiceReportExports).mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  });
  vi.mocked(saved.listSavedServiceReports).mockImplementation(() =>
    Promise.resolve({
      items: reports,
      page: 1,
      total: reports.length,
      totalPages: reports.length ? 1 : 0,
    }),
  );
  vi.mocked(saved.saveServiceReport).mockImplementation((_token, input) => {
    reports = [input];
    return Promise.resolve(input);
  });
});
afterEach(cleanup);

async function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Export report' }));
  const dialog = await screen.findByRole('dialog', { name: 'Export Service report' });
  await within(dialog).findByLabelText('Customer');
  return within(dialog);
}

describe('saved Service reports', () => {
  it('saves, reopens and exports the chosen period and columns with a separate footer', async () => {
    render(<ServiceReportsView canExport token="test" />);
    let panel = await open();
    fireEvent.change(panel.getByLabelText('From'), { target: { value: '2026-01-01' } });
    fireEvent.change(panel.getByLabelText('To'), { target: { value: '2026-12-31' } });
    fireEvent.click(panel.getByLabelText('Customer'));
    fireEvent.change(panel.getByLabelText('Save these options'), {
      target: { value: 'Service requests 2026' },
    });
    fireEvent.click(panel.getByRole('button', { name: 'Save as new report' }));
    await waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]).toMatchObject({
      name: 'Service requests 2026',
      columns: ['requestNumber'],
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      format: 'xlsx',
    });
    await waitFor(() =>
      expect(panel.getByRole('button', { name: 'Close' })).toHaveProperty('disabled', false),
    );
    fireEvent.click(panel.getByRole('button', { name: 'Close' }));
    panel = await open();
    fireEvent.change(panel.getByLabelText('My saved reports'), {
      target: { value: reports[0]?.id },
    });
    expect(panel.getByLabelText('Customer')).toHaveProperty('checked', false);
    expect(panel.getByLabelText('From')).toHaveProperty('value', '2026-01-01');
    const submit = panel.getByRole('button', { name: 'Prepare export' });
    expect(submit.closest('footer')?.parentElement?.getAttribute('role')).toBe('dialog');
    for (const format of ['Excel', 'CSV', 'PDF']) {
      fireEvent.click(panel.getByRole('radio', { name: new RegExp(format) }));
      fireEvent.click(submit);
      await waitFor(() => expect(submit).toHaveProperty('disabled', false));
    }
    expect(
      vi.mocked(service.createServiceReportExport).mock.calls.map((call) => call[2].format),
    ).toEqual(['xlsx', 'csv', 'pdf']);
    expect(
      vi
        .mocked(service.createServiceReportExport)
        .mock.calls.every((call) => call[2].columns?.join() === 'requestNumber'),
    ).toBe(true);
    fireEvent.change(panel.getByLabelText('Report'), {
      target: { value: 'service.technician-performance' },
    });
    expect(panel.getByLabelText('Technician')).toHaveProperty('checked', true);
    expect(panel.queryByLabelText('Request')).toBeNull();
  });

  it('blocks empty selections and invalid periods and reuses a save key after a lost response', async () => {
    vi.mocked(saved.saveServiceReport).mockRejectedValueOnce(new Error('Connection interrupted'));
    render(<ServiceReportsView canExport token="test" />);
    const panel = await open();
    fireEvent.click(panel.getByLabelText('Request'));
    fireEvent.click(panel.getByLabelText('Customer'));
    expect(panel.getByRole('button', { name: 'Prepare export' })).toHaveProperty('disabled', true);
    fireEvent.click(panel.getByLabelText('Request'));
    fireEvent.change(panel.getByLabelText('From'), { target: { value: '2027-01-01' } });
    fireEvent.change(panel.getByLabelText('To'), { target: { value: '2026-12-31' } });
    expect(panel.getByRole('button', { name: 'Prepare export' })).toHaveProperty('disabled', true);
    fireEvent.change(panel.getByLabelText('From'), { target: { value: '2026-01-01' } });
    fireEvent.change(panel.getByLabelText('Save these options'), {
      target: { value: 'Retry test' },
    });
    fireEvent.click(panel.getByRole('button', { name: 'Save as new report' }));
    await panel.findByText('The report could not be saved. Please try again.');
    fireEvent.click(panel.getByRole('button', { name: 'Save as new report' }));
    await waitFor(() => expect(saved.saveServiceReport).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(saved.saveServiceReport).mock.calls;
    expect(calls[0]?.[1].id).toBe(calls[1]?.[1].id);
  });

  it('does not offer export or save commands without create permission', () => {
    render(<ServiceReportsView canExport={false} token="test" />);
    expect(screen.queryByRole('button', { name: 'Export report' })).toBeNull();
  });
});
