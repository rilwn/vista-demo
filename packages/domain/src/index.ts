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
  bgnGrossTotal: string;
  bgnNetTotal: string;
  bgnVatTotal: string;
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
    bgnGrossTotal: formatUnits(divideHalfUp(gross * rate, rateScale), 4),
    bgnNetTotal: formatUnits(divideHalfUp(net * rate, rateScale), 4),
    bgnVatTotal: formatUnits(divideHalfUp(vat * rate, rateScale), 4),
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
