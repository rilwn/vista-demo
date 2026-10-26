import { describe, expect, it } from 'vitest';
import { posAccountMessages } from './pos-account.messages';
describe('POS account payment languages', () => {
  it('provides Bulgarian text for every English label', () => {
    const en = posAccountMessages('en'),
      bg = posAccountMessages('bg');
    expect(Object.keys(en)).toEqual(Object.keys(bg));
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(bg[key]).toMatch(/[А-Яа-я]/u);
      expect(en[key]).not.toContain('—');
      expect(bg[key]).not.toContain('—');
    }
  });
});
