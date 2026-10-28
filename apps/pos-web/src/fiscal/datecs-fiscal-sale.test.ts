import { describe, expect, it } from 'vitest';
import {
  DatecsFiscalConfigurationError,
  DatecsFiscalSaleAdapter,
  DatecsFiscalSaleCancelledError,
  decodeDatecsWindows1251,
  type DatecsFiscalSaleCommandPort,
  type DatecsTaxGroupConfiguration,
} from './datecs-fiscal-sale';
import {
  DatecsCommandOutcomeUnknownError,
  DatecsProtocolRejectedError,
} from './datecs-command-client';
import type { DatecsFiscalResponse } from './datecs-protocol';
import type { PosVatTreatment } from '@vista/contracts';

const saleId = 'DT000600-OP01-0001000';

describe('DATECS FP-2000 cash receipt adapter', () => {
  it('issues an EUR cash receipt using documented wire commands and confirms its UNP', async () => {
    const port = new ScriptedCommandPort();
    const adapter = new DatecsFiscalSaleAdapter(port, configuration());

    const result = await adapter.issueCashReceipt({
      cashTenderedEur: '55.00',
      lines: [
        {
          description: 'Тестов адаптер',
          discountEur: '0.00',
          grossTotalEur: '50.00',
          quantity: '1',
          unitCode: 'PCS',
          unitPriceEur: '50.00',
          vatTreatment: 'standard_20',
        },
      ],
      totalGrossEur: '50.00',
      uniqueSaleId: saleId,
    });

    expect(result).toEqual({
      changeEur: '5.00',
      fiscalDocumentNumber: '0000123',
      fiscalReceiptsSinceDailyReport: '0001',
      uniqueSaleId: saleId,
    });
    expect(port.calls.map((call) => call.command)).toEqual([
      0x53, // 83: read currency and tax configuration
      0x30, // 48: open fiscal receipt
      0x31, // 49: enter product
      0x35, // 53: cash payment
      0x38, // 56: close fiscal receipt
      0x30, // 48: query last fiscal document
    ]);
    expect(decodeDatecsWindows1251(port.calls[1]!.data)).toBe(`1,0000,1,,${saleId}`);
    expect(decodeDatecsWindows1251(port.calls[2]!.data)).toBe('Тестов адаптер\tB50*1#PCS');
    expect(decodeDatecsWindows1251(port.calls[3]!.data)).toBe('\tP+55.00');
    expect(decodeDatecsWindows1251(port.calls[5]!.data)).toBe('*');
    expect(port.unresolvedCommands).toEqual([]);
  });

  it('rejects a printer with a non-EUR currency or mismatched VAT setup before opening a receipt', async () => {
    const port = new ScriptedCommandPort({ currencyAndTaxes: '0,2,BGN,11111111,20,9,0,0,0,0,0,0' });
    const adapter = new DatecsFiscalSaleAdapter(port, configuration());

    await expect(adapter.issueCashReceipt(validRequest())).rejects.toBeInstanceOf(
      DatecsFiscalConfigurationError,
    );
    expect(port.calls.map((call) => call.command)).toEqual([0x53]);
    expect(port.unresolvedCommands).toEqual([]);
  });

  it('cancels a confirmed, unpaid receipt after a rejected sale line', async () => {
    const port = new ScriptedCommandPort({ rejectSaleLine: true });
    const adapter = new DatecsFiscalSaleAdapter(port, configuration());

    await expect(adapter.issueCashReceipt(validRequest())).rejects.toBeInstanceOf(
      DatecsFiscalSaleCancelledError,
    );
    expect(port.calls.map((call) => call.command)).toEqual([0x53, 0x30, 0x31, 0x3c]);
    expect(port.unresolvedCommands).toEqual([]);
  });

  it('waits for server acknowledgement before opening and can identify the last receipt read-only', async () => {
    const port = new ScriptedCommandPort();
    const adapter = new DatecsFiscalSaleAdapter(port, configuration());
    let callbackReached = false;

    const receipt = await adapter.issueCashReceipt(validRequest(), () => {
      callbackReached = true;
      expect(port.calls.map((call) => call.command)).toEqual([0x53]);
      return Promise.resolve();
    });
    expect(callbackReached).toBe(true);
    expect(receipt.uniqueSaleId).toBe(saleId);

    const lastDocument = await adapter.inspectLastFiscalDocument();
    expect(lastDocument).toEqual({ documentNumber: '0000123', uniqueSaleId: saleId });
    expect(port.calls.at(-1)).toMatchObject({ command: 0x30 });
    expect(decodeDatecsWindows1251(port.calls.at(-1)!.data)).toBe('*');
  });

  it('reports an explicit printer refusal to open without claiming a receipt was issued', async () => {
    const port = new ScriptedCommandPort({ rejectOpenReceipt: true });
    const adapter = new DatecsFiscalSaleAdapter(port, configuration());
    let beforeOpenCalled = false;

    await expect(
      adapter.issueCashReceipt(validRequest(), () => {
        beforeOpenCalled = true;
        return Promise.resolve();
      }),
    ).rejects.toBeInstanceOf(DatecsProtocolRejectedError);
    expect(beforeOpenCalled).toBe(true);
    expect(port.calls.map((call) => call.command)).toEqual([0x53, 0x30]);
    expect(port.unresolvedCommands).toEqual([]);
  });

  it('keeps the register locked when payment or receipt-close outcome is uncertain', async () => {
    const paymentPort = new ScriptedCommandPort({ rejectPayment: true });
    const paymentAdapter = new DatecsFiscalSaleAdapter(paymentPort, configuration());
    await expect(paymentAdapter.issueCashReceipt(validRequest())).rejects.toBeInstanceOf(
      DatecsCommandOutcomeUnknownError,
    );
    expect(paymentPort.unresolvedCommands).toEqual([0x35]);
    expect(paymentPort.calls.map((call) => call.command)).not.toContain(0x3c);

    const closePort = new ScriptedCommandPort({ loseCloseReply: true });
    const closeAdapter = new DatecsFiscalSaleAdapter(closePort, configuration());
    await expect(closeAdapter.issueCashReceipt(validRequest())).rejects.toBeInstanceOf(
      DatecsCommandOutcomeUnknownError,
    );
    expect(closePort.unresolvedCommands).toEqual([0x38]);
  });

  it('refuses to report success if the last fiscal document belongs to another transaction', async () => {
    const port = new ScriptedCommandPort({ lastUniqueSaleId: 'DT000600-OP01-0000999' });
    const adapter = new DatecsFiscalSaleAdapter(port, configuration());

    await expect(adapter.issueCashReceipt(validRequest())).rejects.toBeInstanceOf(
      DatecsCommandOutcomeUnknownError,
    );
    expect(port.unresolvedCommands).toEqual([0x30]);
  });

  it('validates cents, receipt identity and split totals before sending fiscal commands', async () => {
    const port = new ScriptedCommandPort();
    const adapter = new DatecsFiscalSaleAdapter(port, configuration());

    await expect(
      adapter.issueCashReceipt({ ...validRequest(), uniqueSaleId: 'not-a-datecs-unp' }),
    ).rejects.toBeInstanceOf(DatecsFiscalConfigurationError);
    await expect(
      adapter.issueCashReceipt({
        ...validRequest(),
        lines: [{ ...validRequest().lines[0]!, grossTotalEur: '49.99' }],
      }),
    ).rejects.toBeInstanceOf(DatecsFiscalConfigurationError);
    expect(port.calls).toEqual([]);
  });
});

