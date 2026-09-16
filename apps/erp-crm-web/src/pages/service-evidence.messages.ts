import { getOperationsLocale } from '../i18n/LocalizationProvider';

const english = {
  loading: 'Loading image…',
  unavailable: 'This image could not be loaded.',
  retry: 'Try again',
  download: 'Download',
  refreshFailed: 'The Service list could not be refreshed. Your open record has been kept.',
  refresh: 'Refresh list',
  photo: (name: string) => `Service photo: ${name}`,
  signature: (name: string) => `Signature from ${name}`,
  signatureCaption: (name: string) => `Customer signature · ${name}`,
};

const bulgarian = {
  loading: 'Зареждане на изображението…',
  unavailable: 'Изображението не може да бъде заредено.',
  retry: 'Опитайте отново',
  download: 'Изтегляне',
  refreshFailed: 'Сервизният списък не може да бъде обновен. Отвореният запис е запазен.',
  refresh: 'Обновяване на списъка',
  photo: (name: string) => `Сервизна снимка: ${name}`,
  signature: (name: string) => `Подпис от ${name}`,
  signatureCaption: (name: string) => `Подпис на клиента · ${name}`,
};

export const serviceEvidenceText = new Proxy(english, {
  get(target, property, receiver) {
    return Reflect.get(getOperationsLocale() === 'bg' ? bulgarian : target, property, receiver);
  },
});
