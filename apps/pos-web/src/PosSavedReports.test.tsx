import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PosReportDefinition, PosReportFilters, SavedPosReport } from '@vista/contracts';
import { PosSavedReports } from './PosSavedReports';
import { listSavedPosReports, savePosReport } from './api/pos';
vi.mock('./api/pos');
const definition: PosReportDefinition = {
  key: 'pos.product-sales',
  name: 'Product sales',
  description: 'Product totals.',
  requiresDateRange: true,
  requiresShift: false,
  formats: ['xlsx', 'csv', 'pdf'],
  columns: [
    { key: 'productName', label: 'Product', type: 'text' },
    { key: 'quantitySold', label: 'Quantity sold', type: 'number' },
  ],
};
const filters: PosReportFilters = {
  dateFrom: '2026-01-01',
  dateTo: '2026-12-31',
  businessLocationId: 'b12d543a-8914-4a94-8c79-78668bfd9dd6',
};
let reports: SavedPosReport[];
const onExport = vi.fn();
const onNotice = vi.fn();
const onRestore = vi.fn();
function Harness({ canCreate = true }: { canCreate?: boolean }) {
  const [columns, setColumns] = useState<string[] | undefined>();
  return (
    <PosSavedReports
      token="test"
      definition={definition}
      filters={filters}
      columns={columns}
      onColumns={setColumns}
      onRestore={(report) => {
        setColumns(report.columns);
        onRestore(report);
      }}
      onExport={onExport}
      canCreate={canCreate}
      exporting={false}
      onNotice={onNotice}
    />
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  reports = [];
  vi.mocked(listSavedPosReports).mockImplementation(() =>
    Promise.resolve({
      items: reports,
      page: 1,
      total: reports.length,
      totalPages: reports.length ? 1 : 0,
    }),
  );
  vi.mocked(savePosReport).mockImplementation((_token, input) => {
    reports = [input];
    return Promise.resolve(input);
  });
});
afterEach(cleanup);
describe('POS saved reports', () => {
  it('saves applied filters, columns and format and reopens the same options', async () => {
    const mounted = render(<Harness />);
    fireEvent.click(screen.getByText('Saved reports & export fields'));
    fireEvent.click(screen.getByLabelText('Quantity sold'));
    fireEvent.change(screen.getByLabelText('Report name'), {
      target: { value: 'Product review 2026' },
    });
    fireEvent.change(screen.getByLabelText('File type'), { target: { value: 'csv' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as new report' }));
    await waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]).toMatchObject({
      ...filters,
      format: 'csv',
      columns: ['productName'],
      name: 'Product review 2026',
    });
    mounted.unmount();
    render(<Harness />);
    fireEvent.click(screen.getByText('Saved reports & export fields'));
    await screen.findByRole('option', { name: 'Product review 2026' });
    fireEvent.change(screen.getByLabelText('My saved reports'), {
      target: { value: reports[0]?.id },
    });
    expect(onRestore).toHaveBeenCalledWith(reports[0]);
    expect(screen.getByLabelText('File type')).toHaveProperty('value', 'csv');
    expect(screen.getByLabelText('Quantity sold')).toHaveProperty('checked', false);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare export' }));
    expect(onExport).toHaveBeenCalledWith('csv');
    fireEvent.click(screen.getByLabelText('Product'));
    expect(screen.getByRole('button', { name: 'Prepare export' })).toHaveProperty('disabled', true);
  });
  it('reuses the save UUID after a failed response', async () => {
    vi.mocked(savePosReport).mockRejectedValueOnce(new Error('Connection interrupted'));
    render(<Harness />);
    fireEvent.click(screen.getByText('Saved reports & export fields'));
    fireEvent.change(screen.getByLabelText('Report name'), { target: { value: 'Retry review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as new report' }));
    await waitFor(() =>
      expect(onNotice).toHaveBeenCalledWith({ kind: 'error', text: 'Connection interrupted' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save as new report' }));
    await waitFor(() => expect(savePosReport).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(savePosReport).mock.calls;
    expect(calls[0]?.[1].id).toBe(calls[1]?.[1].id);
  });
  it('omits save and export commands for a read-only user', () => {
    render(<Harness canCreate={false} />);
    fireEvent.click(screen.getByText('Saved reports & export fields'));
    expect(screen.queryByRole('button', { name: 'Save as new report' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Prepare export' })).toBeNull();
  });
});
