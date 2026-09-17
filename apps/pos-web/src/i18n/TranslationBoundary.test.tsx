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
        <section aria-label="Current sale basket">
          <h1>New sale</h1>
          <input placeholder="Search customers" />
          <p>Alfa Market Demo Ltd.</p>
        </section>
      </TranslationBoundary>
    </>
  );
}

describe('POS localization', () => {
  it('switches interface copy and preserves business data', async () => {
    window.localStorage.setItem('vista.pos.locale', 'en');
    render(
      <LocalizationProvider>
        <Fixture />
      </LocalizationProvider>,
    );

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'BG' })));
    expect(await screen.findByRole('heading', { name: 'Нова продажба' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Текуща кошница' })).toBeTruthy();
    expect(screen.getByPlaceholderText('Търсене на клиенти')).toBeTruthy();
    expect(screen.getByText('Alfa Market Demo Ltd.')).toBeTruthy();

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'EN' })));
    expect(await screen.findByRole('heading', { name: 'New sale' })).toBeTruthy();
  });
});
