import { getOperationsLocale } from '../i18n/LocalizationProvider';

const english = {
  saved: 'My saved reports',
  open: 'Open a saved report',
  empty: 'No saved reports yet',
  fields: 'Fields to include',
  chooseField: 'Choose at least one field.',
  name: 'Save these options',
  save: 'Save as new report',
  success: 'Report saved. Open it again from My saved reports.',
  failure: 'The report could not be saved. Please try again.',
  previous: 'Previous saved reports',
  next: 'Next saved reports',
  invalidPeriod: 'Choose a start date on or before the end date.',
} as const;

const bulgarian = {
  saved: 'Моите запазени справки',
  open: 'Отваряне на запазена справка',
  empty: 'Все още няма запазени справки',
  fields: 'Полета за включване',
  chooseField: 'Изберете поне едно поле.',
  name: 'Запазване на тези настройки',
  save: 'Запазване като нова справка',
  success: 'Справката е запазена. Отворете я от Моите запазени справки.',
  failure: 'Справката не може да бъде запазена. Опитайте отново.',
  previous: 'Предишни запазени справки',
  next: 'Следващи запазени справки',
  invalidPeriod: 'Изберете начална дата, която е преди или равна на крайната.',
} as const;

export const savedReportMessages = new Proxy(english, {
  get(target, property, receiver) {
    return Reflect.get(getOperationsLocale() === 'bg' ? bulgarian : target, property, receiver);
  },
});
