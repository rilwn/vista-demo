import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App';
import { messages } from './messages';

describe('POS application shell', () => {
  it('does not claim offline or fiscal readiness', () => {
    render(<App />);

    expect(screen.getByText(messages.offlineValue)).toBeTruthy();
    expect(screen.getByText(messages.fiscalValue)).toBeTruthy();
  });
});
