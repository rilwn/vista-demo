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

export function getOperationsIntlLocale(): 'bg-BG' | 'en-GB' {
  return activeLocale === 'bg' ? 'bg-BG' : 'en-GB';
}

export function formatOperationsNumber(
  value: number | bigint,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(getOperationsIntlLocale(), options).format(value);
}

export function formatOperationsCurrency(
  value: number | string,
  currency: string,
  options?: Omit<
    Intl.NumberFormatOptions,
    'currency' | 'currencyDisplay' | 'currencySign' | 'style'
  >,
): string {
  const locale = getOperationsIntlLocale();
  const currencyDigits = new Intl.NumberFormat(locale, {
    currency,
    style: 'currency',
  }).resolvedOptions();
  const minimum = options?.minimumFractionDigits ?? currencyDigits.minimumFractionDigits ?? 2;
  const maximum = options?.maximumFractionDigits ?? currencyDigits.maximumFractionDigits ?? 2;
  const formatter = new Intl.NumberFormat(locale, {
    ...options,
    maximumFractionDigits: maximum,
    minimumFractionDigits: minimum,
    style: 'decimal',
  });
  const decimal = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!decimal) {
    const amount = formatter.format(typeof value === 'string' ? Number(value) : value);
    return `${amount} ${currency}`;
  }

  const factor = 10n ** BigInt(maximum);
  const fraction = decimal[3] ?? '';
  let scaledFraction = BigInt(fraction.slice(0, maximum).padEnd(maximum, '0') || '0');
  if (fraction.length > maximum && fraction[maximum]! >= '5') scaledFraction += 1n;
  let whole = BigInt(decimal[2]!);
  if (scaledFraction >= factor) {
    whole += 1n;
    scaledFraction -= factor;
  }
  const roundedFraction = scaledFraction
    .toString()
    .padStart(maximum, '0')
    .replace(/0+$/u, '')
    .padEnd(minimum, '0');
  const negative = decimal[1] === '-';
  const signedWhole = negative ? (whole === 0n ? -0 : -whole) : whole;
  const amount = formatter
    .formatToParts(signedWhole)
    .map((part) => (part.type === 'fraction' ? roundedFraction : part.value))
    .join('');
  return `${amount} ${currency}`;
}

export function formatOperationsMinorCurrency(value: bigint, currency: string): string {
  const absolute = value < 0n ? -value : value;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  const amount = `${value < 0n ? '-' : ''}${whole}.${fraction}`;
  return formatOperationsCurrency(amount, currency, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

export function formatOperationsDate(
  value: Date | number,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(getOperationsIntlLocale(), options).format(value);
}

export function formatOperationsDateRange(
  from: Date | number,
  to: Date | number,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(getOperationsIntlLocale(), options).formatRange(from, to);
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
