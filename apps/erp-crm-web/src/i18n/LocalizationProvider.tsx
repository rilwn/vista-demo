import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { bulgarianCatalog, englishCatalog, type TranslationKey } from './catalog';

export type OperationsLocale = 'bg' | 'en';

interface LocalizationContextValue {
  dateLocale: string;
  locale: OperationsLocale;
  setLocale: (locale: OperationsLocale) => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
}

const STORAGE_KEY = 'vista.operations.locale';
let activeLocale: OperationsLocale = 'en';
const defaultLocalization: LocalizationContextValue = {
  dateLocale: 'en-GB',
  locale: 'en',
  setLocale: () => undefined,
  t: (key, values) => interpolate(englishCatalog[key], values),
};
const LocalizationContext = createContext<LocalizationContextValue>(defaultLocalization);

export function LocalizationProvider({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<OperationsLocale>(readInitialLocale);
  activeLocale = locale;

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem(STORAGE_KEY, locale);
  }, [locale]);

  const setLocale = useCallback((value: OperationsLocale) => {
    activeLocale = value;
    setLocaleState(value);
  }, []);
  const t = useCallback(
    (key: TranslationKey, values?: Record<string, string | number>) => {
      const template = locale === 'bg' ? bulgarianCatalog[key] : englishCatalog[key];
      return interpolate(template, values);
    },
    [locale],
  );
  const value = useMemo(
    () => ({ dateLocale: locale === 'bg' ? 'bg-BG' : 'en-GB', locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}

export function getOperationsLocale(): OperationsLocale {
  return activeLocale;
}

export function useLocalization(): LocalizationContextValue {
  return useContext(LocalizationContext);
}

function readInitialLocale(): OperationsLocale {
  if (typeof window === 'undefined') return 'en';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'bg' ? 'bg' : 'en';
}

function interpolate(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/gu, (_, key: string) => String(values[key] ?? `{${key}}`));
}
