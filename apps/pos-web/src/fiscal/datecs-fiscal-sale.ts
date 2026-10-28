import type { PosVatTreatment } from '@vista/contracts';
import type { DatecsFiscalResponse } from './datecs-protocol';
import {
  DatecsCommandOutcomeUnknownError,
  DatecsProtocolRejectedError,
} from './datecs-command-client';

// DATECS FP-2000 command identifiers are hexadecimal bytes in the wire frame.
// Their decimal equivalents are shown in the official manual.
const COMMAND_OPEN_RECEIPT = 0x30; // 48
const COMMAND_ENTER_SALE = 0x31; // 49
const COMMAND_TOTAL = 0x35; // 53
const COMMAND_CLOSE_RECEIPT = 0x38; // 56
const COMMAND_CANCEL_RECEIPT = 0x3c; // 60
const COMMAND_READ_CURRENCY_AND_TAXES = 0x53; // 83

const cp1251High =
  'ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—\u0098™љ›њќћџ ЎўЈ¤Ґ¦§Ё©Є«¬\u00ad®Ї°±Ііґµ¶·ё№є»јЅѕї' +
  'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя';
const cp1251ByteByCharacter = new Map<string, number>([
  ...Array.from({ length: 0x80 }, (_, index) => [String.fromCharCode(index), index] as const),
  ...Array.from(cp1251High, (character, index) => [character, index + 0x80] as const),
]);

export type DatecsVatGroup = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';

export interface DatecsTaxGroupConfiguration {
  group: DatecsVatGroup;
  ratePercent: string;
}

export interface DatecsFiscalSaleConfiguration {
  operatorNumber: number;
  operatorPassword: string;
  registerLocationNumber: number;
  taxGroups: Record<PosVatTreatment, DatecsTaxGroupConfiguration>;
}

export interface DatecsFiscalSaleLine {
  description: string;
  discountEur?: string;
  grossTotalEur: string;
  quantity: string;
  unitCode?: string;
  unitPriceEur: string;
  vatTreatment: PosVatTreatment;
}

export interface DatecsFiscalCashSaleRequest {
  cashTenderedEur: string;
  lines: DatecsFiscalSaleLine[];
  totalGrossEur: string;
  /** DATECS UNP, e.g. DT000600-OP01-0001000. The POS must allocate it durably. */
  uniqueSaleId: string;
}

export interface DatecsFiscalCashSaleResult {
  changeEur: string;
  fiscalDocumentNumber: string;
  fiscalReceiptsSinceDailyReport: string;
  uniqueSaleId: string;
}

export interface DatecsFiscalSaleCommandPort {
  execute(command: number, data?: Uint8Array): Promise<DatecsFiscalResponse>;
  markOutcomeUnknown(commandCode: number): Promise<void>;
  synchronize(): Promise<DatecsFiscalResponse>;
}

/**
 * Issues one EUR cash receipt through the DATECS FP-2000 command protocol.
 * This adapter deliberately does not claim H-18 acceptance, handle card or
 * on-account payments, or enable offline sales by itself.
 */
export class DatecsFiscalSaleAdapter {
  constructor(
    private readonly commandPort: DatecsFiscalSaleCommandPort,
    private readonly configuration: DatecsFiscalSaleConfiguration,
  ) {}

