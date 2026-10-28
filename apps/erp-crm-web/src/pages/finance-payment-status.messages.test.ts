import { describe, expect, it } from 'vitest';

import { financePaymentStatusMessages } from './finance-payment-status.messages';

describe('Finance payment status language', () => {
  it('keeps matching English and Bulgarian labels', () => {
    const en = financePaymentStatusMessages('en');
    const bg = financePaymentStatusMessages('bg');
    expect(Object.keys(bg)).toEqual(Object.keys(en));
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(bg[key]).toMatch(/[А-Яа-я]/u);
      expect(en[key]).not.toContain('—');
      expect(bg[key]).not.toContain('—');
    }
  });
});
