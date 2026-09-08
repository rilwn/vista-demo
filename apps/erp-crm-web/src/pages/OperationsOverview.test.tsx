import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider } from '../routing/Router';
import { OperationsOverview } from './OperationsOverview';
import { SearchableSelects } from '@vista/ui';

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
      <SearchableSelects />
      <OperationsOverview token="test-token" warrantyPath="/modules/erp.service/care" />
    </RouterProvider>,
  );
}

describe('Operational dashboard', () => {
  it('saves cards, restores them after navigation and resets the layout', async () => {
    let preferences = { hiddenCards: [] as string[], version: 0 };
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          if (typeof init.body !== 'string') throw new Error('Expected a JSON request body');
          const body = JSON.parse(init.body) as typeof preferences;
          preferences = { ...body, version: preferences.version + 1 };
          return Promise.resolve(new Response(JSON.stringify(preferences)));
        }
        return Promise.resolve(new Response(JSON.stringify({ ...overview, preferences })));
      }),
    );
    mount();
    await screen.findByText('BGN 108.00');
    fireEvent.click(screen.getByText('Customize overview'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Recorded revenue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await screen.findByText('Your overview layout is saved.');
    expect(screen.queryByText('BGN 108.00')).toBeNull();
    expect(
      screen.queryByText(
        'Revenue includes prepared documents, before VAT, not posted accounting revenue.',
      ),
    ).toBeNull();
    cleanup();
    mount();
    await screen.findByRole('heading', { name: 'Active Service requests' });
    expect(screen.queryByText('BGN 108.00')).toBeNull();
    fireEvent.click(screen.getByText('Customize overview'));
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Recorded revenue' }).checked,
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Show all cards' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await screen.findByText('BGN 108.00');
  });

  it('keeps choices after a failed save and explains conflicting changes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return Promise.resolve(
          init?.method === 'PUT'
            ? new Response('{}', { status: 409 })
            : new Response(JSON.stringify(overview)),
        );
      }),
    );
    mount();
    await screen.findByText('BGN 108.00');
    fireEvent.click(screen.getByText('Customize overview'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Recorded revenue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await screen.findByText(
      'Your layout changed in another window. Select Apply above to reload it before saving again.',
    );
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Recorded revenue' }).checked,
    ).toBe(false);
    expect(screen.getByText('BGN 108.00')).toBeTruthy();
  });

  it('keeps customization available when all permitted cards are hidden', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...overview,
            activeServiceRequests: undefined,
            expiringWarranties: undefined,
            preferences: {
              hiddenCards: ['recordedRevenueBgn', 'overdueReceivablesBgn'],
              version: 1,
            },
          }),
        ),
      ),
    );
    mount();
    await screen.findByText('All cards are hidden. Open Customize overview to show them again.');
    expect(screen.queryByText('How these figures are calculated')).toBeNull();
    fireEvent.click(screen.getByText('Customize overview'));
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Show all cards' })).toBeTruthy();
  });

  it('shows live values and applies dates without changing the current-balance labels', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(overview), { status: 200 })),
      );
    vi.stubGlobal('fetch', fetchMock);
    mount();
    expect(await screen.findByText('BGN 108.00')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Active Service requests' })).toBeTruthy();
    expect(
      screen.getByText(
        'Revenue includes prepared documents, before VAT, not posted accounting revenue.',
      ),
    ).toBeTruthy();
    const details = screen.getByText('How these figures are calculated').closest('details');
    expect(details?.open).toBe(false);
    fireEvent.click(screen.getByText('How these figures are calculated'));
    expect(details?.open).toBe(true);
    expect(screen.getByRole('combobox', { name: 'Search Warranties ending within' })).toBeTruthy();
    const warrantySelect = screen.getByLabelText('Warranties ending within');
    expect(warrantySelect.closest('label')).toBeNull();
    expect(warrantySelect.parentElement?.className).toBe('operations-filter-control');
    expect(warrantySelect.nextElementSibling?.className).toBe('vista-search-select-shell');
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
    await screen.findByRole('heading', { name: 'Active Service requests' });
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
    await screen.findByRole('heading', { name: 'Active Service requests' });
    fireEvent.change(screen.getByLabelText('Revenue from'), { target: { value: '2099-01-01' } });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(true);
  });
});
