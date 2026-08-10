import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from './App';
import { messages } from './messages';

afterEach(cleanup);

describe('backup-control application shell', () => {
  it('presents a controlled backup and disaster-recovery workspace', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Backup operations' })).toBeTruthy();
    expect(screen.getByText(messages.status)).toBeTruthy();
    expect(screen.getByText('Source inventory')).toBeTruthy();
    expect(screen.getByText('No records yet')).toBeTruthy();
  });

  it('keeps every backup and recovery page reachable from the navigation', () => {
    render(<App />);

    for (const [navigationLabel, heading] of [
      ['Restores & approvals', 'Restore requests & approvals'],
      ['Alerts & audit', 'Alerts & audit'],
      ['DR tests', 'Disaster recovery tests'],
      ['Jobs & restore points', 'Jobs & restore points'],
      ['Policies & schedules', 'Policies & schedules'],
      ['Sources & inventory', 'Sources & data inventory'],
      ['Overview', 'Backup operations'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: navigationLabel }));
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
  });
});
