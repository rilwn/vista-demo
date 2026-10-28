import { describe, expect, it } from 'vitest';

import { ApiClientError } from './api/client';
import { posApiErrorMessage } from './messages';

describe('POS API error copy', () => {
  it('shows terminal outcomes in Bulgarian when Bulgarian is selected', () => {
    expect(
      posApiErrorMessage(
        new ApiClientError('The card payment was declined.', 'POS_CARD_PAYMENT_DECLINED', 409),
        'bg',
      ),
    ).toBe('Плащането с карта е отказано. Използвайте друг начин на плащане.');
    expect(
      posApiErrorMessage(
        new ApiClientError(
          'Check the terminal before retrying.',
          'POS_CARD_PAYMENT_OUTCOME_UNKNOWN',
          503,
        ),
        'bg',
      ),
    ).toBe(
      'Не може да се потвърди отговорът на терминала. Проверете терминала, преди да повторите.',
    );
  });

  it('preserves server copy in English and for unrecognized errors', () => {
    expect(
      posApiErrorMessage(new ApiClientError('Declined.', 'POS_CARD_PAYMENT_DECLINED', 409), 'en'),
    ).toBe('Declined.');
    expect(posApiErrorMessage(new ApiClientError('Other error.', 'OTHER_ERROR', 409), 'bg')).toBe(
      'Other error.',
    );
  });
});
