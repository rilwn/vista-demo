import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from './App';
import { messages } from './messages';

afterEach(cleanup);

describe('POS application shell', () => {
  it('presents an operational sale terminal without claiming unavailable integrations', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'New sale' })).toBeTruthy();
    expect(screen.getByLabelText('Search or scan')).toBeTruthy();
    expect(screen.getByText('No items in this sale')).toBeTruthy();
    expect(screen.getByText(messages.status)).toBeTruthy();
    expect(screen.getByText('Fiscal device not assigned')).toBeTruthy();
  });

  it('keeps every POS register page reachable from the terminal navigation', () => {
    render(<App />);

    for (const [navigationLabel, heading] of [
      ['Customers & loyalty', 'Customers & loyalty'],
      ['POS reports', 'POS reports'],
      ['Returns', 'Returns & warranty claims'],
      ['Sale history', 'Sale history'],
      ['Shifts', 'Cashier shifts'],
      ['Sync & devices', 'Sync & devices'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: navigationLabel }));
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
  });
});
