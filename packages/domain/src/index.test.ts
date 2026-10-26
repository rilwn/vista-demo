import { describe, expect, it } from 'vitest';

import {
  asEntityId,
  businessIdentifierIssues,
  calculateFinancialDocument,
  calculateReceivableBalance,
  isValidBulgarianUic,
  isValidEuVatNumber,
  isValidTelephoneNumber,
} from './index';

describe('corrected receivable balance', () => {
  it('retains original payments, applies notes and exposes excess paid funds', () => {
    expect(calculateReceivableBalance('120', '60', '24', '12')).toEqual({
      adjustedTotal: '108.0000',
      outstandingTotal: '48.0000',
      overpaidTotal: '0.0000',
    });
    expect(calculateReceivableBalance('120', '108', '36', '12')).toEqual({
      adjustedTotal: '96.0000',
      outstandingTotal: '0.0000',
      overpaidTotal: '12.0000',
    });
    expect(calculateReceivableBalance('120', '108', '36', '36')).toEqual({
      adjustedTotal: '120.0000',
      outstandingTotal: '12.0000',
      overpaidTotal: '0.0000',
    });
  });
  it('uses exact decimal arithmetic and rejects invalid negative balances', () => {
    expect(calculateReceivableBalance('999999999999.9999', '999999999999.9998', '0.0001')).toEqual({
      adjustedTotal: '999999999999.9998',
      outstandingTotal: '0.0000',
      overpaidTotal: '0.0000',
    });
    expect(() => calculateReceivableBalance('1', '0', '2')).toThrow();
  });
});

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

describe('Bulgarian UIC and EU VAT formats', () => {
  it('checks 9-digit and 13-digit Bulgarian UIC check digits', () => {
    expect(isValidBulgarianUic('131282355')).toBe(true);
    expect(isValidBulgarianUic('1312823551232')).toBe(true);
    expect(isValidBulgarianUic('131282354')).toBe(false);
    expect(isValidBulgarianUic('1312823551235')).toBe(false);
    expect(isValidBulgarianUic('12AB')).toBe(false);
  });

  it('checks VAT country prefixes and country-specific identifier shapes', () => {
    expect(isValidEuVatNumber('BG 131282355')).toBe(true);
    expect(isValidEuVatNumber('DE123456789')).toBe(true);
    expect(isValidEuVatNumber('ATU12345678')).toBe(true);
    expect(isValidEuVatNumber('BG123')).toBe(false);
    expect(isValidEuVatNumber('XYZ')).toBe(false);
    expect(isValidEuVatNumber('US123456789')).toBe(false);
  });

  it('reports only the invalid fields and allows identifiers to remain optional', () => {
    expect(businessIdentifierIssues({})).toEqual([]);
    expect(businessIdentifierIssues({ uic: '12AB', vatNumber: 'XYZ' })).toEqual([
      { field: 'uic', reason: 'invalid_bulgarian_uic' },
      { field: 'vatNumber', reason: 'invalid_eu_vat_number' },
    ]);
  });
});

describe('international telephone format', () => {
  it('accepts readable local and international numbers without assuming a country', () => {
    expect(isValidTelephoneNumber('+359 888 200 300')).toBe(true);
    expect(isValidTelephoneNumber('(02) 123-45-67')).toBe(true);
    expect(isValidTelephoneNumber('00359888200300')).toBe(true);
  });

  it('rejects text, malformed punctuation, and numbers outside the supported digit range', () => {
    expect(isValidTelephoneNumber('abc')).toBe(false);
    expect(isValidTelephoneNumber('+359 88 CALL ME')).toBe(false);
    expect(isValidTelephoneNumber('(02 123 45 67')).toBe(false);
    expect(isValidTelephoneNumber('123456')).toBe(false);
    expect(isValidTelephoneNumber('1234567890123456')).toBe(false);
  });
});

describe('calculateFinancialDocument', () => {
  it('calculates discounts, required VAT treatments, summaries, and EUR snapshots', () => {
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
      eurGrossTotal: '232.5482',
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
