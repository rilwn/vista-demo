import { describe, expect, it } from 'vitest';

import { calculatePosLineTotals } from './pos.service.js';

describe('POS monetary calculations', () => {
  it('keeps standard VAT totals fixed-precision', () => {
    expect(calculatePosLineTotals('1.0000', '50.0000', 'standard_20')).toEqual({
      grossTotal: '60.0000',
      netTotal: '50.0000',
      vatTotal: '10.0000',
    });
    expect(calculatePosLineTotals('3.0000', '2.5000', 'standard_20')).toEqual({
      grossTotal: '9.0000',
      netTotal: '7.5000',
      vatTotal: '1.5000',
    });
  });

  it('applies reduced and zero-rated treatments without floating-point arithmetic', () => {
    expect(calculatePosLineTotals('1.0000', '10.0000', 'reduced_9')).toEqual({
      grossTotal: '10.9000',
      netTotal: '10.0000',
      vatTotal: '0.9000',
    });
    expect(calculatePosLineTotals('2.0000', '10.0000', 'exempt')).toEqual({
      grossTotal: '20.0000',
      netTotal: '20.0000',
      vatTotal: '0.0000',
    });
  });
});
