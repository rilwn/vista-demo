import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App';
import { messages } from './messages';

describe('POS application shell', () => {
  it('presents an operational sale terminal without claiming unavailable integrations', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'New sale' })).toBeTruthy();
    expect(screen.getByLabelText('Search or scan')).toBeTruthy();
    expect(screen.getByText('No items in this sale')).toBeTruthy();
    expect(screen.getByText(messages.status)).toBeTruthy();
    expect(screen.getByText('Fiscal device unassigned')).toBeTruthy();
  });
});
