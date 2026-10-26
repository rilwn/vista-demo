import { describe, expect, it } from 'vitest';
import { posInvoiceMessages } from './pos-invoice.messages';
describe('POS invoice language coverage', () => {
  it('provides matching English and Bulgarian labels without empty text', () => {
    const en = posInvoiceMessages('en'),
      bg = posInvoiceMessages('bg');
    expect(Object.keys(en)).toEqual(Object.keys(bg));
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(bg[key]).toMatch(/[А-Яа-я]/u);
      expect(en[key]).not.toContain('—');
      expect(bg[key]).not.toContain('—');
    }
  });
});
