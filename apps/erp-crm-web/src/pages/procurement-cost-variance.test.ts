import { describe, expect, it } from 'vitest';

import { isMaterialCostVariance } from './procurement-cost-variance';

describe('receipt cost review threshold', () => {
  it('warns at a ten-percent increase or decrease, but not below it', () => {
    expect(isMaterialCostVariance('10', '11')).toBe(true);
    expect(isMaterialCostVariance('10', '9')).toBe(true);
    expect(isMaterialCostVariance('10', '10.9999')).toBe(false);
    expect(isMaterialCostVariance('10', '9.0001')).toBe(false);
  });

  it('does not warn when there is no usable cost baseline', () => {
    expect(isMaterialCostVariance(undefined, '25')).toBe(false);
    expect(isMaterialCostVariance('0', '25')).toBe(false);
    expect(isMaterialCostVariance('not-a-price', '25')).toBe(false);
  });
});
