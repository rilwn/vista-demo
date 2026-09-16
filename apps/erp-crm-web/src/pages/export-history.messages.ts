import { getOperationsLocale } from '../i18n/LocalizationProvider';

const english = {
  loading: 'Loading your files…',
  error: 'Your files could not be loaded. Select Refresh to try again.',
  previous: 'Previous exports',
  next: 'Next exports',
  label: 'Export history pages',
  page: (page: number, pages: number) => `Page ${page} of ${Math.max(1, pages)}`,
};

const bulgarian = {
  loading: 'Зареждане на файловете…',
  error: 'Файловете не могат да бъдат заредени. Изберете Обновяване и опитайте отново.',
  previous: 'Предишни експорти',
  next: 'Следващи експорти',
  label: 'Страници с история на експортите',
  page: (page: number, pages: number) => `Страница ${page} от ${Math.max(1, pages)}`,
};

export const exportHistoryText = new Proxy(english, {
  get(target, property, receiver) {
    return Reflect.get(getOperationsLocale() === 'bg' ? bulgarian : target, property, receiver);
  },
});