  async issueCashReceipt(
    request: DatecsFiscalCashSaleRequest,
    beforeReceiptOpen?: () => Promise<void>,
  ): Promise<DatecsFiscalCashSaleResult> {
    const sale = validateSaleRequest(request, this.configuration);
    let currentCommand = COMMAND_OPEN_RECEIPT;
    let receiptOpened = false;
    let paymentAttempted = false;

    try {
      const initialStatus = await this.commandPort.synchronize();
      assertHealthyStatus(initialStatus, 'printer readiness check');
      assertFiscalReadyStatus(initialStatus);

      currentCommand = COMMAND_READ_CURRENCY_AND_TAXES;
      const currencyAndTaxResponse = await this.commandPort.execute(
        COMMAND_READ_CURRENCY_AND_TAXES,
      );
      assertHealthyStatus(currencyAndTaxResponse, 'currency and VAT check');
      verifyCurrencyAndTaxGroups(currencyAndTaxResponse, this.configuration.taxGroups);

      currentCommand = COMMAND_OPEN_RECEIPT;
      await beforeReceiptOpen?.();
      const opened = await this.commandPort.execute(
        COMMAND_OPEN_RECEIPT,
        encodeDatecsWindows1251(
          `${this.configuration.operatorNumber},${this.configuration.operatorPassword},${this.configuration.registerLocationNumber},,${request.uniqueSaleId}`,
        ),
      );
      receiptOpened = isReceiptOpen(opened.status);
      assertHealthyStatus(opened, 'receipt opening');
      if (!receiptOpened) {
        await this.commandPort.markOutcomeUnknown(COMMAND_OPEN_RECEIPT);
        throw new DatecsCommandOutcomeUnknownError(
          'The printer did not confirm that the fiscal receipt opened. Review the printer before continuing.',
        );
      }
      for (const line of sale.lines) {
        currentCommand = COMMAND_ENTER_SALE;
        const response = await this.commandPort.execute(COMMAND_ENTER_SALE, line.data);
        assertHealthyStatus(response, 'sale line');
        if (response.data.byteLength !== 0) {
          await this.commandPort.markOutcomeUnknown(COMMAND_ENTER_SALE);
          throw new DatecsCommandOutcomeUnknownError(
            'The printer returned unexpected data for a sale line. Review the printer before continuing.',
          );
        }
      }

      currentCommand = COMMAND_TOTAL;
      paymentAttempted = true;
      const paymentResponse = await this.commandPort.execute(
        COMMAND_TOTAL,
        encodeDatecsWindows1251(`\tP+${formatCents(sale.cashTenderedCents)}`),
      );
      assertHealthyStatus(paymentResponse, 'cash payment');
      const payment = parsePaymentResult(paymentResponse.data);
      if (payment.code === 'R' && payment.amountCents === sale.changeCents) {
        // Expected cash overpayment; the printer prints and returns change.
      } else if (
        payment.code === 'P' &&
        sale.changeCents === 0n &&
        (payment.amountCents === undefined || payment.amountCents === 0n)
      ) {
        // Exact tender.
      } else {
        await this.commandPort.markOutcomeUnknown(COMMAND_TOTAL);
        throw new DatecsCommandOutcomeUnknownError(
          'The printer did not confirm the expected cash payment and change. Review the printer before continuing.',
        );
      }

      currentCommand = COMMAND_CLOSE_RECEIPT;
      const closed = await this.commandPort.execute(COMMAND_CLOSE_RECEIPT);
      assertHealthyStatus(closed, 'receipt close');
      if (isReceiptOpen(closed.status)) {
        await this.commandPort.markOutcomeUnknown(COMMAND_CLOSE_RECEIPT);
        throw new DatecsCommandOutcomeUnknownError(
          'The printer did not confirm that the fiscal receipt closed. Review the printer before continuing.',
        );
      }
      const counts = parseReceiptCounts(closed.data);

      // DATECS command 48 with '*' is query-only: it identifies the last
      // fiscal document without opening another receipt.
      currentCommand = COMMAND_OPEN_RECEIPT;
      const lastDocument = await this.commandPort.execute(
        COMMAND_OPEN_RECEIPT,
        encodeDatecsWindows1251('*'),
      );
      assertHealthyStatus(lastDocument, 'last receipt confirmation');
      const document = parseLastFiscalDocument(lastDocument.data);
      if (document.uniqueSaleId !== request.uniqueSaleId) {
        await this.commandPort.markOutcomeUnknown(COMMAND_OPEN_RECEIPT);
        throw new DatecsCommandOutcomeUnknownError(
          'The last printer document does not match this sale. Review the printer before continuing.',
        );
      }

      return {
        changeEur: formatCents(sale.changeCents),
        fiscalDocumentNumber: document.documentNumber,
        fiscalReceiptsSinceDailyReport: counts.fiscalReceiptCount,
        uniqueSaleId: document.uniqueSaleId,
      };
    } catch (error) {
      if (error instanceof DatecsCommandOutcomeUnknownError && error.commandCode === undefined)
        error.commandCode = currentCommand;
      if (!receiptOpened) {
        if (error instanceof DatecsCommandOutcomeUnknownError) throw error;
        throw error;
      }
      if (error instanceof DatecsProtocolRejectedError && receiptOpened && !paymentAttempted) {
        const cancelled = await this.commandPort
          .execute(COMMAND_CANCEL_RECEIPT)
          .catch(() => undefined);
        if (cancelled && isReceiptClosedWithoutFault(cancelled))
          throw new DatecsFiscalSaleCancelledError(error);
      }
      if (error instanceof DatecsCommandOutcomeUnknownError) throw error;

      await this.commandPort.markOutcomeUnknown(currentCommand);
      throw new DatecsCommandOutcomeUnknownError(
        'The fiscal sale could not be confirmed. Review the printer before continuing.',
        error,
      );
    }
  }

