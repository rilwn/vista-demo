import type { BusinessIdentifierIssue } from '@vista/domain';

import { getOperationsLocale } from './LocalizationProvider';

export function businessIdentifierIssueMessage(issue: BusinessIdentifierIssue): string {
  if (getOperationsLocale() === 'bg') {
    return issue.reason === 'invalid_bulgarian_uic'
      ? 'Въведете валиден български ЕИК: 9 или 13 цифри с правилна контролна цифра.'
      : 'Въведете ДДС номер в поддържан формат за ЕС, например BG и 9 или 10 цифри.';
  }
  return issue.reason === 'invalid_bulgarian_uic'
    ? 'Enter a 9- or 13-digit Bulgarian UIC with a correct check digit.'
    : 'Enter a VAT number in a supported EU format, such as BG followed by 9 or 10 digits.';
}
