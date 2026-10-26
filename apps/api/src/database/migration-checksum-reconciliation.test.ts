import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { isKnownEquivalentMigration } from './migration-checksum-reconciliation.js';

const old = 'a29f4111bc30c5c9098cc77a05311cdfec49e5810529833dc257d3ccede5d6c9';
const current = '0d68a49b6d175ddfbdb166fae2da8b81a3d02ce40da9311f4979a15f51f46a78';
const id = '0069_eur_transition';
describe('released EUR migration checksum compatibility', () => {
  it('accepts only the known old-to-current pair, not arbitrary drift or a downgrade', () => {
    expect(isKnownEquivalentMigration(id, old, current)).toBe(true);
    expect(isKnownEquivalentMigration(id, current, old)).toBe(false);
    expect(isKnownEquivalentMigration(id, 'a'.repeat(64), current)).toBe(false);
    expect(isKnownEquivalentMigration(id, old, 'b'.repeat(64))).toBe(false);
    expect(isKnownEquivalentMigration('0070_eur_demo_price_lists', old, current)).toBe(false);
  });
  it('pins the exact source and verifies that the historical difference is only EUR normalization', async () => {
    const sql = await readFile(
      new URL('./migrations/0069_eur_transition.up.sql', import.meta.url),
      'utf8',
    );
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    expect(hash(sql)).toBe(current);
    const addition = `-- EUR-denominated documents are now in the accounting currency, so their
-- source amount remains unchanged and their converted EUR rate is exactly 1.
-- Older versions stored the BGN-per-EUR rate and source label for these rows.
UPDATE finance.financial_documents
SET exchange_rate = 1,
    rate_source = 'internal_eur'
WHERE currency_code = 'EUR';

`;
    expect(sql.includes(addition)).toBe(true);
    expect(hash(sql.replace(addition, ''))).toBe(old);
  });
});
