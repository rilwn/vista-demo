import { Icon } from './Icon';
import { useLocalization } from '../i18n/LocalizationProvider';

export function LanguageSwitcher({ placement = 'topbar' }: { placement?: 'login' | 'topbar' }) {
  const { locale, setLocale, t } = useLocalization();
  return (
    <div
      aria-label={t('language.label')}
      className={`language-switcher is-${placement}`}
      role="group"
    >
      <Icon name="language" size={16} />
      <button
        aria-pressed={locale === 'en'}
        className={locale === 'en' ? 'is-active' : undefined}
        onClick={() => setLocale('en')}
        title={t('language.switchToEnglish')}
        type="button"
      >
        EN
      </button>
      <span aria-hidden="true" />
      <button
        aria-pressed={locale === 'bg'}
        className={locale === 'bg' ? 'is-active' : undefined}
        onClick={() => setLocale('bg')}
        title={t('language.switchToBulgarian')}
        type="button"
      >
        BG
      </button>
    </div>
  );
}