  async inspectLastFiscalDocument(): Promise<{ documentNumber: string; uniqueSaleId: string }> {
    const status = await this.commandPort.synchronize();
    assertHealthyStatus(status, 'printer review');
    const response = await this.commandPort.execute(
      COMMAND_OPEN_RECEIPT,
      encodeDatecsWindows1251('*'),
    );
    assertHealthyStatus(response, 'last receipt review');
    return parseLastFiscalDocument(response.data);
  }
}

export class DatecsFiscalSaleCancelledError extends Error {
  constructor(cause: unknown) {
    super('The printer rejected a sale line and confirmed cancellation of the unpaid receipt.', {
      cause,
    });
    this.name = 'DatecsFiscalSaleCancelledError';
  }
}

export class DatecsFiscalConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatecsFiscalConfigurationError';
  }
}

export class DatecsFiscalDeviceStatusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatecsFiscalDeviceStatusError';
  }
}

function validateSaleRequest(
  request: DatecsFiscalCashSaleRequest,
  configuration: DatecsFiscalSaleConfiguration,
) {
  if (!/^[A-Z0-9]{8}-[A-Z0-9]{4}-\d{7}$/.test(request.uniqueSaleId))
    throw new DatecsFiscalConfigurationError(
      'The unique sale ID must follow the DATECS device-operator-sequence format.',
    );
  if (
    !Number.isInteger(configuration.operatorNumber) ||
    configuration.operatorNumber < 1 ||
    configuration.operatorNumber > 16
  )
    throw new DatecsFiscalConfigurationError('The printer operator number must be from 1 to 16.');
  if (!/^\d{4,8}$/.test(configuration.operatorPassword))
    throw new DatecsFiscalConfigurationError(
      'The printer operator password must contain 4 to 8 digits.',
    );
  if (
    !Number.isInteger(configuration.registerLocationNumber) ||
    configuration.registerLocationNumber < 1 ||
    configuration.registerLocationNumber > 99999
  )
    throw new DatecsFiscalConfigurationError(
      'The printer register number must be from 1 to 99999.',
    );

  const totalGrossCents = parseCents(request.totalGrossEur, 'Sale total');
  const cashTenderedCents = parseCents(request.cashTenderedEur, 'Cash tendered');
  if (totalGrossCents <= 0n || cashTenderedCents < totalGrossCents)
    throw new DatecsFiscalConfigurationError('Cash tendered must cover the positive sale total.');
  if (request.lines.length === 0 || request.lines.length > 512)
    throw new DatecsFiscalConfigurationError(
      'A fiscal receipt must contain from 1 to 512 sale lines.',
    );

  const groups = new Map<DatecsVatGroup, string>();
  for (const treatment of Object.keys(configuration.taxGroups) as PosVatTreatment[]) {
    const setting = configuration.taxGroups[treatment];
    if (!setting || !/^[A-H]$/.test(setting.group))
      throw new DatecsFiscalConfigurationError(`A DATECS VAT group is required for ${treatment}.`);
    const rate = normalizeRate(setting.ratePercent);
    const previousRate = groups.get(setting.group);
    if (previousRate !== undefined && previousRate !== rate)
      throw new DatecsFiscalConfigurationError('One DATECS VAT group cannot represent two rates.');
    groups.set(setting.group, rate);
  }

  const lines = request.lines.map((line) => {
    const group = configuration.taxGroups[line.vatTreatment];
    const unitPrice = parseDecimal(line.unitPriceEur, 'Unit price', 4);
    const quantity = parseDecimal(line.quantity, 'Quantity', 3);
    const grossCents = parseCents(line.grossTotalEur, 'Line total');
    const discountCents = parseCents(line.discountEur ?? '0', 'Line discount');
    if (unitPrice.coefficient <= 0n || quantity.coefficient <= 0n)
      throw new DatecsFiscalConfigurationError('Fiscal line price and quantity must be positive.');
    const baseCents = multiplyToCents(unitPrice, quantity);
    if (discountCents > baseCents || baseCents - discountCents !== grossCents)
      throw new DatecsFiscalConfigurationError(
        'The fiscal line price, quantity, discount, and final total do not reconcile to cents.',
      );

    const description = splitDescription(line.description);
    const unitCode = line.unitCode ? encodeDatecsWindows1251(line.unitCode) : new Uint8Array();
    if (
      unitCode.byteLength > 8 ||
      unitCode.some((byte) => byte < 0x21 || byte > 0x7e || byte === 0x23)
    )
      throw new DatecsFiscalConfigurationError(
        'The fiscal unit code must use up to 8 Latin characters.',
      );
    const prefix = description.second
      ? concatBytes(
          description.first,
          new Uint8Array([0x0a]),
          description.second,
          new Uint8Array([0x09]),
        )
      : concatBytes(description.first, new Uint8Array([0x09]));
    const quantitySuffix = `*${formatDecimal(quantity)}`;
    const unitSuffix = unitCode.byteLength ? `#${line.unitCode}` : '';
    const discountSuffix = discountCents > 0n ? `;${formatCents(discountCents)}` : '';
    const data = concatBytes(
      prefix,
      encodeDatecsWindows1251(
        `${group.group}${formatDecimal(unitPrice)}${quantitySuffix}${unitSuffix}${discountSuffix}`,
      ),
    );
    return { data, grossCents };
  });

  if (lines.reduce((sum, line) => sum + line.grossCents, 0n) !== totalGrossCents)
    throw new DatecsFiscalConfigurationError('Sale lines do not add up to the sale total.');

  return {
    cashTenderedCents,
    changeCents: cashTenderedCents - totalGrossCents,
    lines,
  };
}

