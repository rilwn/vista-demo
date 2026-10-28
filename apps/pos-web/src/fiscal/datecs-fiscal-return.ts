import {
  DatecsCommandOutcomeUnknownError,
  DatecsProtocolRejectedError,
} from './datecs-command-client';
import type { DatecsFiscalSaleCommandPort } from './datecs-fiscal-sale';
import {
  DatecsFiscalConfigurationError,
  decodeDatecsWindows1251,
  encodeDatecsWindows1251,
} from './datecs-fiscal-sale';
import type { DatecsFiscalResponse } from './datecs-protocol';

const COMMAND_OPEN_RECEIPT = 0x30;
const COMMAND_STORNO_RECEIPT = 0x2e;

export interface DatecsFiscalReturnConfiguration {
  operatorNumber: number;
  operatorPassword: string;
  registerLocationNumber: number;
}

export interface DatecsFiscalFullReturnRequest {
  originalFiscalDocumentNumber: string;
  originalUniqueSaleId: string;
  reason: string;
  uniqueReversalId: string;
}

export interface DatecsFiscalReturnResult {
  fiscalDocumentNumber: string;
  fiscalReversalsSinceDailyReport: string;
  originalUniqueSaleId: string;
  uniqueReversalId: string;
}

/** Issues and verifies a full receipt storno using DATECS command 46. */
export class DatecsFiscalReturnAdapter {
  constructor(
    private readonly commandPort: DatecsFiscalSaleCommandPort,
    private readonly configuration: DatecsFiscalReturnConfiguration,
  ) {}

  async issueFullReceiptStorno(
    request: DatecsFiscalFullReturnRequest,
    beforeStorno?: () => Promise<void>,
  ): Promise<DatecsFiscalReturnResult> {
    validateRequest(request, this.configuration);
    let command = COMMAND_STORNO_RECEIPT;
    const ready = await this.commandPort.synchronize();
    assertPrinterReady(ready);
    await beforeStorno?.();

    try {
      const payload = [
        this.configuration.operatorNumber,
        this.configuration.operatorPassword,
        this.configuration.registerLocationNumber,
        request.uniqueReversalId,
        `R${request.originalFiscalDocumentNumber}#${request.reason}`,
      ].join(',');
      const response = await this.commandPort.execute(
        COMMAND_STORNO_RECEIPT,
        encodeDatecsWindows1251(payload),
      );
      assertPrinterReady(response);
      if (receiptIsOpen(response.status)) {
        await this.commandPort.markOutcomeUnknown(COMMAND_STORNO_RECEIPT);
        throw new DatecsCommandOutcomeUnknownError(
          'The printer did not confirm that the return receipt was completed. Review the printer before continuing.',
        );
      }
      const counts = parseStornoCounts(response.data);

      command = COMMAND_OPEN_RECEIPT;
      const last = await this.commandPort.execute(
        COMMAND_OPEN_RECEIPT,
        encodeDatecsWindows1251('*'),
      );
      assertPrinterReady(last);
      const document = parseLastStornoDocument(last.data);
      if (
        document.documentNumber === request.originalFiscalDocumentNumber ||
        document.uniqueReversalId !== request.uniqueReversalId
      ) {
        await this.commandPort.markOutcomeUnknown(COMMAND_OPEN_RECEIPT);
        throw new DatecsCommandOutcomeUnknownError(
          'The last printer document does not confirm this return. Review the printer before continuing.',
        );
      }

      return {
        fiscalDocumentNumber: document.documentNumber,
        fiscalReversalsSinceDailyReport: counts.stornoReceiptCount,
        originalUniqueSaleId: request.originalUniqueSaleId,
        uniqueReversalId: document.uniqueReversalId,
      };
    } catch (error) {
      if (
        error instanceof DatecsCommandOutcomeUnknownError ||
        error instanceof DatecsProtocolRejectedError
      )
        throw error;
      if (command === COMMAND_STORNO_RECEIPT)
        await this.commandPort.markOutcomeUnknown(COMMAND_STORNO_RECEIPT);
      else await this.commandPort.markOutcomeUnknown(command);
      throw new DatecsCommandOutcomeUnknownError(
        'The printer response did not safely confirm the return. Review the printer before continuing.',
        error,
      );
    }
  }

