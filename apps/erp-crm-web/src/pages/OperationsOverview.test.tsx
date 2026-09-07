import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider } from '../routing/Router';
import { OperationsOverview } from './OperationsOverview';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const overview = {
  asOf: '2026-09-07',
  dateFrom: '2026-09-01',
  dateTo: '2026-09-07',
  warrantyDays: 30,
  recordedRevenueBgn: '108.0000',
  overdueReceivablesBgn: '33.0000',
  activeServiceRequests: 2,
  expiringWarranties: 1,
};
function mount() {
  render(
    <RouterProvider>
      <OperationsOverview token="test-token" warrantyPath="/modules/erp.service/care" />
    </RouterProvider>,
  );
}

describe('Operational dashboard', () => {
  it('shows live values and applies dates without changing the current-balance labels', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(overview), { status: 200 })),
      );
    vi.stubGlobal('fetch', fetchMock);
    mount();
    expect(await screen.findByText('BGN 108.00')).toBeTruthy();
    expect(screen.getByText('Active Service requests')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Review warranties' }).getAttribute('href')).toBe(
      '/modules/erp.service/care',
    );
    fireEvent.change(screen.getByLabelText('Revenue from'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('Warranties ending within'), {
      target: { value: '60' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(2));
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('dateFrom=2026-08-01');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('warrantyDays=60');
  });

  it('does not replace hidden metrics with misleading zeroes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              ...overview,
              recordedRevenueBgn: undefined,
              overdueReceivablesBgn: undefined,
            }),
            { status: 200 },
          ),
        ),
      ),
    );
    mount();
    await screen.findByText('Active Service requests');
    expect(screen.queryByText('Recorded revenue')).toBeNull();
    expect(screen.queryByText('Overdue receivables')).toBeNull();
  });

  it('offers retry on an API failure and prevents reversed dates', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(overview), { status: 200 })),
      );
    vi.stubGlobal('fetch', fetchMock);
    mount();
    await screen.findByText('The overview could not be loaded. Select Apply to try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('Active Service requests');
    fireEvent.change(screen.getByLabelText('Revenue from'), { target: { value: '2099-01-01' } });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(true);
  });
});
