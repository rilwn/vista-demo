import { describe, expect, it } from 'vitest';

import { mapBankImportRows, parseCsv } from './bank-import';

describe('bank statement import mapping', () => {
  it('reads quoted CSV values and semicolon-separated decimal commas', () => {
    expect(
      parseCsv(
        'Date;Direction;Amount;Reference\n"21.08.2026";incoming;1.234,50;"Transfer, August"',
      ),
    ).toEqual([
      ['Date', 'Direction', 'Amount', 'Reference'],
      ['21.08.2026', 'incoming', '1.234,50', 'Transfer, August'],
    ]);
  });

  it('maps EUR transactions and flags repeated transaction lines for review', () => {
    const headers = ['Date', 'Direction', 'Amount', 'Currency', 'Reference', 'Company'];
    const row = ['2026-08-21', 'credit', '60.00', 'EUR', 'INV-001', 'Alfa Market'];
    const result = mapBankImportRows(headers, [row, row], {
      amount: 2,
      counterpartyName: 5,
      currency: 3,
      direction: 1,
      paymentReference: 4,
      transactionDate: 0,
    });
    expect(result.errors).toEqual([]);
    expect(result.duplicateRows).toEqual([3]);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({
      amount: '60.00',
      counterpartyName: 'Alfa Market',
      direction: 'incoming',
      paymentReference: 'INV-001',
      transactionDate: '2026-08-21',
      valueDate: '2026-08-21',
    });
  });

  it('keeps invalid dates, currencies and required mappings out of the statement', () => {
    const invalid = mapBankImportRows(
      ['Date', 'Direction', 'Amount', 'Currency', 'Reference'],
      [['31.02.2026', 'debit', '12', 'USD', 'Supplier invoice']],
      { amount: 2, currency: 3, direction: 1, paymentReference: 4, transactionDate: 0 },
    );
    expect(invalid.lines).toEqual([]);
    expect(invalid.errors).toEqual(
      expect.arrayContaining([
        'Row 2: enter a valid transaction date.',
        'Row 2: only EUR bank statements can be imported.',
      ]),
    );
  });

  it('requires every transaction-defining column to be mapped', () => {
    expect(mapBankImportRows([], [], {}).errors).toEqual([
      'Map a column for every required transaction field.',
    ]);
  });
});
