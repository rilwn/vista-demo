import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LocalizationProvider, useLocalization } from './LocalizationProvider';
import { TranslationBoundary } from './TranslationBoundary';
import { posText } from './catalog';

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
          <p translate="no">Return</p>
          <p>{posText('{count} products · live availability', { count: 2 })}</p>
          <button aria-label={posText('Increase {name} quantity', { name: 'Return' })}>+</button>
          <button>Print Z report &amp; close</button>
          <p>
            Last-known prices and stock are shown. Offline cash sales use the connected DATECS
            device. Saved customer records, prices, and available serials can be used. Lot-tracked
            products require a selected available batch. Promotions, discounts, and loyalty points
            are unavailable offline.
          </p>
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

    await act(() => fireEvent.click(screen.getByRole('button', { name: 'BG' })));
    expect(await screen.findByRole('heading', { name: 'Нова продажба' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Текуща кошница' })).toBeTruthy();
    expect(screen.getByPlaceholderText('Търсене на клиенти')).toBeTruthy();
    expect(screen.getByText('Alfa Market Demo Ltd.')).toBeTruthy();
    expect(screen.getByText('Return')).toBeTruthy();
    expect(screen.getByText('2 продукта · текуща наличност')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Увеличаване на количеството за Return' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Отпечатване на отчет Z и затваряне' })).toBeTruthy();
    expect(
      screen.getByText(
        'Офлайн продажбите в брой използват последните запазени цени и наличности и свързаното устройство DATECS. Могат да се използват запазените клиентски данни и налични серийни номера. За продуктите с проследяване по партиди изберете налична партида. Промоциите, отстъпките и използването на точки не са достъпни офлайн.',
      ),
    ).toBeTruthy();

    await act(() => fireEvent.click(screen.getByRole('button', { name: 'EN' })));
    expect(await screen.findByRole('heading', { name: 'New sale' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Increase Return quantity' })).toBeTruthy();
  });
});
