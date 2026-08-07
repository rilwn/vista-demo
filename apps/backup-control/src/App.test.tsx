import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App';
import { messages } from './messages';

describe('backup-control application shell', () => {
  it('presents a controlled backup and disaster-recovery workspace', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Backup operations' })).toBeTruthy();
    expect(screen.getByText(messages.status)).toBeTruthy();
    expect(screen.getByText('Source inventory')).toBeTruthy();
    expect(screen.getByText('No approved records')).toBeTruthy();
  });
});
