import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ExportHistoryControls, useExportHistory } from './useExportHistory';

type Row = { status: string; name: string };
const fetchPage =
  vi.fn<
    (token: string, page: number, size: number) => Promise<{ items: Row[]; totalPages: number }>
  >();
function Harness({ token = 'one' }: { token?: string }) {
  const history = useExportHistory(token, fetchPage);
  return (
    <>
      <button onClick={() => history.refresh()}>Refresh</button>
      <button onClick={() => history.refresh(true)}>Created</button>
      {history.items.map((row) => (
        <p key={row.name}>{row.name}</p>
      ))}
      <ExportHistoryControls history={history} />
    </>
  );
}
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('loads older files, refreshes the current page and resets after creation', async () => {
  fetchPage.mockImplementation((_token, page) =>
    Promise.resolve({ items: [{ status: 'completed', name: `File page ${page}` }], totalPages: 2 }),
  );
  render(<Harness />);
  await screen.findByText('File page 1');
  fireEvent.click(screen.getByRole('button', { name: 'Next exports' }));
  await screen.findByText('File page 2');
  expect(fetchPage).toHaveBeenLastCalledWith('one', 2, 6);
  fireEvent.click(screen.getByText('Refresh'));
  await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(3));
  expect(fetchPage).toHaveBeenLastCalledWith('one', 2, 6);
  fireEvent.click(screen.getByText('Created'));
  await screen.findByText('File page 1');
});
it('recovers history failures and ignores stale responses after an account change', async () => {
  fetchPage.mockRejectedValueOnce(new Error('Network unavailable'));
  const view = render(<Harness />);
  expect((await screen.findByRole('alert')).textContent).toContain('Refresh');
  let finish!: (value: { items: Row[]; totalPages: number }) => void;
  fetchPage.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByText('Refresh'));
  fetchPage.mockResolvedValue({
    items: [{ status: 'completed', name: 'Second account file' }],
    totalPages: 1,
  });
  view.rerender(<Harness token="two" />);
  await screen.findByText('Second account file');
  await act(async () => {
    finish({ items: [{ status: 'completed', name: 'Private first account file' }], totalPages: 1 });
    await Promise.resolve();
  });
  expect(screen.queryByText('Private first account file')).toBeNull();
});