function verifyCurrencyAndTaxGroups(
  response: DatecsFiscalResponse,
  configuration: DatecsFiscalSaleConfiguration['taxGroups'],
): void {
  const values = decodeDatecsWindows1251(response.data).split(',');
  if (
    values.length !== 12 ||
    values[1]?.trim() !== '2' ||
    values[2]?.trim().toUpperCase() !== 'EUR'
  )
    throw new DatecsFiscalConfigurationError(
      'The printer must be configured for EUR with two decimal places before POS sales.',
    );
  const enabled = values[3]?.trim();
  const rates = values.slice(4).map((value) => normalizeRate(value));
  if (enabled === undefined || !/^[01]{8}$/.test(enabled))
    throw new DatecsFiscalConfigurationError(
      'The printer did not return all eight VAT group settings.',
    );
  for (const [treatment, mapping] of Object.entries(configuration) as [
    PosVatTreatment,
    DatecsTaxGroupConfiguration,
  ][]) {
    const index = mapping.group.charCodeAt(0) - 65;
    if (enabled[index] !== '1' || rates[index] !== normalizeRate(mapping.ratePercent))
      throw new DatecsFiscalConfigurationError(
        `DATECS VAT group ${mapping.group} does not match the configured ${treatment} rate.`,
      );
  }
}

function assertFiscalReadyStatus(response: DatecsFiscalResponse): void {
  const status = response.status;
  if ((status[4]! & 0x06) !== 0x06)
    throw new DatecsFiscalConfigurationError(
      'The printer is missing its fiscal device ID or company ID.',
    );
  if ((status[5]! & 0x1a) !== 0x1a)
    throw new DatecsFiscalConfigurationError(
      'The printer is not formatted, tax-configured, and fiscally registered.',
    );
  if (isReceiptOpen(status))
    throw new DatecsFiscalConfigurationError(
      'The printer already has an open receipt. Resolve it before starting another sale.',
    );
  if ((status[2]! & 0x20) !== 0)
    throw new DatecsFiscalConfigurationError('The printer has an open service receipt.');
}

function assertHealthyStatus(response: DatecsFiscalResponse, step: string): void {
  const status = response.status;
  const errors: string[] = [];
  if ((status[0]! & 0x33) !== 0) errors.push('printer or command error');
  if ((status[1]! & 0x0f) !== 0) errors.push('fiscal mode, memory, or amount error');
  if ((status[2]! & 0x05) !== 0) errors.push('paper or electronic journal error');
  if ((status[4]! & 0x71) !== 0) errors.push('fiscal memory or print-head error');
  if ((status[5]! & 0x05) !== 0) errors.push('fiscal memory write or lock error');
  if (errors.length)
    throw new DatecsFiscalDeviceStatusError(
      `The printer reported ${errors.join(', ')} during ${step}.`,
    );
}

function isReceiptOpen(status: Uint8Array): boolean {
  return (status[2]! & 0x08) !== 0;
}

function isReceiptClosedWithoutFault(response: DatecsFiscalResponse): boolean {
  return (
    response.data.byteLength === 0 &&
    !isReceiptOpen(response.status) &&
    (response.status[0]! & 0x33) === 0 &&
    (response.status[1]! & 0x0f) === 0 &&
    (response.status[2]! & 0x05) === 0 &&
    (response.status[4]! & 0x71) === 0 &&
    (response.status[5]! & 0x05) === 0
  );
}

function parsePaymentResult(data: Uint8Array): { code: string; amountCents?: bigint } {
  const text = decodeDatecsWindows1251(data).trim();
  const code = text.slice(0, 1);
  const amount = text.slice(1).trim();
  if (code === 'P') return { code, ...(amount ? { amountCents: parseSignedCents(amount) } : {}) };
  if (code === 'D' || code === 'R') return { code, amountCents: parseSignedCents(amount) };
  return { code };
}

