import type { CreateFinanceBankStatementLineRequest } from '@vista/contracts';

export type BankImportField =
  | 'amount'
  | 'counterpartyName'
  | 'currency'
  | 'direction'
  | 'paymentReference'
  | 'transactionDate'
  | 'valueDate';

export interface BankImportMapping {
  amount?: number;
  counterpartyName?: number;
  currency?: number;
  direction?: number;
  paymentReference?: number;
  transactionDate?: number;
  valueDate?: number;
}

export interface BankImportResult {
  duplicateRows: number[];
  errors: string[];
  lines: CreateFinanceBankStatementLineRequest[];
}

export interface ParsedBankStatementFile {
  accountIban?: string;
  closingBalance?: string;
  format: 'CAMT.053' | 'MT940';
  headers: string[];
  mapping: BankImportMapping;
  openingBalance?: string;
  rows: string[][];
  statementDate?: string;
  statementReference?: string;
}

const normalizedHeaders = [
  'Transaction date',
  'Value date',
  'Direction',
  'Amount',
  'Currency',
  'Payment reference',
  'Counterparty',
];

const normalizedMapping: BankImportMapping = {
  amount: 3,
  counterpartyName: 6,
  currency: 4,
  direction: 2,
  paymentReference: 5,
  transactionDate: 0,
  valueDate: 1,
};

/** Normalize a single-statement ISO 20022 CAMT.053 document for the shared review/import flow. */
export function parseCamt053(text: string): ParsedBankStatementFile {
  if (text.length > 10 * 1024 * 1024) throw new Error('The CAMT.053 file is too large.');
  const document = new DOMParser().parseFromString(text, 'application/xml');
  if (
    document.documentElement.localName === 'parsererror' ||
    descendants(document.documentElement, 'parsererror').length
  )
    throw new Error('The CAMT.053 XML is not valid.');
  if (
    document.documentElement.localName !== 'Document' ||
    descendants(document.documentElement, 'BkToCstmrStmt').length !== 1
  )
    throw new Error('The XML file is not a CAMT.053 customer statement.');
  const statements = descendants(document.documentElement, 'Stmt');
  if (statements.length !== 1) throw new Error('Upload one CAMT.053 statement at a time.');
  const statement = statements[0]!;
  const opening = camtBalance(statement, 'OPBD');
  const closing = camtBalance(statement, 'CLBD');
  const accountCurrency = textAt(statement, ['Acct', 'Ccy']);
  if (
    opening.currency !== 'EUR' ||
    closing.currency !== 'EUR' ||
    (accountCurrency && accountCurrency !== 'EUR')
  )
    throw new Error('Only EUR CAMT.053 statements can be imported.');

  const rows: string[][] = [];
  const entries = descendants(statement, 'Ntry');
  for (const [entryIndex, entry] of entries.entries()) {
    const details = descendants(entry, 'TxDtls');
    const sources = details.length ? details : [entry];
    for (const [detailIndex, source] of sources.entries()) {
      const amountElement =
        childPath(source, ['AmtDtls', 'TxAmt', 'Amt']) ??
        childPath(source, ['AmtDtls', 'InstdAmt', 'Amt']) ??
        firstDescendant(source, 'Amt') ??
        (source === entry ? firstChild(entry, 'Amt') : undefined);
      const amount = amountElement ? parseAmount(amountElement.textContent ?? '') : undefined;
      const currency = amountElement?.getAttribute('Ccy') ?? accountCurrency;
      const direction = normalizeCamtDirection(
        textAt(source, ['CdtDbtInd']) ?? textAt(entry, ['CdtDbtInd']),
      );
      const transactionDate =
        camtDate(source, 'BookgDt') ??
        camtDate(entry, 'BookgDt') ??
        camtDate(source, 'ValDt') ??
        camtDate(entry, 'ValDt');
      const valueDate = camtDate(source, 'ValDt') ?? camtDate(entry, 'ValDt') ?? transactionDate;
      const rowNumber = rows.length + 1;
      if (!amount || !direction || !transactionDate)
        throw new Error(
          `CAMT.053 entry ${entryIndex + 1}, detail ${detailIndex + 1} is incomplete.`,
        );
      if (currency !== 'EUR') throw new Error(`CAMT.053 entry ${entryIndex + 1} is not in EUR.`);
      if (rows.length >= 200)
        throw new Error('A bank statement can contain up to 200 transactions.');
      const reference =
        camtRemittance(source) ||
        textAt(source, ['Refs', 'EndToEndId']) ||
        (source === entry ? textAt(entry, ['AcctSvcrRef']) : undefined) ||
        `CAMT053-${String(rowNumber).padStart(3, '0')}`;
      const party =
        camtParty(source, direction) ||
        (source === entry ? camtParty(entry, direction) : undefined);
      rows.push([
        transactionDate,
        valueDate ?? transactionDate,
        direction,
        amount,
        currency,
        reference,
        party || 'Unidentified counterparty',
      ]);
    }
  }
  if (!rows.length) throw new Error('The CAMT.053 statement contains no transactions.');
  const statementDate = camtPeriodEnd(statement) ?? rows.at(-1)?.[0];
  const statementReference = textAt(statement, ['Id']) ?? undefined;
  const accountIban = textAt(statement, ['Acct', 'Id', 'IBAN']) ?? undefined;
  return {
    ...(accountIban ? { accountIban } : {}),
    closingBalance: closing.amount,
    format: 'CAMT.053',
    headers: normalizedHeaders,
    mapping: normalizedMapping,
    openingBalance: opening.amount,
    rows,
    ...(statementDate ? { statementDate } : {}),
    ...(statementReference ? { statementReference } : {}),
  };
}

