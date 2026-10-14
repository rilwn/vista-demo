const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

declare const entityIdBrand: unique symbol;

export type EntityId = string & { readonly [entityIdBrand]: true };

export function asEntityId(value: string): EntityId {
  if (!uuidPattern.test(value)) {
    throw new Error('Entity identifiers must be UUIDs');
  }

  return value as EntityId;
}

export type FinancialVatTreatment = 'standard_20' | 'reduced_9' | 'zero' | 'exempt' | 'ica';

export interface FinancialCalculationLine {
  discountPercent: string;
  quantity: string;
  unitPrice: string;
  vatRate?: string;
  vatTreatment: FinancialVatTreatment;
}

export interface CalculatedFinancialLine {
  discountPercent: string;
  grossTotal: string;
  netTotal: string;
  quantity: string;
  unitPrice: string;
  vatAmount: string;
  vatRate: string;
  vatTreatment: FinancialVatTreatment;
}

export interface CalculatedFinancialDocument {
  eurGrossTotal: string;
  eurNetTotal: string;
  eurVatTotal: string;
  grossTotal: string;
  lines: CalculatedFinancialLine[];
  netTotal: string;
  vatSummary: Array<{
    netTotal: string;
    vatAmount: string;
    vatRate: string;
    vatTreatment: FinancialVatTreatment;
  }>;
  vatTotal: string;
}

const moneyScale = 10_000n;
const rateScale = 100_000_000n;
const percentScale = 10_000n;
const oneHundredPercent = 100n * percentScale;

export type BusinessIdentifierField = 'uic' | 'vatNumber';

export interface BusinessIdentifierIssue {
  field: BusinessIdentifierField;
  reason: 'invalid_bulgarian_uic' | 'invalid_eu_vat_number';
}

const euVatSuffixPatterns: Record<string, RegExp> = {
  AT: /^U\d{8}$/u,
  BE: /^[01]\d{9}$/u,
  BG: /^\d{9,10}$/u,
  CY: /^\d{8}[A-Z]$/u,
  CZ: /^\d{8,10}$/u,
  DE: /^\d{9}$/u,
  DK: /^\d{8}$/u,
  EE: /^\d{9}$/u,
  EL: /^\d{9}$/u,
  ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/u,
  FI: /^\d{8}$/u,
  FR: /^[A-Z0-9]{2}\d{9}$/u,
  HR: /^\d{11}$/u,
  HU: /^\d{8}$/u,
  IE: /^(?:\d{7}[A-Z]{1,2}|\d[A-Z]\d{5}[A-Z])$/u,
  IT: /^\d{11}$/u,
  LT: /^(?:\d{9}|\d{12})$/u,
  LU: /^\d{8}$/u,
  LV: /^\d{11}$/u,
  MT: /^\d{8}$/u,
  NL: /^\d{9}B\d{2}$/u,
  PL: /^\d{10}$/u,
  PT: /^\d{9}$/u,
  RO: /^\d{2,10}$/u,
  SE: /^\d{12}$/u,
  SI: /^\d{8}$/u,
  SK: /^\d{10}$/u,
  XI: /^(?:\d{9}|\d{12}|GD\d{3}|HA\d{3})$/u,
};

export function isValidBulgarianUic(value: string): boolean {
  const digits = value.trim();
  if (!/^\d{9}(?:\d{4})?$/u.test(digits)) return false;
  const baseIsValid = checkBulgarianUicChecksum(digits.slice(0, 9));
  if (!baseIsValid || digits.length === 9) return baseIsValid;

  const branchDigits = digits.slice(9, 13);
  const primary = weightedCheckDigit(branchDigits, [2, 7, 3, 5]);
  const check = primary === 10 ? weightedCheckDigit(branchDigits, [4, 9, 5, 7]) : primary;
  return Number(branchDigits[3]) === check % 10;
}

export function isValidEuVatNumber(value: string): boolean {
  const normalized = value.replace(/\s+/gu, '').toUpperCase();
  const countryCode = normalized.slice(0, 2);
  const suffixPattern = euVatSuffixPatterns[countryCode];
  return suffixPattern ? suffixPattern.test(normalized.slice(2)) : false;
}

export function businessIdentifierIssues(input: {
  uic?: string | null;
  vatNumber?: string | null;
}): BusinessIdentifierIssue[] {
  const issues: BusinessIdentifierIssue[] = [];
  if (input.uic?.trim() && !isValidBulgarianUic(input.uic)) {
    issues.push({ field: 'uic', reason: 'invalid_bulgarian_uic' });
  }
  if (input.vatNumber?.trim() && !isValidEuVatNumber(input.vatNumber)) {
    issues.push({ field: 'vatNumber', reason: 'invalid_eu_vat_number' });
  }
  return issues;
}

/**
 * Accepts common international telephone notation without assuming a country.
 * The number must contain 7–15 digits; punctuation is limited to readable
 * grouping characters and a single leading international '+' sign.
 */
export function isValidTelephoneNumber(value: string): boolean {
  const telephone = value.trim();
  if (!/^\+?(?:\([0-9]+\)|[0-9])[0-9().\s-]*$/u.test(telephone)) return false;

  const digitCount = telephone.replace(/\D/gu, '').length;
  if (digitCount < 7 || digitCount > 15) return false;

  let parenthesisDepth = 0;
  for (const character of telephone) {
    if (character === '(') {
      parenthesisDepth += 1;
      if (parenthesisDepth > 1) return false;
    } else if (character === ')') {
      if (parenthesisDepth !== 1) return false;
      parenthesisDepth = 0;
    }
  }
  return parenthesisDepth === 0;
}

