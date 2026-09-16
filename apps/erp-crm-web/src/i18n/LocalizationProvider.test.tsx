import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { messages } from './legacyMessages';
import { LocalizationProvider, useLocalization } from './LocalizationProvider';

function TranslationProbe() {
  const { t } = useLocalization();
  return (
    <>
      <p>{t('navigation.overview')}</p>
      <p>{messages.access.title}</p>
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
    fireEvent.click(screen.getByRole('button', { name: 'BG' }));

    expect(screen.getByText('Общ преглед')).toBeTruthy();
    expect(screen.getByText('Моят достъп')).toBeTruthy();
    expect(window.localStorage.getItem('vista.operations.locale')).toBe('bg');
    expect(document.documentElement.lang).toBe('bg');
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
