import { describe, expect, it } from 'vitest';
import { recurringInvoiceMessages } from './recurring-invoice.messages';

describe('recurring invoice copy', () => {
  it('has reviewed Bulgarian copy for every English label, state and error', () => {
    const english = recurringInvoiceMessages('en');
    const bulgarian = recurringInvoiceMessages('bg');
    expect(Object.keys(bulgarian).sort()).toEqual(Object.keys(english).sort());
    for (const key of Object.keys(english) as (keyof typeof english)[]) {
      expect(bulgarian[key]).toMatch(/[А-Яа-я]/u);
      expect(bulgarian[key]).not.toBe(english[key]);
      expect(english[key]).not.toContain('—');
    }
  });
});
