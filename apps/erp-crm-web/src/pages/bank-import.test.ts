import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { mapBankImportRows, parseCamt053, parseCsv, parseMt940 } from './bank-import';

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

  it('reads a namespaced CAMT.053 statement, including zero opening balance and separate transaction details', () => {
    const parsed = parseCamt053(`<?xml version="1.0"?>
      <Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
        <BkToCstmrStmt><Stmt>
          <Id>BG-STATEMENT-2026-10</Id>
          <FrToDt><FrDtTm>2026-10-26T00:00:00Z</FrDtTm><ToDtTm>2026-10-26T23:59:59Z</ToDtTm></FrToDt>
          <Acct><Id><IBAN>BG80BNBG96611020345678</IBAN></Id><Ccy>EUR</Ccy></Acct>
          <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">0.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
          <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">20.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
          <Ntry><Amt Ccy="EUR">20.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
            <BookgDt><Dt>2026-10-26</Dt></BookgDt><ValDt><Dt>2026-10-27</Dt></ValDt>
            <NtryDtls>
              <TxDtls><Refs><EndToEndId>END-001</EndToEndId></Refs><AmtDtls><TxAmt><Amt Ccy="EUR">12.00</Amt></TxAmt></AmtDtls><RltdPties><Dbtr><Pty><Nm>Alfa Market</Nm></Pty></Dbtr></RltdPties><RmtInf><Ustrd>INV-001</Ustrd></RmtInf></TxDtls>
              <TxDtls><AmtDtls><TxAmt><Amt Ccy="EUR">8.00</Amt></TxAmt></AmtDtls><RltdPties><Dbtr><Pty><Nm>North Star Retail</Nm></Pty></Dbtr></RltdPties></TxDtls>
            </NtryDtls>
          </Ntry>
        </Stmt></BkToCstmrStmt>
      </Document>`);

    expect(parsed).toMatchObject({
      accountIban: 'BG80BNBG96611020345678',
      closingBalance: '20.00',
      format: 'CAMT.053',
      openingBalance: '0.00',
      statementDate: '2026-10-26',
      statementReference: 'BG-STATEMENT-2026-10',
    });
    const imported = mapBankImportRows(parsed.headers, parsed.rows, parsed.mapping);
    expect(imported.errors).toEqual([]);
    expect(imported.lines).toEqual([
      expect.objectContaining({
        amount: '12.00',
        counterpartyName: 'Alfa Market',
        direction: 'incoming',
        paymentReference: 'INV-001',
        transactionDate: '2026-10-26',
        valueDate: '2026-10-27',
      }),
      expect.objectContaining({
        amount: '8.00',
        counterpartyName: 'North Star Retail',
        direction: 'incoming',
        paymentReference: 'CAMT053-002',
      }),
    ]);
  });

  it('reads a standard MT940 statement with incoming and outgoing entries and value dates', () => {
    const parsed = parseMt940(
      [
        ':20:STATEMENT-002',
        ':25:BG80BNBG96611020345678',
        ':28C:002/001',
        ':60F:C261026EUR1000,00',
        ':61:2610261027C60,00NTRFNONREF//ORDER-123',
        ':86:?00Alfa Market?20INV-2026-001',
        ':61:2610261027D15,00NCHGCHARGE',
        ':86:/ORDER/TechSupply',
        ':62F:C261027EUR1045,00',
      ].join('\n'),
    );

    expect(parsed).toMatchObject({
      accountIban: 'BG80BNBG96611020345678',
      closingBalance: '1045.00',
      format: 'MT940',
      openingBalance: '1000.00',
      statementDate: '2026-10-27',
      statementReference: 'STATEMENT-002',
    });
    expect(mapBankImportRows(parsed.headers, parsed.rows, parsed.mapping).lines).toEqual([
      expect.objectContaining({
        amount: '60.00',
        counterpartyName: 'Alfa Market',
        direction: 'incoming',
        paymentReference: 'INV-2026-001',
        transactionDate: '2026-10-26',
        valueDate: '2026-10-27',
      }),
      expect.objectContaining({
        amount: '15.00',
        counterpartyName: 'Unidentified counterparty',
        direction: 'outgoing',
        transactionDate: '2026-10-26',
        valueDate: '2026-10-27',
      }),
    ]);
  });

  it('moves a December MT940 value date into the following year when its month is January', () => {
    const parsed = parseMt940(
      [
        ':20:YEAR-END',
        ':25:BG76DEMO00000000000000',
        ':60F:C261231EUR100,00',
        ':61:2612310101C1,00NTRF//NEW-YEAR-01',
        ':62F:C270101EUR101,00',
      ].join('\n'),
    );
    expect(parsed.rows[0]?.slice(0, 2)).toEqual(['2026-12-31', '2027-01-01']);
  });

  it('rejects malformed, multi-statement, non-EUR, and incomplete bank files', () => {
    expect(() => parseCamt053('<Document><broken></Document>')).toThrow('not valid');
    expect(() =>
      parseCamt053('<Document><BkToCstmrStmt><Stmt/><Stmt/></BkToCstmrStmt></Document>'),
    ).toThrow('one CAMT.053');
    expect(() =>
      parseMt940(':20:ONE\n:20:TWO\n:60F:C261026EUR100,00\n:62F:C261026EUR100,00'),
    ).toThrow('one MT940');
    expect(() =>
      parseMt940(':20:ONE\n:60F:C261026USD100,00\n:62F:C261026USD100,00\n:61:261026C100,00'),
    ).toThrow('Only EUR');
    expect(() => parseMt940(':20:ONE\n:60F:C261026EUR100,00\n:62F:C261026EUR100,00')).toThrow(
      'no transactions',
    );
  });

  it('maps an explicitly selected value date and defaults it only when no column is selected', () => {
    const mapped = mapBankImportRows(
      ['Booking date', 'Value date', 'Direction', 'Amount', 'Currency', 'Reference'],
      [['2026-10-26', '2026-10-27', 'credit', '12.00', 'EUR', 'INV-012']],
      {
        amount: 3,
        currency: 4,
        direction: 2,
        paymentReference: 5,
        transactionDate: 0,
        valueDate: 1,
      },
    );
    expect(mapped.lines[0]?.valueDate).toBe('2026-10-27');
    const earlierValueDate = mapBankImportRows(
      ['Booking date', 'Value date', 'Direction', 'Amount', 'Currency', 'Reference'],
      [['2026-10-27', '2026-10-26', 'credit', '12.00', 'EUR', 'INV-013']],
      {
        amount: 3,
        currency: 4,
        direction: 2,
        paymentReference: 5,
        transactionDate: 0,
        valueDate: 1,
      },
    );
    expect(earlierValueDate.errors).toEqual([]);
    expect(earlierValueDate.lines[0]?.valueDate).toBe('2026-10-26');
  });

  it('accepts a FIN-wrapped MT940 file and allows a zero opening balance', () => {
    const parsed = parseMt940(
      [
        '{1:F01BANKBEBBAXXX0000000000}',
        '{2:I940BANKBEBBXXXXN}',
        '{4:',
        ':20:ZERO-OPEN',
        ':25:BG80BNBG96611020345678',
        ':60F:C261026EUR0,00',
        ':61:261026C25,00NTRF//ORDER-25',
        ':62F:C261026EUR25,00',
        '-}',
        '{5:{CHK:ABC123}}',
      ].join('\n'),
    );
    expect(parsed.openingBalance).toBe('0.00');
    expect(parsed.closingBalance).toBe('25.00');
    expect(parsed.rows[0]?.[2]).toBe('incoming');
  });

  it('parses the synthetic CAMT.053 and MT940 files supplied for UI testing', () => {
    const camt053 = readFileSync(
      resolve(process.cwd(), '../../docs/qa/fixtures/finance-bank-import-camt053.xml'),
      'utf8',
    );
    const mt940 = readFileSync(
      resolve(process.cwd(), '../../docs/qa/fixtures/finance-bank-import-mt940.sta'),
      'utf8',
    );
    expect(parseCamt053(camt053)).toMatchObject({
      accountIban: 'BG76DEMO00000000000000',
      closingBalance: '160.00',
      openingBalance: '100.00',
      statementReference: 'DEMO-CAMT-20261027-01',
      rows: [
        [
          '2026-10-27',
          '2026-10-27',
          'incoming',
          '60.00',
          'EUR',
          'DEMO-CAMT-INV-001',
          'Vista Demo Customer',
        ],
      ],
    });
    expect(parseMt940(mt940)).toMatchObject({
      accountIban: 'BG76DEMO00000000000000',
      closingBalance: '160.00',
      openingBalance: '100.00',
      statementReference: 'DEMO-MT940-20261027-01',
    });
  });
});
