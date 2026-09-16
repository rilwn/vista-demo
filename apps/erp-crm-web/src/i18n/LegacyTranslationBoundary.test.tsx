import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LegacyTranslationBoundary } from './LegacyTranslationBoundary';
import { LocalizationProvider, useLocalization } from './LocalizationProvider';

function Fixture() {
  const { setLocale } = useLocalization();
  return (
    <>
      <button onClick={() => setLocale('bg')}>BG</button>
      <button onClick={() => setLocale('en')}>EN</button>
      <LegacyTranslationBoundary>
        <section aria-label="Supplier register">
          <h1>Supplier invoices</h1>
          <input placeholder="Search warranty cards" />
          <p>Alfa Market Demo Ltd.</p>
        </section>
      </LegacyTranslationBoundary>
    </>
  );
}

describe('LegacyTranslationBoundary', () => {
  it('switches reviewed interface copy without changing business data', async () => {
    window.localStorage.setItem('vista.operations.locale', 'en');
    render(
      <LocalizationProvider>
        <Fixture />
      </LocalizationProvider>,
    );

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'BG' })));
    expect(await screen.findByRole('heading', { name: 'Фактури от доставчици' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Регистър на доставчиците' })).toBeTruthy();
    expect(screen.getByPlaceholderText('Търсене на гаранционни карти')).toBeTruthy();
    expect(screen.getByText('Alfa Market Demo Ltd.')).toBeTruthy();

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'EN' })));
    expect(await screen.findByRole('heading', { name: 'Supplier invoices' })).toBeTruthy();
  });
});
