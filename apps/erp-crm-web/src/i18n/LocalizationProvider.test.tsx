import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { messages } from './legacyMessages';
import { reportDate, reportDecimal } from '../pages/erp-report-display';
import {
  formatOperationsCurrency,
  formatOperationsDate,
  formatOperationsMinorCurrency,
  formatOperationsNumber,
  getOperationsIntlLocale,
  LocalizationProvider,
  useLocalization,
} from './LocalizationProvider';
import { securityText } from './securityMessages';

function TranslationProbe() {
  const { t } = useLocalization();
  return (
    <>
      <p>{t('navigation.overview')}</p>
      <p>{messages.access.title}</p>
      <p>{securityText.fixtureRoleDescription('manager')}</p>
      <p>{securityText.actionName('approve')}</p>
    </>
  );
}

describe('Operations localization', () => {
  afterEach(cleanup);

  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = 'en';
  });

  it('switches the interface to Bulgarian and remembers the choice', () => {
    render(
      <LocalizationProvider>
        <LanguageSwitcher />
        <TranslationProbe />
      </LocalizationProvider>,
    );

    expect(screen.getByText('Overview')).toBeTruthy();
    expect(getOperationsIntlLocale()).toBe('en-GB');
    expect(
      screen.getByText(
        'Broad access across ERP, CRM, reports, and POS review. Cashier actions remain with the POS Operator role.',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'BG' }));

    expect(screen.getByText('Общ преглед')).toBeTruthy();
    expect(screen.getByText('Моят достъп')).toBeTruthy();
    expect(screen.getByText('Одобряване')).toBeTruthy();
    expect(
      screen.getByText(
        'Широк достъп до ERP, CRM, справки и преглед на POS. Касовите операции са за ролята POS оператор.',
      ),
    ).toBeTruthy();
    expect(window.localStorage.getItem('vista.operations.locale')).toBe('bg');
    expect(document.documentElement.lang).toBe('bg');
    expect(getOperationsIntlLocale()).toBe('bg-BG');
    expect(
      formatOperationsNumber(12345.5, {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      }).replace(/[\u00a0\u202f]/gu, ' '),
    ).toBe('12 345,50');
    expect(formatOperationsCurrency('12345.56', 'EUR').replace(/[\u00a0\u202f]/gu, ' ')).toContain(
      '12 345,56 EUR',
    );
    expect(
      formatOperationsCurrency('12345678901234567890.12', 'EUR').replace(/[\u00a0\u202f]/gu, ' '),
    ).toContain('12 345 678 901 234 567 890,12 EUR');
    expect(formatOperationsCurrency('1.005', 'EUR')).toContain('1,01');
    expect(formatOperationsCurrency('-0.50', 'EUR')).toContain('-0,50');
    expect(
      formatOperationsMinorCurrency(123456789012345678901n, 'EUR').replace(/[\u00a0\u202f]/gu, ' '),
    ).toContain('1 234 567 890 123 456 789,01 EUR');
    expect(reportDecimal('12345.60', true).replace(/[\u00a0\u202f]/gu, ' ')).toBe('12 345,60');
    expect(reportDate('2026-09-08')).not.toContain('Sept');
    expect(formatOperationsNumber(0.205, { maximumFractionDigits: 1, style: 'percent' })).toContain(
      '20,5%',
    );
    expect(
      formatOperationsDate(new Date('2026-10-09T12:00:00.000Z'), {
        dateStyle: 'medium',
        timeZone: 'UTC',
      }),
    ).not.toContain('Oct');
  });

  it('loads the saved Bulgarian preference', () => {
    window.localStorage.setItem('vista.operations.locale', 'bg');
    render(
      <LocalizationProvider>
        <TranslationProbe />
      </LocalizationProvider>,
    );

    expect(screen.getByText('Общ преглед')).toBeTruthy();
  });
});
