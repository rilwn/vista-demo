import { describe, expect, it } from 'vitest';
import { returnLineGross } from './return-totals';

describe('refund preview from stored sale totals', () => {
  const line = {
    quantity: '3.0000',
    returnedQuantity: '0.0000',
    netTotal: '10.0000',
    vatTotal: '2.0000',
  };
  it('uses discounted totals rather than a list price', () => {
    expect(
      returnLineGross({ ...line, quantity: '1', netTotal: '69.5000', vatTotal: '13.9000' }, 1),
    ).toBe(83.4);
  });
  it('allocates net and VAT independently at four decimals', () => {
    expect(returnLineGross(line, 1)).toBe(3.9999);
  });
  it('gives the final return its exact remaining paid amount', () => {
    expect(
      returnLineGross(
        { ...line, returnedQuantity: '2', returnedNetTotal: '6.6666', returnedVatTotal: '1.3332' },
        1,
      ),
    ).toBe(4.0002);
  });
  it('does not guess a partial-return residue when older data omits refunded totals', () => {
    expect(returnLineGross({ ...line, returnedQuantity: '2' }, 1)).toBeNaN();
  });
  it('rejects invalid or excessive quantities without crashing the panel', () => {
    for (const quantity of [NaN, Infinity, -1, 0, 4])
      expect(returnLineGross(line, quantity)).toBeNaN();
  });
});
