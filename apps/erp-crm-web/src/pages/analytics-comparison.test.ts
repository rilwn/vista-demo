import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { LocalizationProvider } from '../i18n/LocalizationProvider';
import { comparison } from './analytics-comparison';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('analytics comparisons', () => {
  it('never describes a negative value against zero as a positive trend', () => {
    expect(comparison('-100', '0')).toEqual({ label: 'No earlier value to compare', tone: 'down' });
    expect(comparison('100', '0')).toEqual({
      label: 'No earlier value to compare',
      tone: 'neutral',
    });
  });
  it('uses the correct sign with negative previous values', () => {
    expect(comparison('-200', '-100').tone).toBe('down');
    expect(comparison('-50', '-100').tone).toBe('up');
  });
  it('keeps equal and unavailable values neutral, and points absolute', () => {
    expect(comparison('0', '0').tone).toBe('neutral');
    expect(comparison('invalid', '100').tone).toBe('neutral');
    expect(comparison('20', '0', 'points').label).toContain('20.0 points');
  });
  it('uses the active locale for percentage decimals', () => {
    render(createElement(LocalizationProvider, null, createElement(LanguageSwitcher)));
    fireEvent.click(screen.getByRole('button', { name: 'BG' }));
    expect(comparison('120', '100').label).toContain('20,0%');
  });
});
