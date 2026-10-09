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
          <span>Active drafts</span>
          <span>Invoices</span>
          <span>Proformas</span>
          <span>Correction notes</span>
          <span>Quotation sent</span>
          <span>Negotiation</span>
          <span>Lost</span>
          <span>Converted</span>
          <span>Needs attention</span>
          <span>On the way</span>
          <span>Planned</span>
          <span>Registered</span>
          <span>Under repair</span>
          <span>Retired</span>
          <span>Awaiting response</span>
          <span>Under review</span>
          <span>Promoter</span>
          <span>Passive</span>
          <span>Detractor</span>
          <span>ERP · Logistics</span>
          <button>Create</button>
          <button>Update</button>
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

    await act(() => fireEvent.click(screen.getByRole('button', { name: 'BG' })));
    expect(await screen.findByRole('heading', { name: 'Фактури от доставчици' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Регистър на доставчиците' })).toBeTruthy();
    expect(screen.getByPlaceholderText('Търсене на гаранционни карти')).toBeTruthy();
    expect(screen.getByText('Alfa Market Demo Ltd.')).toBeTruthy();
    for (const label of ['Активни чернови', 'Фактури', 'Проформи', 'Кредитни и дебитни известия'])
      expect(screen.getByText(label)).toBeTruthy();
    for (const label of [
      'Изпратена оферта',
      'Договаряне',
      'Загубена',
      'Преобразуван',
      'Изисква внимание',
      'На път',
      'Планиран',
      'Регистриран',
      'В ремонт',
      'Изведено от употреба',
      'Очаква отговор',
      'В процес на преглед',
      'Привърженик',
      'Неутрален клиент',
      'Недоволен клиент',
      'ERP · Логистика',
      'Създаване',
      'Обновяване',
    ])
      expect(screen.getByText(label)).toBeTruthy();

    await act(() => fireEvent.click(screen.getByRole('button', { name: 'EN' })));
    expect(await screen.findByRole('heading', { name: 'Supplier invoices' })).toBeTruthy();
    expect(screen.getByText('Active drafts')).toBeTruthy();
    expect(screen.getByText('Quotation sent')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
  });
});