  /** Read-only recovery check. It never issues another storno command. */
  async inspectLastStorno(
    request: Pick<DatecsFiscalFullReturnRequest, 'uniqueReversalId'>,
  ): Promise<{ fiscalDocumentNumber: string; uniqueReversalId: string }> {
    const status = await this.commandPort.synchronize();
    assertPrinterReady(status);
    const response = await this.commandPort.execute(
      COMMAND_OPEN_RECEIPT,
      encodeDatecsWindows1251('*'),
    );
    assertPrinterReady(response);
    const document = parseLastStornoDocument(response.data);
    if (document.uniqueReversalId !== request.uniqueReversalId)
      throw new DatecsCommandOutcomeUnknownError(
        'The last printer document does not confirm this return. Do not repeat the return; review the printer and its journal.',
      );
    return {
      fiscalDocumentNumber: document.documentNumber,
      uniqueReversalId: document.uniqueReversalId,
    };
  }
}

function validateRequest(
  request: DatecsFiscalFullReturnRequest,
  configuration: DatecsFiscalReturnConfiguration,
): void {
  if (!/^[A-Z0-9]{8}-[A-Z0-9]{4}-\d{7}$/u.test(request.uniqueReversalId))
    throw new DatecsFiscalConfigurationError('The return needs a valid DATECS reversal ID.');
  if (!/^[A-Z0-9]{8}-[A-Z0-9]{4}-\d{7}$/u.test(request.originalUniqueSaleId))
    throw new DatecsFiscalConfigurationError('The original receipt ID is invalid.');
  if (!/^\d{1,10}$/u.test(request.originalFiscalDocumentNumber))
    throw new DatecsFiscalConfigurationError('The original fiscal document number is invalid.');
  if (
    !Number.isInteger(configuration.operatorNumber) ||
    configuration.operatorNumber < 1 ||
    configuration.operatorNumber > 16
  )
    throw new DatecsFiscalConfigurationError('The printer operator number must be from 1 to 16.');
  if (!/^\d{4,8}$/u.test(configuration.operatorPassword))
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
  const reason = encodeDatecsWindows1251(request.reason);
  if (
    !request.reason.trim() ||
    reason.byteLength > 30 ||
    request.reason.includes(',') ||
    request.reason.includes('#') ||
    reason.some((byte) => byte < 0x20 || byte === 0x7f)
  )
    throw new DatecsFiscalConfigurationError(
      'The printed return reason must be 1 to 30 printable characters without commas or #.',
    );
}

function assertPrinterReady(response: DatecsFiscalResponse): void {
  const status = response.status;
  const errors: string[] = [];
  if ((status[0]! & 0x33) !== 0) errors.push('printer or command error');
  if ((status[1]! & 0x0f) !== 0) errors.push('fiscal mode, memory, or amount error');
  if ((status[2]! & 0x05) !== 0) errors.push('paper or electronic journal error');
  if ((status[4]! & 0x71) !== 0) errors.push('fiscal memory or print-head error');
  if ((status[5]! & 0x05) !== 0) errors.push('fiscal memory write or lock error');
  if (errors.length)
    throw new DatecsFiscalConfigurationError(`The printer reported ${errors.join(', ')}.`);
  if ((status[4]! & 0x06) !== 0x06 || (status[5]! & 0x1a) !== 0x1a)
    throw new DatecsFiscalConfigurationError(
      'The printer is not fiscally registered and ready for a return.',
    );
  if (receiptIsOpen(status) || (status[2]! & 0x20) !== 0)
    throw new DatecsFiscalConfigurationError(
      'Close the open printer receipt before starting a return.',
    );
}

function receiptIsOpen(status: Uint8Array): boolean {
  return (status[2]! & 0x08) !== 0;
}

function parseStornoCounts(data: Uint8Array): { stornoReceiptCount: string } {
  const [allReceipts, stornoReceipts] = decodeDatecsWindows1251(data).split(',');
  if (
    allReceipts === undefined ||
    stornoReceipts === undefined ||
    !/^\d{1,4}$/u.test(allReceipts.trim()) ||
    !/^\d{1,4}$/u.test(stornoReceipts.trim())
  )
    throw new DatecsFiscalConfigurationError('The printer did not confirm the return count.');
  return { stornoReceiptCount: stornoReceipts.trim() };
}

function parseLastStornoDocument(data: Uint8Array): {
  documentNumber: string;
  uniqueReversalId: string;
} {
  const [documentNumber, uniqueReversalId] = decodeDatecsWindows1251(data).split(',');
  if (
    documentNumber === undefined ||
    uniqueReversalId === undefined ||
    !/^\d{1,10}$/u.test(documentNumber.trim()) ||
    !/^[A-Z0-9]{8}-[A-Z0-9]{4}-\d{7}$/u.test(uniqueReversalId.trim())
  )
    throw new DatecsFiscalConfigurationError('The printer did not identify the return document.');
  return {
    documentNumber: documentNumber.trim(),
    uniqueReversalId: uniqueReversalId.trim(),
  };
}
