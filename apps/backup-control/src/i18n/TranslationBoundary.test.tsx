import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LocalizationProvider, useLocalization } from './LocalizationProvider';
import { TranslationBoundary } from './TranslationBoundary';

function Fixture() {
  const { setLocale } = useLocalization();
  return (
    <>
      <button onClick={() => setLocale('bg')}>BG</button>
      <button onClick={() => setLocale('en')}>EN</button>
      <TranslationBoundary>
        <section aria-label="Readiness state">
          <h1>Backup operations</h1>
          <p>Primary PostgreSQL</p>
        </section>
      </TranslationBoundary>
    </>
  );
}

describe('Recovery localization', () => {
  it('switches reviewed interface text without changing infrastructure data', async () => {
    localStorage.setItem('vista.recovery.locale', 'en');
    render(
      <LocalizationProvider>
        <Fixture />
      </LocalizationProvider>,
    );
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'BG' })));
    expect(await screen.findByRole('heading', { name: 'Операции по архивиране' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Състояние на готовността' })).toBeTruthy();
    expect(screen.getByText('Primary PostgreSQL')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'EN' })));
    expect(await screen.findByRole('heading', { name: 'Backup operations' })).toBeTruthy();
  });
});