/** Normalize one SWIFT MT940 statement, preserving every entry for human review. */
export function parseMt940(text: string): ParsedBankStatementFile {
  if (text.length > 10 * 1024 * 1024) throw new Error('The MT940 file is too large.');
  const tags: Array<{ code: string; value: string }> = [];
  for (const line of text.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const tag = /^:(\d{2}[A-Z]?):(.*)$/u.exec(line);
    if (tag) tags.push({ code: tag[1]!, value: tag[2]!.trim() });
    else if (!line.trim() || /^\{[1-5]:|^-\}$/u.test(line.trim())) continue;
    else if (tags.length && ['61', '86'].includes(tags.at(-1)!.code))
      tags[tags.length - 1]!.value += ` ${line.trim()}`;
    else throw new Error('The MT940 file contains an unsupported line.');
  }
  const values = (code: string) => tags.filter((tag) => tag.code === code).map((tag) => tag.value);
  if (values('20').length > 1) throw new Error('Upload one MT940 statement at a time.');
  if (values('25').length > 1) throw new Error('Upload one MT940 account statement at a time.');
  const openingTag = tags.find((tag) => tag.code === '60F' || tag.code === '60M');
  const closingTag = [...tags].reverse().find((tag) => tag.code === '62F' || tag.code === '62M');
  const opening = openingTag ? parseMt940Balance(openingTag.value) : undefined;
  const closing = closingTag ? parseMt940Balance(closingTag.value) : undefined;
  if (!opening || !closing)
    throw new Error('The MT940 file must include opening and closing balances.');
  if (opening.currency !== 'EUR' || closing.currency !== 'EUR')
    throw new Error('Only EUR MT940 statements can be imported.');

  const rows: string[][] = [];
  let lastEntry: { raw: string; narrative: string } | undefined;
  for (const tag of tags) {
    if (tag.code === '61') {
      lastEntry = { raw: tag.value, narrative: '' };
      rows.push([]);
      const parsed = parseMt940Entry(tag.value, rows.length);
      rows[rows.length - 1] = parsed;
    } else if (tag.code === '86' && lastEntry) {
      lastEntry.narrative += `${lastEntry.narrative ? ' ' : ''}${tag.value}`;
      const parsed = parseMt940Entry(lastEntry.raw, rows.length, lastEntry.narrative);
      rows[rows.length - 1] = parsed;
    }
  }
  if (!rows.length) throw new Error('The MT940 statement contains no transactions.');
  if (rows.length > 200) throw new Error('A bank statement can contain up to 200 transactions.');
  const accountLine = values('25')[0] ?? '';
  const accountIban = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/u.exec(accountLine)?.[0];
  return {
    ...(accountIban ? { accountIban } : {}),
    closingBalance: closing.amount,
    format: 'MT940',
    headers: normalizedHeaders,
    mapping: normalizedMapping,
    openingBalance: opening.amount,
    rows,
    statementDate: closing.date,
    ...(values('20')[0] || values('28C')[0]
      ? { statementReference: values('20')[0] || values('28C')[0] }
      : {}),
  };
}

