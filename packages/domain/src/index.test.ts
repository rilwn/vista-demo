import { describe, expect, it } from 'vitest';

import { asEntityId, calculateFinancialDocument } from './index';

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

describe('calculateFinancialDocument', () => {
  it('calculates discounts, required VAT treatments, summaries, and BGN snapshots', () => {
    expect(
      calculateFinancialDocument(
        [
          {
            discountPercent: '10',
            quantity: '2',
            unitPrice: '50',
            vatTreatment: 'standard_20',
          },
          {
            discountPercent: '0',
            quantity: '1',
            unitPrice: '10',
            vatTreatment: 'reduced_9',
          },
        ],
        '1.95583000',
      ),
    ).toMatchObject({
      bgnGrossTotal: '232.5482',
      grossTotal: '118.9000',
      netTotal: '100.0000',
      vatTotal: '18.9000',
      vatSummary: [
        {
          netTotal: '90.0000',
          vatAmount: '18.0000',
          vatRate: '20.0000',
          vatTreatment: 'standard_20',
        },
        {
          netTotal: '10.0000',
          vatAmount: '0.9000',
          vatRate: '9.0000',
          vatTreatment: 'reduced_9',
        },
      ],
    });
  });

  it('requires an explicit draft rate for intra-community acquisition treatment', () => {
    expect(() =>
      calculateFinancialDocument(
        [
          {
            discountPercent: '0',
            quantity: '1',
            unitPrice: '10',
            vatTreatment: 'ica',
          },
        ],
        '1',
      ),
    ).toThrow('explicit draft VAT rate');
  });
});