function checkBulgarianUicChecksum(value: string): boolean {
  const digits = value.slice(0, 8);
  const check = Number(value[8]);
  const primary = weightedCheckDigit(digits, [1, 2, 3, 4, 5, 6, 7, 8]);
  const expected = primary === 10 ? weightedCheckDigit(digits, [3, 4, 5, 6, 7, 8, 9, 10]) : primary;
  return check === expected % 10;
}

function weightedCheckDigit(value: string, weights: number[]): number {
  return (
    [...value].reduce((sum, digit, index) => sum + Number(digit) * (weights[index] ?? 0), 0) % 11
  );
}

export function calculateFinancialDocument(
  lines: FinancialCalculationLine[],
  exchangeRate: string,
): CalculatedFinancialDocument {
  if (lines.length === 0) throw new Error('A financial document needs at least one line');
  const rate = decimalUnits(exchangeRate, 8);
  if (rate <= 0n) throw new Error('The exchange rate must be greater than zero');
  const calculatedLines = lines.map(calculateFinancialLine);
  const net = sum(calculatedLines.map((line) => decimalUnits(line.netTotal, 4)));
  const vat = sum(calculatedLines.map((line) => decimalUnits(line.vatAmount, 4)));
  const gross = net + vat;
  const summaries = new Map<
    string,
    { net: bigint; rate: string; treatment: FinancialVatTreatment; vat: bigint }
  >();
  for (const line of calculatedLines) {
    const key = `${line.vatTreatment}:${line.vatRate}`;
    const current = summaries.get(key) ?? {
      net: 0n,
      rate: line.vatRate,
      treatment: line.vatTreatment,
      vat: 0n,
    };
    current.net += decimalUnits(line.netTotal, 4);
    current.vat += decimalUnits(line.vatAmount, 4);
    summaries.set(key, current);
  }
  return {
    eurGrossTotal: formatUnits(divideHalfUp(gross * rate, rateScale), 4),
    eurNetTotal: formatUnits(divideHalfUp(net * rate, rateScale), 4),
    eurVatTotal: formatUnits(divideHalfUp(vat * rate, rateScale), 4),
    grossTotal: formatUnits(gross, 4),
    lines: calculatedLines,
    netTotal: formatUnits(net, 4),
    vatSummary: [...summaries.values()].map((summary) => ({
      netTotal: formatUnits(summary.net, 4),
      vatAmount: formatUnits(summary.vat, 4),
      vatRate: summary.rate,
      vatTreatment: summary.treatment,
    })),
    vatTotal: formatUnits(vat, 4),
  };
}

function calculateFinancialLine(line: FinancialCalculationLine): CalculatedFinancialLine {
  const quantity = decimalUnits(line.quantity, 4);
  const unitPrice = decimalUnits(line.unitPrice, 4);
  const discount = decimalUnits(line.discountPercent, 4);
  if (quantity <= 0n) throw new Error('Quantity must be greater than zero');
  if (unitPrice < 0n) throw new Error('Unit price cannot be negative');
  if (discount < 0n || discount > oneHundredPercent)
    throw new Error('Discount must be between zero and 100 percent');
  const vatRate = requiredVatRate(line);
  const vatRateUnits = decimalUnits(vatRate, 4);
  if (vatRateUnits < 0n || vatRateUnits > oneHundredPercent)
    throw new Error('VAT rate must be between zero and 100 percent');
  const beforeDiscount = divideHalfUp(quantity * unitPrice, moneyScale);
  const net = divideHalfUp(beforeDiscount * (oneHundredPercent - discount), oneHundredPercent);
  const vat = divideHalfUp(net * vatRateUnits, oneHundredPercent);
  return {
    discountPercent: formatUnits(discount, 4),
    grossTotal: formatUnits(net + vat, 4),
    netTotal: formatUnits(net, 4),
    quantity: formatUnits(quantity, 4),
    unitPrice: formatUnits(unitPrice, 4),
    vatAmount: formatUnits(vat, 4),
    vatRate,
    vatTreatment: line.vatTreatment,
  };
}

function requiredVatRate(line: FinancialCalculationLine): string {
  if (line.vatTreatment === 'standard_20') return '20.0000';
  if (line.vatTreatment === 'reduced_9') return '9.0000';
  if (line.vatTreatment === 'zero' || line.vatTreatment === 'exempt') return '0.0000';
  if (!line.vatRate) throw new Error('An explicit draft VAT rate is required for ICA treatment');
  return formatUnits(decimalUnits(line.vatRate, 4), 4);
}

function decimalUnits(value: string, scale: number): bigint {
  if (!/^\d+(\.\d+)?$/u.test(value)) throw new Error('Enter a non-negative decimal value');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > scale) throw new Error(`Enter no more than ${scale} decimal places`);
  return BigInt(`${whole}${fraction.padEnd(scale, '0')}`);
}

function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function formatUnits(value: bigint, scale: number): string {
  const raw = value.toString().padStart(scale + 1, '0');
  return `${raw.slice(0, -scale)}.${raw.slice(-scale)}`;
}

function sum(values: bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}
