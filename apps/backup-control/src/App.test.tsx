import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App';
import { messages } from './messages';

describe('backup-control application shell', () => {
  it('reports missing inventory, hardware, and restore evidence', () => {
    render(<App />);

    expect(screen.getByText(messages.inventoryValue)).toBeTruthy();
    expect(screen.getByText(messages.hardwareValue)).toBeTruthy();
    expect(screen.getByText(messages.restoreValue)).toBeTruthy();
  });
});
