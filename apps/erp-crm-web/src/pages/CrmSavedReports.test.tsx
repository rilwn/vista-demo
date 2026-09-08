import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrmReportDefinition, SavedCrmReport } from '@vista/contracts';
import { CrmReportExportPanel } from './CrmAnalyticsPage';
import * as analytics from '../api/crm-analytics';
import * as saved from '../api/report-workspace';

vi.mock('../api/crm-analytics');
vi.mock('../api/report-workspace');
const definitions: CrmReportDefinition[] = [
  {
    key: 'crm.customer-value',
    name: 'Customer value and retention',
    description: 'Customer value over the selected period.',
    formats: ['xlsx', 'csv', 'pdf'],
    requiresDateRange: true,
    columns: [
      { key: 'period', label: 'Window', type: 'text' },
      { key: 'activeCustomers', label: 'Active customers', type: 'number' },
    ],
  },
  {
    key: 'crm.employee-performance',
    name: 'Employee performance',
    description: 'Completed work.',
    formats: ['xlsx', 'csv', 'pdf'],
    requiresDateRange: true,
    columns: [{ key: 'displayName', label: 'Employee', type: 'text' }],
  },
];
let reports: SavedCrmReport[];
beforeEach(() => {
  vi.resetAllMocks();
  reports = [];
  vi.mocked(analytics.getCrmReportDefinitions).mockResolvedValue(definitions);
  vi.mocked(analytics.listCrmReportExports).mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  });
  vi.mocked(saved.listSavedCrmReports).mockImplementation(() =>
    Promise.resolve({
      items: reports,
      page: 1,
      total: reports.length,
      totalPages: reports.length ? 1 : 0,
    }),
  );
  vi.mocked(saved.saveCrmReport).mockImplementation((_token, input) => {
    reports = [input];
    return Promise.resolve(input);
  });
});
afterEach(cleanup);
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Export report</button>
      {open ? (
        <CrmReportExportPanel
          token="test"
          dateFrom="2026-01-01"
          dateTo="2026-12-31"
          onBack={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
async function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Export report' }));
  const panel = within(await screen.findByRole('dialog', { name: 'Export CRM report' }));
  await panel.findByLabelText('Window');
  return panel;
}
describe('CRM saved reports', () => {
  it('saves and restores selected fields, dates and format and exports all formats', async () => {
    render(<Harness />);
    let panel = await open();
    fireEvent.change(panel.getByLabelText('From'), { target: { value: '2026-02-01' } });
    fireEvent.click(panel.getByLabelText('Active customers'));
    fireEvent.change(panel.getByLabelText('Save these options'), {
      target: { value: 'Customer review 2026' },
    });
    fireEvent.click(panel.getByRole('button', { name: 'Save as new report' }));
    await waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]).toMatchObject({
      columns: ['period'],
      dateFrom: '2026-02-01',
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
    expect(panel.getByLabelText('From')).toHaveProperty('value', '2026-02-01');
    expect(panel.getByLabelText('Active customers')).toHaveProperty('checked', false);
    const submit = panel.getByRole('button', { name: 'Prepare export' });
    expect(submit.closest('footer')?.parentElement?.getAttribute('role')).toBe('dialog');
    for (const format of ['Excel', 'CSV', 'PDF']) {
      fireEvent.click(panel.getByRole('radio', { name: new RegExp(format) }));
      fireEvent.click(submit);
      await waitFor(() => expect(submit).toHaveProperty('disabled', false));
    }
    expect(
      vi.mocked(analytics.createCrmReportExport).mock.calls.map((call) => call[2].format),
    ).toEqual(['xlsx', 'csv', 'pdf']);
    expect(
      vi
        .mocked(analytics.createCrmReportExport)
        .mock.calls.every((call) => call[2].columns?.join() === 'period'),
    ).toBe(true);
    fireEvent.change(panel.getByLabelText('Report'), {
      target: { value: 'crm.employee-performance' },
    });
    expect(panel.getByLabelText('Employee')).toHaveProperty('checked', true);
    expect(panel.queryByLabelText('Window')).toBeNull();
  });
  it('rejects empty fields and reversed dates, and preserves the save key after an interrupted response', async () => {
    vi.mocked(saved.saveCrmReport).mockRejectedValueOnce(new Error('Interrupted'));
    render(<Harness />);
    const panel = await open();
    fireEvent.click(panel.getByLabelText('Window'));
    fireEvent.click(panel.getByLabelText('Active customers'));
    expect(panel.getByRole('button', { name: 'Prepare export' })).toHaveProperty('disabled', true);
    fireEvent.click(panel.getByLabelText('Window'));
    fireEvent.change(panel.getByLabelText('From'), { target: { value: '2027-01-01' } });
    expect(panel.getByRole('button', { name: 'Prepare export' })).toHaveProperty('disabled', true);
    fireEvent.change(panel.getByLabelText('From'), { target: { value: '2026-01-01' } });
    fireEvent.change(panel.getByLabelText('Save these options'), {
      target: { value: 'Retry review' },
    });
    fireEvent.click(panel.getByRole('button', { name: 'Save as new report' }));
    await panel.findByText('The report could not be saved. Please try again.');
    fireEvent.click(panel.getByRole('button', { name: 'Save as new report' }));
    await waitFor(() => expect(saved.saveCrmReport).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(saved.saveCrmReport).mock.calls;
    expect(calls[0]?.[1].id).toBe(calls[1]?.[1].id);
  });
});
