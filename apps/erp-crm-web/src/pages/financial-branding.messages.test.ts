import { describe, expect, it } from 'vitest';
import { financialBrandingMessages } from './financial-branding.messages';

describe('financial document settings copy', () => {
  it('covers every label and error in Bulgarian without internal wording', () => {
    const en = financialBrandingMessages('en');
    const bg = financialBrandingMessages('bg');
    expect(Object.keys(bg).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(bg[key]).toMatch(/[А-Яа-я]/u);
      expect(bg[key]).not.toBe(en[key]);
      expect(en[key]).not.toContain('—');
    }
  });
});
