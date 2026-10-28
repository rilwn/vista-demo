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

const COMMAND_DAILY_REPORT = 0x45;
const TAX_GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;

export type DatecsDailyReportType = 'X' | 'Z';

export interface DatecsDailyReportResult {
  fiscalRecordNumber: string;
  nonVatSalesTotal: string;
  taxGroupTotals: Record<(typeof TAX_GROUPS)[number], string>;
  type: DatecsDailyReportType;
}

/**
 * Prints the DATECS daily X or Z report. The Z report closes the fiscal day;
 * callers must persist an intent before the printer command and reconcile any
 * uncertain result instead of repeating it in a new printer session.
 */
export class DatecsFiscalReportAdapter {
  constructor(private readonly commandPort: DatecsFiscalSaleCommandPort) {}

  issueXReport(beforePrint?: () => Promise<void>): Promise<DatecsDailyReportResult> {
    return this.issue('X', beforePrint);
  }

  issueZReport(beforePrint?: () => Promise<void>): Promise<DatecsDailyReportResult> {
    return this.issue('Z', beforePrint);
  }

  private async issue(
    type: DatecsDailyReportType,
    beforePrint?: () => Promise<void>,
  ): Promise<DatecsDailyReportResult> {
    let commandAttempted = false;
    try {
      const ready = await this.commandPort.synchronize();
      assertFiscalPrinterReady(ready);
      await beforePrint?.();

      // DATECS FP-2000 command 69: 2 prints an X report without clearing
      // registers; 0 prints a Z report and writes the fiscal daily record.
      commandAttempted = true;
      const response = await this.commandPort.execute(
        COMMAND_DAILY_REPORT,
        encodeDatecsWindows1251(type === 'X' ? '2' : '0'),
      );
      assertFiscalPrinterReady(response);
      return parseReportResponse(response.data, type);
    } catch (error) {
      if (!commandAttempted) throw error;
      if (error instanceof DatecsProtocolRejectedError) throw error;
      if (error instanceof DatecsCommandOutcomeUnknownError) {
        if (error.commandCode === undefined) error.commandCode = COMMAND_DAILY_REPORT;
        throw error;
      }
      await this.commandPort.markOutcomeUnknown(COMMAND_DAILY_REPORT);
      throw new DatecsCommandOutcomeUnknownError(
        `The DATECS ${type} report may have printed, but its result could not be confirmed. Review the printer before continuing.`,
        error,
      );
    }
  }
}

function parseReportResponse(
  data: Uint8Array,
  type: DatecsDailyReportType,
): DatecsDailyReportResult {
  const values = decodeDatecsWindows1251(data)
    .trim()
    .split(',')
    .map((value) => value.trim());
  if (values.length !== 10 || values.some((value) => !isPrinterAmount(value)))
    throw new DatecsFiscalConfigurationError(
      `The printer did not return a complete ${type} report summary. Review the printed report.`,
    );

  const [fiscalRecordNumber, nonVatSalesTotal, ...taxTotals] = values;
  if (!/^\d{1,4}$/u.test(fiscalRecordNumber!))
    throw new DatecsFiscalConfigurationError(
      `The printer returned an invalid ${type} fiscal record number. Review the printed report.`,
    );

  return {
    fiscalRecordNumber: fiscalRecordNumber!,
    nonVatSalesTotal: nonVatSalesTotal!,
    taxGroupTotals: Object.fromEntries(
      TAX_GROUPS.map((group, index) => [group, taxTotals[index]!]),
    ) as DatecsDailyReportResult['taxGroupTotals'],
    type,
  };
}

function isPrinterAmount(value: string): boolean {
  return /^-?\d{1,12}(?:\.\d{1,2})?$/u.test(value);
}

function assertFiscalPrinterReady(response: DatecsFiscalResponse): void {
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
      'The printer is not fiscally registered and ready to print a daily report.',
    );
  if ((status[2]! & 0x28) !== 0)
    throw new DatecsFiscalConfigurationError(
      'Close the open printer receipt before requesting a daily report.',
    );
}
