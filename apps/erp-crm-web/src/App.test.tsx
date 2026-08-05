import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App';
import { messages } from './messages';

describe('ERP and CRM application shell', () => {
  it('identifies the module and reports that acceptance is still pending', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: messages.title })).toBeTruthy();
    expect(screen.getByText(messages.securityValue)).toBeTruthy();
  });
});
