import type { ApiClientError } from './api/client';

export const messages = {
  status: 'No sales enabled',
  advanceInvalid: 'Enter zero or a positive advance amount.',
  advanceAboveBalance: 'The amount is higher than the available advance.',
  advanceAboveTotal: 'The advance amount cannot exceed the sale total.',
} as const;

export function posApiErrorMessage(error: ApiClientError, locale: 'bg' | 'en'): string {
  if (locale !== 'bg') return error.message;
  const translated: Record<string, string> = {
    POS_CARD_PAYMENT_DECLINED: 'Плащането с карта е отказано. Използвайте друг начин на плащане.',
    POS_CARD_PAYMENT_OUTCOME_UNKNOWN:
      'Не може да се потвърди отговорът на терминала. Проверете терминала, преди да повторите.',
  };
  return translated[error.code] ?? error.message;
}
