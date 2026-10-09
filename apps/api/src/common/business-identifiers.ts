import { HttpStatus } from '@nestjs/common';
import { businessIdentifierIssues } from '@vista/domain';

import { ApiErrorException } from './api-error.exception.js';

export function assertBusinessIdentifiers(input: {
  uic?: string | null;
  vatNumber?: string | null;
}): void {
  const issues = businessIdentifierIssues(input);
  if (!issues.length) return;

  throw new ApiErrorException(
    'BUSINESS_IDENTIFIER_INVALID',
    'Review the UIC and VAT number.',
    HttpStatus.BAD_REQUEST,
    issues.map(({ field, reason }) => ({
      field,
      message:
        reason === 'invalid_bulgarian_uic'
          ? 'Enter a 9- or 13-digit Bulgarian UIC with a correct check digit.'
          : 'Enter a VAT number in a supported EU format, such as BG followed by 9 or 10 digits.',
    })),
  );
}