function descendants(element: Element, localName: string): Element[] {
  return Array.from(element.getElementsByTagName('*')).filter(
    (child) => child.localName === localName,
  );
}

function firstChild(element: Element, localName: string): Element | undefined {
  return Array.from(element.children).find((child) => child.localName === localName);
}

function firstDescendant(element: Element, localName: string): Element | undefined {
  return descendants(element, localName)[0];
}

function childPath(element: Element, path: string[]): Element | undefined {
  let current: Element | undefined = element;
  for (const part of path) current = current ? firstChild(current, part) : undefined;
  return current;
}

function textAt(element: Element, path: string[]): string | undefined {
  const target = childPath(element, path);
  const value = target?.textContent?.trim();
  return value || undefined;
}

function camtDate(element: Element, containerName: string): string | undefined {
  const container = firstDescendant(element, containerName);
  if (!container) return undefined;
  const date = firstChild(container, 'Dt')?.textContent?.trim();
  const dateTime = firstChild(container, 'DtTm')?.textContent?.trim();
  const value = date || dateTime?.slice(0, 10);
  return value && parseDate(value) ? value : undefined;
}

function camtPeriodEnd(statement: Element): string | undefined {
  const period = firstDescendant(statement, 'FrToDt');
  if (!period) return undefined;
  const date = firstDescendant(period, 'ToDt')?.textContent?.trim();
  const dateTime = firstDescendant(period, 'ToDtTm')?.textContent?.trim();
  const value = date || dateTime?.slice(0, 10);
  return value && parseDate(value) ? value : undefined;
}

function camtBalance(
  statement: Element,
  expectedCode: 'CLBD' | 'OPBD',
): { amount: string; currency: string } {
  const balance = descendants(statement, 'Bal').find((candidate) => {
    const code =
      textAt(candidate, ['Tp', 'CdOrPrtry', 'Cd']) ??
      textAt(candidate, ['Tp', 'CdOrPrtry', 'Prtry']);
    return code === expectedCode;
  });
  const amountElement = balance ? firstDescendant(balance, 'Amt') : undefined;
  const amount = amountElement ? parseDecimal(amountElement.textContent ?? '') : undefined;
  const currency = amountElement?.getAttribute('Ccy') ?? '';
  const creditDebit = balance ? textAt(balance, ['CdtDbtInd']) : undefined;
  if (!amount || !currency || !['CRDT', 'DBIT'].includes(creditDebit ?? ''))
    throw new Error(`The CAMT.053 file is missing its ${expectedCode} balance.`);
  return {
    amount: `${creditDebit === 'DBIT' ? '-' : ''}${amount}`,
    currency,
  };
}

function normalizeCamtDirection(value: string | undefined): 'incoming' | 'outgoing' | undefined {
  return value === 'CRDT' ? 'incoming' : value === 'DBIT' ? 'outgoing' : undefined;
}

function camtRemittance(element: Element): string | undefined {
  const information = firstDescendant(element, 'RmtInf');
  if (!information) return undefined;
  const unstructured = descendants(information, 'Ustrd')
    .map((part) => part.textContent?.trim())
    .filter((part): part is string => Boolean(part));
  if (unstructured.length) return unstructured.join(' ');
  return textAt(information, ['Strd', 'CdtrRefInf', 'Ref']);
}

function camtParty(element: Element, direction: 'incoming' | 'outgoing'): string | undefined {
  const role = direction === 'incoming' ? 'Dbtr' : 'Cdtr';
  const party = firstDescendant(element, role);
  return party ? (textAt(party, ['Pty', 'Nm']) ?? textAt(party, ['Nm'])) : undefined;
}

