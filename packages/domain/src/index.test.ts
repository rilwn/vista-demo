import { describe, expect, it } from 'vitest';

import { asEntityId } from './index';

describe('asEntityId', () => {
  it('accepts an immutable UUID identifier', () => {
    expect(asEntityId('018f47a0-6a10-7dc8-9c21-9d08ea2f442b')).toBe(
      '018f47a0-6a10-7dc8-9c21-9d08ea2f442b',
    );
  });

  it('rejects business values as identifiers', () => {
    expect(() => asEntityId('customer-name')).toThrow('Entity identifiers must be UUIDs');
  });
});
