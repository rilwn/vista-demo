import { describe, expect, it } from 'vitest';
import { posRefundMessages } from './pos-refund.messages';
describe('POS repayment language coverage', () => {
  it('provides Bulgarian labels and clear confirmation without internal terminology', () => {
    const en = posRefundMessages('en'),
      bg = posRefundMessages('bg');
    expect(Object.keys(bg)).toEqual(Object.keys(en));
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(bg[key]).toMatch(/[А-Яа-я]/u);
      expect(en[key]).not.toContain('—');
      expect(bg[key]).not.toContain('—');
    }
    expect(en.help).toContain('does not send money');
  });
});