function parseMt940Balance(
  value: string,
): { amount: string; currency: string; date: string } | undefined {
  const match = /^([CD])(\d{6})([A-Z]{3})(\d+(?:,\d+)?)$/u.exec(value);
  if (!match) return undefined;
  const date = parseSwiftDate(match[2]!);
  const amount = parseDecimal(match[4]!);
  if (!date || !amount) return undefined;
  return { amount: `${match[1] === 'D' ? '-' : ''}${amount}`, currency: match[3]!, date };
}

function parseMt940Entry(value: string, index: number, narrative = ''): string[] {
  const match = /^(\d{6})(\d{4})?([CD])(?:[A-Z])?(\d+(?:,\d+)?)(?:N[A-Z0-9]{3,4})?(.*)$/u.exec(
    value,
  );
  if (!match) throw new Error(`MT940 transaction ${index} has an invalid :61: line.`);
  const date = parseSwiftDate(match[1]!);
  const valueMonthDay = match[2];
  const valueDate = valueMonthDay ? parseMt940ValueDate(date, valueMonthDay) : date;
  const amount = parseAmount(match[4]!);
  if (!date || !amount)
    throw new Error(`MT940 transaction ${index} has an invalid date or amount.`);
  const narrativeFields = Array.from(narrative.matchAll(/\?(\d{2})([^?]*)/gu));
  const reference =
    narrativeFields.find((field) => ['20', '21', '22'].includes(field[1]!))?.[2]?.trim() ||
    /\/\/([^?\s]+)/u.exec(match[5] ?? '')?.[1] ||
    `MT940-${String(index).padStart(3, '0')}`;
  const counterparty =
    narrativeFields.find((field) => field[1] === '00')?.[2]?.trim() || 'Unidentified counterparty';
  if (!valueDate) throw new Error(`MT940 transaction ${index} has an invalid value date.`);
  return [
    date,
    valueDate,
    match[3] === 'C' ? 'incoming' : 'outgoing',
    amount,
    'EUR',
    reference,
    counterparty,
  ];
}

function parseMt940ValueDate(
  transactionDate: string | undefined,
  monthDay: string,
): string | undefined {
  if (!transactionDate) return undefined;
  const transactionMonth = Number(transactionDate.slice(5, 7));
  const valueMonth = Number(monthDay.slice(0, 2));
  const year =
    transactionMonth === 12 && valueMonth === 1
      ? Number(transactionDate.slice(0, 4)) + 1
      : Number(transactionDate.slice(0, 4));
  return parseDate(`${year}-${monthDay.slice(0, 2)}-${monthDay.slice(2, 4)}`);
}

