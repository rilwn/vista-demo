import { useLocalization } from './LocalizationProvider';

export function LanguageSwitcher({ floating = false }: { floating?: boolean }) {
  const { locale, setLocale } = useLocalization();
  return (
    <div
      aria-label={locale === 'bg' ? 'Език на интерфейса' : 'Interface language'}
      className={`recovery-language-switcher${floating ? ' is-floating' : ''}`}
      role="group"
    >
      <button aria-pressed={locale === 'en'} onClick={() => setLocale('en')} type="button">
        EN
      </button>
      <button aria-pressed={locale === 'bg'} onClick={() => setLocale('bg')} type="button">
        BG
      </button>
    </div>
  );
}
