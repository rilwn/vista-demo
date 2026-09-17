import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type RecoveryLocale = 'bg' | 'en';
interface LocalizationContextValue {
  locale: RecoveryLocale;
  setLocale: (locale: RecoveryLocale) => void;
}

const STORAGE_KEY = 'vista.recovery.locale';
const Context = createContext<LocalizationContextValue>({
  locale: 'en',
  setLocale: () => undefined,
});

export function LocalizationProvider({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<RecoveryLocale>(() =>
    localStorage.getItem(STORAGE_KEY) === 'bg' ? 'bg' : 'en',
  );
  const setLocale = useCallback((value: RecoveryLocale) => setLocaleState(value), []);
  useEffect(() => {
    document.documentElement.lang = locale;
    localStorage.setItem(STORAGE_KEY, locale);
  }, [locale]);
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLocalization() {
  return useContext(Context);
}
