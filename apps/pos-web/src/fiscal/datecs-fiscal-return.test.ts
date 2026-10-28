import { describe, expect, it } from 'vitest';
import {
  DatecsCommandOutcomeUnknownError,
  DatecsProtocolRejectedError,
} from './datecs-command-client';
import type { DatecsFiscalResponse } from './datecs-protocol';
import {
  DatecsFiscalConfigurationError,
  decodeDatecsWindows1251,
  type DatecsFiscalSaleCommandPort,
} from './datecs-fiscal-sale';
import {
  DatecsFiscalReturnAdapter,
  type DatecsFiscalFullReturnRequest,
} from './datecs-fiscal-return';

const originalId = 'DT000600-OP01-0001000';
const reversalId = 'DT000600-OP01-0001001';

describe('DATECS FP-2000 full fiscal return adapter', () => {
  it('prints the linked storno and verifies both document IDs before reporting success', async () => {
    const port = new ScriptedReturnPort();
    let printingStarted = false;
    const result = await new DatecsFiscalReturnAdapter(
      port,
      configuration(),
    ).issueFullReceiptStorno(validRequest(), () => {
      printingStarted = true;
      return Promise.resolve();
    });

    expect(result).toEqual({
      fiscalDocumentNumber: '0000124',
      fiscalReversalsSinceDailyReport: '0001',
      originalUniqueSaleId: originalId,
      uniqueReversalId: reversalId,
    });
    expect(printingStarted).toBe(true);
    expect(port.calls.map((call) => call.command)).toEqual([0x2e, 0x30]);
    expect(decodeDatecsWindows1251(port.calls[0]!.data)).toBe(
      `1,0000,1,${reversalId},R0000123#Customer return`,
    );
    expect(decodeDatecsWindows1251(port.calls[1]!.data)).toBe('*');
    expect(port.unresolvedCommands).toEqual([]);
  });

  it('locks the register when the device does not identify the expected reversal', async () => {
    const port = new ScriptedReturnPort({ lastReversalId: originalId });

    await expect(
      new DatecsFiscalReturnAdapter(port, configuration()).issueFullReceiptStorno(validRequest()),
    ).rejects.toBeInstanceOf(DatecsCommandOutcomeUnknownError);
    expect(port.unresolvedCommands).toEqual([0x30]);
  });

  it('keeps a lost storno response unresolved instead of retrying the reversal', async () => {
    const port = new ScriptedReturnPort({ loseStornoReply: true });

    await expect(
      new DatecsFiscalReturnAdapter(port, configuration()).issueFullReceiptStorno(validRequest()),
    ).rejects.toBeInstanceOf(DatecsCommandOutcomeUnknownError);
    expect(port.calls.map((call) => call.command)).toEqual([0x2e]);
    expect(port.unresolvedCommands).toEqual([0x2e]);
  });

  it('recovers a lost response by reading the last document without issuing another storno', async () => {
    const port = new ScriptedReturnPort();
    const result = await new DatecsFiscalReturnAdapter(port, configuration()).inspectLastStorno({
      uniqueReversalId: reversalId,
    });

    expect(result).toEqual({ fiscalDocumentNumber: '0000124', uniqueReversalId: reversalId });
    expect(port.calls.map((call) => call.command)).toEqual([0x30]);
  });

  it('keeps recovery blocked when the last fiscal document is not this return', async () => {
    const port = new ScriptedReturnPort({ lastReversalId: originalId });
    await expect(
      new DatecsFiscalReturnAdapter(port, configuration()).inspectLastStorno({
        uniqueReversalId: reversalId,
      }),
    ).rejects.toBeInstanceOf(DatecsCommandOutcomeUnknownError);
    expect(port.calls.map((call) => call.command)).toEqual([0x30]);
  });

  it('does not lock the printer if server acknowledgement fails before command 46', async () => {
    const port = new ScriptedReturnPort();

    await expect(
      new DatecsFiscalReturnAdapter(port, configuration()).issueFullReceiptStorno(
        validRequest(),
        () => Promise.reject(new Error('server unavailable')),
      ),
    ).rejects.toThrow('server unavailable');
    expect(port.calls).toEqual([]);
    expect(port.unresolvedCommands).toEqual([]);
  });

  it('rejects invalid source IDs and reasons before contacting the printer', async () => {
    const port = new ScriptedReturnPort();
    const adapter = new DatecsFiscalReturnAdapter(port, configuration());

    await expect(
      adapter.issueFullReceiptStorno({ ...validRequest(), originalFiscalDocumentNumber: 'bad' }),
    ).rejects.toBeInstanceOf(DatecsFiscalConfigurationError);
    await expect(
      adapter.issueFullReceiptStorno({ ...validRequest(), reason: 'Return, customer request' }),
    ).rejects.toBeInstanceOf(DatecsFiscalConfigurationError);
    expect(port.calls).toEqual([]);
  });

  it('does not treat an explicit printer rejection as an issued reversal', async () => {
    const port = new ScriptedReturnPort({ rejectStorno: true });

    await expect(
      new DatecsFiscalReturnAdapter(port, configuration()).issueFullReceiptStorno(validRequest()),
    ).rejects.toBeInstanceOf(DatecsProtocolRejectedError);
    expect(port.unresolvedCommands).toEqual([]);
    expect(port.calls.map((call) => call.command)).toEqual([0x2e]);
  });
});

class ScriptedReturnPort implements DatecsFiscalSaleCommandPort {
  readonly calls: Array<{ command: number; data: Uint8Array }> = [];
  readonly unresolvedCommands: number[] = [];
  private readonly options: {
    lastReversalId?: string;
    loseStornoReply?: boolean;
    rejectStorno?: boolean;
  };

  constructor(options: ScriptedReturnPort['options'] = {}) {
    this.options = options;
  }

  synchronize(): Promise<DatecsFiscalResponse> {
    return Promise.resolve(response(0x4a, '', readyStatus()));
  }

  async execute(command: number, data = new Uint8Array()): Promise<DatecsFiscalResponse> {
    this.calls.push({ command, data: data.slice() });
    if (command === 0x2e) {
      if (this.options.rejectStorno) throw new DatecsProtocolRejectedError('scripted NAK');
      if (this.options.loseStornoReply) {
        await this.markOutcomeUnknown(command);
        throw new DatecsCommandOutcomeUnknownError('scripted lost storno reply');
      }
      return response(command, '0002,0001', readyStatus());
    }
    if (command === 0x30 && decodeDatecsWindows1251(data) === '*')
      return response(
        command,
        `0000124,${this.options.lastReversalId ?? reversalId}`,
        readyStatus(),
      );
    throw new Error(`Unexpected DATECS command: ${command}`);
  }

  markOutcomeUnknown(commandCode: number): Promise<void> {
    this.unresolvedCommands.push(commandCode);
    return Promise.resolve();
  }
}

function validRequest(): DatecsFiscalFullReturnRequest {
  return {
    originalFiscalDocumentNumber: '0000123',
    originalUniqueSaleId: originalId,
    reason: 'Customer return',
    uniqueReversalId: reversalId,
  };
}

function configuration() {
  return { operatorNumber: 1, operatorPassword: '0000', registerLocationNumber: 1 };
}

function readyStatus(): Uint8Array {
  return new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x86, 0x9a]);
}

function response(command: number, data: string, status: Uint8Array): DatecsFiscalResponse {
  return { command, data: new TextEncoder().encode(data), sequence: 0x40, status };
}