function parseReceiptCounts(data: Uint8Array): { fiscalReceiptCount: string } {
  const [all, fiscal] = decodeDatecsWindows1251(data).split(',');
  if (
    all === undefined ||
    fiscal === undefined ||
    !/^\d{1,4}$/.test(all) ||
    !/^\d{1,4}$/.test(fiscal)
  )
    throw new DatecsFiscalConfigurationError('The printer did not return valid receipt counters.');
  return { fiscalReceiptCount: fiscal };
}

function parseLastFiscalDocument(data: Uint8Array): {
  documentNumber: string;
  uniqueSaleId: string;
} {
  const [documentNumber, uniqueSaleId] = decodeDatecsWindows1251(data).split(',');
  if (
    documentNumber === undefined ||
    uniqueSaleId === undefined ||
    !/^\d{1,10}$/.test(documentNumber) ||
    !/^[A-Z0-9]{8}-[A-Z0-9]{4}-\d{7}$/.test(uniqueSaleId)
  )
    throw new DatecsFiscalConfigurationError(
      'The printer did not identify the last fiscal document.',
    );
  return { documentNumber, uniqueSaleId };
}

function splitDescription(value: string): { first: Uint8Array; second?: Uint8Array } {
  if (
    !value.trim() ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  )
    throw new DatecsFiscalConfigurationError(
      'Each product needs a one- or two-line printable name.',
    );
  const bytes = Array.from(value, (character) => {
    const byte = cp1251ByteByCharacter.get(character);
    if (byte === undefined || byte === 0x98)
      throw new DatecsFiscalConfigurationError(
        'A product name contains a character the printer cannot print.',
      );
    return byte;
  });
  if (bytes.length > 84)
    throw new DatecsFiscalConfigurationError('A printed product name cannot exceed 84 characters.');
  return bytes.length <= 42
    ? { first: Uint8Array.from(bytes) }
    : { first: Uint8Array.from(bytes.slice(0, 42)), second: Uint8Array.from(bytes.slice(42)) };
}

export function encodeDatecsWindows1251(value: string): Uint8Array {
  return Uint8Array.from(
    Array.from(value, (character) => {
      const byte = cp1251ByteByCharacter.get(character);
      if (byte === undefined || byte === 0x98)
        throw new DatecsFiscalConfigurationError('Text contains a character DATECS cannot encode.');
      return byte;
    }),
  );
}

export function decodeDatecsWindows1251(value: Uint8Array): string {
  return Array.from(value, (byte) => {
    if (byte < 0x80) return String.fromCharCode(byte);
    return cp1251High[byte - 0x80] ?? '';
  }).join('');
}

function normalizeRate(value: string): string {
  const parsed = parseDecimal(value, 'VAT rate', 2);
  return formatDecimal(parsed);
}

function parseCents(value: string, label: string): bigint {
  const parsed = parseDecimal(value, label, 2);
  return parsed.coefficient * 10n ** BigInt(2 - parsed.scale);
}

function parseSignedCents(value: string): bigint {
  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match)
    throw new DatecsFiscalConfigurationError('The printer returned an invalid payment amount.');
  const fraction = (match[3] ?? '').padEnd(2, '0');
  const cents = BigInt(`${match[2]}${fraction}`);
  return match[1] === '-' ? -cents : cents;
}

function parseDecimal(
  value: string,
  label: string,
  maximumScale: number,
): { coefficient: bigint; scale: number } {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  const fraction = match?.[2] ?? '';
  if (!match || fraction.length > maximumScale)
    throw new DatecsFiscalConfigurationError(
      `${label} must be a non-negative decimal with at most ${maximumScale} decimal places.`,
    );
  return { coefficient: BigInt(`${match[1]}${fraction}`), scale: fraction.length };
}

function multiplyToCents(
  price: { coefficient: bigint; scale: number },
  quantity: { coefficient: bigint; scale: number },
): bigint {
  const numerator = price.coefficient * quantity.coefficient * 100n;
  const denominator = 10n ** BigInt(price.scale + quantity.scale);
  return (numerator + denominator / 2n) / denominator;
}

function formatDecimal(value: { coefficient: bigint; scale: number }): string {
  const raw = value.coefficient.toString().padStart(value.scale + 1, '0');
  if (value.scale === 0) return raw;
  const whole = raw.slice(0, -value.scale);
  const fraction = raw.slice(-value.scale).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function formatCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
