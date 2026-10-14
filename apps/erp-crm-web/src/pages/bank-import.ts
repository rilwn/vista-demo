import type { CreateFinanceBankStatementLineRequest } from '@vista/contracts';

export type BankImportField =
  'amount' | 'counterpartyName' | 'currency' | 'direction' | 'paymentReference' | 'transactionDate';

export interface BankImportMapping {
  amount?: number;
  counterpartyName?: number;
  currency?: number;
  direction?: number;
  paymentReference?: number;
  transactionDate?: number;
}

export interface BankImportResult {
  duplicateRows: number[];
  errors: string[];
  lines: CreateFinanceBankStatementLineRequest[];
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
      valueDate: transactionDate,
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
  let normalized = value.replace(/[\s€]/gu, '').replace(/[()]/gu, '');
  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');
  if (lastComma > lastDot) normalized = normalized.replaceAll('.', '').replace(',', '.');
  else normalized = normalized.replaceAll(',', '');
  normalized = normalized.replace(/^-/, '');
  if (!/^\d+(\.\d{1,4})?$/u.test(normalized) || Number(normalized) <= 0) return undefined;
  return normalized;
}