class ScriptedCommandPort implements DatecsFiscalSaleCommandPort {
  readonly calls: Array<{ command: number; data: Uint8Array }> = [];
  readonly unresolvedCommands: number[] = [];
  private receiptOpen = false;
  private readonly options: {
    currencyAndTaxes?: string;
    lastUniqueSaleId?: string;
    rejectOpenReceipt?: boolean;
    rejectPayment?: boolean;
    rejectSaleLine?: boolean;
    loseCloseReply?: boolean;
  };

  constructor(options: ScriptedCommandPort['options'] = {}) {
    this.options = options;
  }

  synchronize(): Promise<DatecsFiscalResponse> {
    return Promise.resolve(response(0x4a, '', this.status()));
  }

  async execute(command: number, data = new Uint8Array()): Promise<DatecsFiscalResponse> {
    this.calls.push({ command, data: data.slice() });
    if (command === 0x53)
      return response(
        command,
        this.options.currencyAndTaxes ?? '0,2,EUR,11111111,0,20,9,0,0,20,0,0',
      );
    if (command === 0x30 && decodeDatecsWindows1251(data) === '*')
      return response(command, `0000123,${this.options.lastUniqueSaleId ?? saleId}`, this.status());
    if (command === 0x30) {
      if (this.options.rejectOpenReceipt) throw new DatecsProtocolRejectedError('scripted NAK');
      this.receiptOpen = true;
      return response(command, '0001,0000', this.status());
    }
    if (command === 0x31 && this.options.rejectSaleLine)
      throw new DatecsProtocolRejectedError('scripted NAK');
    if (command === 0x31) return response(command, '', this.status());
    if (command === 0x35 && this.options.rejectPayment)
      throw new DatecsProtocolRejectedError('scripted NAK');
    if (command === 0x35) return response(command, 'R5.00', this.status());
    if (command === 0x3c) {
      this.receiptOpen = false;
      return response(command, '', this.status());
    }
    if (command === 0x38) {
      if (this.options.loseCloseReply) {
        await this.markOutcomeUnknown(command);
        throw new DatecsCommandOutcomeUnknownError('scripted lost close response');
      }
      this.receiptOpen = false;
      return response(command, '0001,0001', this.status());
    }
    throw new Error(`Unexpected DATECS command: ${command}`);
  }

  markOutcomeUnknown(commandCode: number): Promise<void> {
    this.unresolvedCommands.push(commandCode);
    return Promise.resolve();
  }

  private status(): Uint8Array {
    return new Uint8Array([0x80, 0x80, 0x80 | (this.receiptOpen ? 0x08 : 0), 0x80, 0x86, 0x9a]);
  }
}

function configuration(): {
  operatorNumber: number;
  operatorPassword: string;
  registerLocationNumber: number;
  taxGroups: Record<PosVatTreatment, DatecsTaxGroupConfiguration>;
} {
  return {
    operatorNumber: 1,
    operatorPassword: '0000',
    registerLocationNumber: 1,
    taxGroups: {
      standard_20: { group: 'B', ratePercent: '20' },
      reduced_9: { group: 'C', ratePercent: '9' },
      zero: { group: 'D', ratePercent: '0' },
      exempt: { group: 'E', ratePercent: '0' },
      ica: { group: 'F', ratePercent: '20' },
    },
  };
}

function validRequest() {
  return {
    cashTenderedEur: '55.00',
    lines: [
      {
        description: 'Test product',
        grossTotalEur: '50.00',
        quantity: '1',
        unitPriceEur: '50.00',
        vatTreatment: 'standard_20' as const,
      },
    ],
    totalGrossEur: '50.00',
    uniqueSaleId: saleId,
  };
}

function response(
  command: number,
  data: string,
  status: Uint8Array = new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x86, 0x9a]),
): DatecsFiscalResponse {
  return {
    command,
    data: new TextEncoder().encode(data),
    sequence: 0x40,
    status,
  };
}
