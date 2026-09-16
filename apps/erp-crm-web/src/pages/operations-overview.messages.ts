import { getOperationsLocale } from '../i18n/LocalizationProvider';

const english = {
  customize: 'Customize overview',
  chooseCards: 'Cards to show',
  saveCards: 'Save layout',
  saving: 'Saving',
  showAll: 'Show all cards',
  preferencesHint: 'Saved for your account. Select Save layout to apply your choices.',
  preferencesSaved: 'Your overview layout is saved.',
  preferencesError: 'Your layout could not be saved. Try again.',
  preferencesConflict:
    'Your layout changed in another window. Select Apply above to reload it before saving again.',
  hidden: 'All cards are hidden. Open Customize overview to show them again.',
  label: 'Business overview',
  from: 'Revenue from',
  to: 'Revenue to',
  warrantiesWithin: 'Warranties ending within',
  days: (days: number) => `${days} days`,
  apply: 'Apply',
  updating: 'Updating',
  loading: 'Loading business overview…',
  error: 'The overview could not be loaded. Select Apply to try again.',
  revenue: 'Recorded revenue',
  service: 'Active Service requests',
  warranties: 'Warranties ending soon',
  overdue: 'Overdue receivables',
  financeLink: 'Review Finance reports',
  serviceLink: 'Open Service requests',
  warrantiesLink: 'Review warranties',
  collectionsLink: 'Open collections',
  asOf: (date: string) => `As of ${date}`,
  nextDays: (days: number) => `Within the next ${days} days`,
  revenueNote: 'Revenue includes prepared documents, before VAT, not posted accounting revenue.',
  details: 'How these figures are calculated',
  revenueDetails:
    'Invoices and debit notes less credit notes, before VAT, for the selected period. Proformas and cancelled documents are excluded.',
  serviceDetails: 'New, scheduled and in-progress requests at the current date.',
  warrantyDetails:
    'Active equipment whose warranty ends within the selected window, starting today.',
  overdueDetails:
    'Positive unpaid balances past their due date, using each document’s saved exchange rate. Cancelled collections are excluded.',
} as const;

const bulgarian = {
  customize: 'Настройване на прегледа',
  chooseCards: 'Карти за показване',
  saveCards: 'Запазване на подредбата',
  saving: 'Запазване',
  showAll: 'Показване на всички карти',
  preferencesHint: 'Запазва се за вашия профил. Изберете Запазване на подредбата.',
  preferencesSaved: 'Подредбата на прегледа е запазена.',
  preferencesError: 'Подредбата не може да бъде запазена. Опитайте отново.',
  preferencesConflict: 'Подредбата е променена в друг прозорец. Приложете отново преди запазване.',
  hidden: 'Всички карти са скрити. Отворете Настройване на прегледа, за да ги покажете.',
  label: 'Бизнес преглед',
  from: 'Приходи от',
  to: 'Приходи до',
  warrantiesWithin: 'Гаранции, изтичащи до',
  days: (days: number) => `${days} дни`,
  apply: 'Прилагане',
  updating: 'Обновяване',
  loading: 'Зареждане на бизнес прегледа…',
  error: 'Прегледът не може да бъде зареден. Изберете Прилагане.',
  revenue: 'Регистрирани приходи',
  service: 'Активни сервизни заявки',
  warranties: 'Гаранции, изтичащи скоро',
  overdue: 'Просрочени вземания',
  financeLink: 'Преглед на финансовите справки',
  serviceLink: 'Отваряне на сервизните заявки',
  warrantiesLink: 'Преглед на гаранциите',
  collectionsLink: 'Отваряне на вземанията',
  asOf: (date: string) => `Към ${date}`,
  nextDays: (days: number) => `През следващите ${days} дни`,
  revenueNote: 'Приходите включват подготвени документи преди ДДС, а не осчетоводени приходи.',
  details: 'Как се изчисляват тези стойности',
  revenueDetails:
    'Фактури и дебитни известия минус кредитни известия, преди ДДС, за избрания период. Проформи и анулирани документи не се включват.',
  serviceDetails: 'Нови, планирани и текущи заявки към настоящата дата.',
  warrantyDetails: 'Активно оборудване с гаранция, изтичаща в избрания период от днес.',
  overdueDetails:
    'Положителни неплатени салда след падежа по запазения валутен курс. Анулираните вземания не се включват.',
} as const;

export const overviewMessages = new Proxy(english, {
  get(target, property, receiver) {
    return Reflect.get(getOperationsLocale() === 'bg' ? bulgarian : target, property, receiver);
  },
});
