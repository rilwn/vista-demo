import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LocalizationProvider, useLocalization } from './LocalizationProvider';
import { TranslationBoundary } from './TranslationBoundary';
import { recoveryLabel } from './catalog';

function Fixture() {
  const { locale, setLocale } = useLocalization();
  return (
    <>
      <button onClick={() => setLocale('bg')}>BG</button>
      <button onClick={() => setLocale('en')}>EN</button>
      <TranslationBoundary>
        <section aria-label="Readiness state">
          <h1>Backup operations</h1>
          <p>Primary PostgreSQL</p>
          <p translate="no">full</p>
          <p>{recoveryLabel('object_storage', locale)}</p>
          <p>{recoveryLabel('pending_approval', locale)}</p>
          <input placeholder="Search by file name or storage key" />
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
    await act(() => fireEvent.click(screen.getByRole('button', { name: 'BG' })));
    expect(await screen.findByRole('heading', { name: 'Операции по архивиране' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Състояние на готовността' })).toBeTruthy();
    expect(screen.getByText('Primary PostgreSQL')).toBeTruthy();
    expect(screen.getByText('full')).toBeTruthy();
    expect(screen.getByText('Обектно хранилище')).toBeTruthy();
    expect(screen.getByText('Очаква одобрение')).toBeTruthy();
    expect(
      screen.getByPlaceholderText('Търсете по име на файл или ключ в хранилището'),
    ).toBeTruthy();
    await act(() => fireEvent.click(screen.getByRole('button', { name: 'EN' })));
    expect(await screen.findByRole('heading', { name: 'Backup operations' })).toBeTruthy();
    expect(screen.getByText('Object storage')).toBeTruthy();
    expect(screen.getByText('Awaiting approval')).toBeTruthy();
  });
});
