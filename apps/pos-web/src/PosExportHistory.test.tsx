import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RecentExports } from './PosReports';
import { getPosReportExports } from './api/pos';
vi.mock('./api/pos');
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const result = (page: number) => ({
  page,
  pageSize: 6,
  total: 7,
  totalPages: 2,
  items: Array.from({ length: page === 1 ? 6 : 1 }, (_, index) => ({
    id: `file-${(page - 1) * 6 + index}`,
    name: `Report ${(page - 1) * 6 + index + 1}`,
    definitionKey: 'pos.shift-register' as const,
    format: 'csv' as const,
    status: 'completed' as const,
    attemptCount: 1,
    createdAt: '2026-09-10T12:00:00Z',
  })),
});
const props = { token: 'test', refresh: 0, canRetry: true, onDownload: vi.fn(), onRetry: vi.fn() };

it('pages to older files and returns to the first page after a newly prepared export', async () => {
  vi.mocked(getPosReportExports).mockImplementation((_token, page) =>
    Promise.resolve(result(page ?? 1)),
  );
  const view = render(<RecentExports {...props} />);
  await screen.findByText('Report 1');
  expect(getPosReportExports).toHaveBeenCalledWith('test', 1, 6);
  fireEvent.click(screen.getByRole('button', { name: 'Next exports' }));
  await screen.findByText('Report 7');
  expect(screen.queryByText('Report 1')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  expect(props.onDownload).toHaveBeenCalledWith(result(2).items[0]);
  view.rerender(<RecentExports {...props} refresh={1} />);
  await screen.findByText('Report 1');
  expect(screen.queryByText('Report 7')).toBeNull();
  await waitFor(() => expect(screen.getByText('Page 1 of 2')).toBeTruthy());
});

it('distinguishes loading failure from an empty history and offers a successful refresh', async () => {
  vi.mocked(getPosReportExports)
    .mockRejectedValueOnce(Error('Disconnected'))
    .mockResolvedValue(result(1));
  render(<RecentExports {...props} />);
  await screen.findByText('Your files could not be loaded. Select Refresh to try again.');
  expect(screen.queryByText('Your prepared files will appear here.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText('Report 1');
  expect(screen.queryByRole('alert')).toBeNull();
});