function parseSwiftDate(value: string): string | undefined {
  const match = /^(\d{2})(\d{2})(\d{2})$/u.exec(value);
  if (!match) return undefined;
  const shortYear = Number(match[1]);
  const year = shortYear >= 80 ? 1900 + shortYear : 2000 + shortYear;
  return parseDate(`${year}-${match[2]}-${match[3]}`);
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/u, '');
  const firstLine = input.split(/\r?\n/u, 1)[0] ?? '';
  const separators = [',', ';', '\t'] as const;
  let delimiter: string = ',';
  let delimiterCount = -1;
  for (const candidate of separators) {
    const count = firstLine.split(candidate).length - 1;
    if (count > delimiterCount) {
      delimiter = candidate;
      delimiterCount = count;
    }
  }
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (!quoted && character === delimiter) {
      row.push(value.trim());
      value = '';
    } else if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      row.push(value.trim());
      value = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else value += character;
  }
  if (quoted) throw new Error('A quoted value is not closed. Check the CSV file and try again.');
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function mapBankImportRows(
  headers: string[],
  rows: string[][],
  mapping: BankImportMapping,
): BankImportResult {
  const required: Array<keyof BankImportMapping> = [
    'transactionDate',
    'direction',
    'amount',
    'currency',
    'paymentReference',
  ];
  if (required.some((field) => mapping[field] === undefined))
    return {
      duplicateRows: [],
      errors: ['Map a column for every required transaction field.'],
      lines: [],
    };

  const errors: string[] = [];
  const lines: CreateFinanceBankStatementLineRequest[] = [];
  const seen = new Map<string, number>();
  const duplicateRows: number[] = [];
  for (const [index, row] of rows.entries()) {
    const cell = (field: keyof BankImportMapping) => {
      const column = mapping[field];
      return column === undefined ? '' : (row[column] ?? '').trim();
    };
    const transactionDate = parseDate(cell('transactionDate'));
    const valueDate = mapping.valueDate === undefined ? undefined : parseDate(cell('valueDate'));
    const direction = parseDirection(cell('direction'));
    const amount = parseAmount(cell('amount'));
    const currency = cell('currency').toUpperCase();
    const paymentReference = cell('paymentReference');
    const counterpartyName =
      mapping.counterpartyName === undefined
        ? `Imported transaction ${index + 1}`
        : cell('counterpartyName');
    const rowNumber = index + 2;
    if (!transactionDate) errors.push(`Row ${rowNumber}: enter a valid transaction date.`);
    if (mapping.valueDate !== undefined && !valueDate)
      errors.push(`Row ${rowNumber}: enter a valid value date.`);
    if (!direction)
      errors.push(`Row ${rowNumber}: direction must be incoming/credit or outgoing/debit.`);
    if (!amount) errors.push(`Row ${rowNumber}: amount must be greater than zero.`);
    if (currency !== 'EUR')
      errors.push(`Row ${rowNumber}: only EUR bank statements can be imported.`);
    if (!paymentReference) errors.push(`Row ${rowNumber}: payment reference is required.`);
    if (!counterpartyName)
      errors.push(`Row ${rowNumber}: enter the counterparty or map its column.`);
    if (
      !transactionDate ||
      (mapping.valueDate !== undefined && !valueDate) ||
      !direction ||
      !amount ||
      currency !== 'EUR' ||
      !paymentReference ||
      !counterpartyName
    )
      continue;
    const identity = `${transactionDate}|${direction}|${amount}|${paymentReference.toLocaleLowerCase()}`;
    const originalRow = seen.get(identity);
    if (originalRow !== undefined) duplicateRows.push(rowNumber);
    else seen.set(identity, rowNumber);
    lines.push({
      amount,
      counterpartyName,
      direction,
      paymentReference,
      transactionDate,
      valueDate: valueDate ?? transactionDate,
    });
  }
  if (lines.length > 200)
    errors.push(
      'A statement can contain up to 200 transactions. Split this file into smaller statements.',
    );
  if (headers.length === 0) errors.push('The file has no column headers.');
  return { duplicateRows, errors, lines: errors.length ? [] : lines };
}

function parseDate(value: string): string | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  const local = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/u.exec(value);
  const date = iso
    ? `${iso[1]}-${iso[2]}-${iso[3]}`
    : local
      ? `${local[3]}-${local[2]!.padStart(2, '0')}-${local[1]!.padStart(2, '0')}`
      : undefined;
  if (!date) return undefined;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date
    ? undefined
    : date;
}

function parseDirection(value: string): 'incoming' | 'outgoing' | undefined {
  const direction = value.trim().toLocaleLowerCase();
  if (['incoming', 'in', 'credit', 'cr', 'приход', 'постъпление', 'кредит'].includes(direction))
    return 'incoming';
  if (['outgoing', 'out', 'debit', 'dr', 'разход', 'плащане', 'дебит'].includes(direction))
    return 'outgoing';
  return undefined;
}

function parseAmount(value: string): string | undefined {
  const normalized = parseDecimal(value);
  return normalized && Number(normalized) > 0 ? normalized : undefined;
}

function parseDecimal(value: string): string | undefined {
  let normalized = value.replace(/[\s€]/gu, '').replace(/[()]/gu, '');
  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');
  if (lastComma > lastDot) normalized = normalized.replaceAll('.', '').replace(',', '.');
  else normalized = normalized.replaceAll(',', '');
  if (!/^\d+(\.\d{1,4})?$/u.test(normalized) || !Number.isFinite(Number(normalized)))
    return undefined;
  return normalized;
}
