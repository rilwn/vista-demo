import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type PosLocale = 'bg' | 'en';

interface LocalizationContextValue {
  locale: PosLocale;
  setLocale: (locale: PosLocale) => void;
}

const STORAGE_KEY = 'vista.pos.locale';
let activeLocale: PosLocale = 'en';
const LocalizationContext = createContext<LocalizationContextValue>({
  locale: 'en' as PosLocale,
  setLocale: () => undefined,
});

export function LocalizationProvider({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<PosLocale>(() =>
    window.localStorage.getItem(STORAGE_KEY) === 'bg' ? 'bg' : 'en',
  );
  activeLocale = locale;
  const setLocale = useCallback((value: PosLocale) => setLocaleState(value), []);

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem(STORAGE_KEY, locale);
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}

export function useLocalization() {
  return useContext(LocalizationContext);
}

export function getPosDateLocale() {
  return activeLocale === 'bg' ? 'bg-BG' : 'en-GB';
}

export function getPosLocale() {
  return activeLocale;
}
