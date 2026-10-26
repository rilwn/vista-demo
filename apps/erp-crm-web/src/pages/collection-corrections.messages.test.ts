import { describe, expect, it } from 'vitest';
import { collectionCorrectionsMessages } from './collection-corrections.messages';

describe('collection correction wording', () => {
  it('has matching, nonempty English and Bulgarian labels', () => {
    const en = collectionCorrectionsMessages('en');
    const bg = collectionCorrectionsMessages('bg');
    expect(Object.keys(bg)).toEqual(Object.keys(en));
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(bg[key]).toMatch(/[А-Яа-я]/u);
      expect(en[key]).not.toContain('—');
      expect(bg[key]).not.toContain('—');
    }
  });
});
