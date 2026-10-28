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
import { DatecsFiscalReportAdapter } from './datecs-fiscal-report';

describe('DATECS FP-2000 daily reports', () => {
  it('prints a non-clearing X report and returns its exact fiscal totals', async () => {
    const port = new ScriptedReportPort();
    let intentRecorded = false;
    const result = await new DatecsFiscalReportAdapter(port).issueXReport(() => {
      intentRecorded = true;
      return Promise.resolve();
    });

    expect(intentRecorded).toBe(true);
    expect(port.calls).toHaveLength(1);
    expect(port.calls[0]!.command).toBe(0x45);
    expect(decodeDatecsWindows1251(port.calls[0]!.data)).toBe('2');
    expect(result).toEqual({
      fiscalRecordNumber: '0042',
      nonVatSalesTotal: '0.00',
      taxGroupTotals: {
        A: '0.00',
        B: '120.00',
        C: '0.00',
        D: '0.00',
        E: '0.00',
        F: '0.00',
        G: '0.00',
        H: '0.00',
      },
      type: 'X',
    });
    expect(port.unresolvedCommands).toEqual([]);
  });

  it('prints a clearing Z report only after the server has recorded its intent', async () => {
    const port = new ScriptedReportPort();
    const events: string[] = [];
    const report = await new DatecsFiscalReportAdapter(port).issueZReport(() => {
      events.push('intent');
      return Promise.resolve();
    });

    events.push('confirmed');
    expect(events).toEqual(['intent', 'confirmed']);
    expect(decodeDatecsWindows1251(port.calls[0]!.data)).toBe('0');
    expect(report.type).toBe('Z');
  });

  it('does not send a printer command if server-side intent recording fails', async () => {
    const port = new ScriptedReportPort();

    await expect(
      new DatecsFiscalReportAdapter(port).issueZReport(() =>
        Promise.reject(new Error('server unavailable')),
      ),
    ).rejects.toThrow('server unavailable');
    expect(port.calls).toEqual([]);
    expect(port.unresolvedCommands).toEqual([]);
  });

  it('locks the printer when the report result is lost rather than repeating a Z report', async () => {
    const port = new ScriptedReportPort({ loseReply: true });

    await expect(new DatecsFiscalReportAdapter(port).issueZReport()).rejects.toBeInstanceOf(
      DatecsCommandOutcomeUnknownError,
    );
    expect(port.calls).toHaveLength(1);
    expect(port.unresolvedCommands).toEqual([0x45]);
  });

  it('fails closed when the printer returns an incomplete or invalid report summary', async () => {
    const port = new ScriptedReportPort({ reportData: '0042,0.00,120.00' });

    await expect(new DatecsFiscalReportAdapter(port).issueXReport()).rejects.toBeInstanceOf(
      DatecsCommandOutcomeUnknownError,
    );
    expect(port.unresolvedCommands).toEqual([0x45]);
  });

  it('does not mark an explicit printer rejection as an uncertain report', async () => {
    const port = new ScriptedReportPort({ rejectReport: true });

    await expect(new DatecsFiscalReportAdapter(port).issueZReport()).rejects.toBeInstanceOf(
      DatecsProtocolRejectedError,
    );
    expect(port.unresolvedCommands).toEqual([]);
  });

  it('rejects an open receipt before recording intent or running the report', async () => {
    const port = new ScriptedReportPort({ openReceipt: true });
    let intentRecorded = false;

    await expect(
      new DatecsFiscalReportAdapter(port).issueXReport(() => {
        intentRecorded = true;
        return Promise.resolve();
      }),
    ).rejects.toBeInstanceOf(DatecsFiscalConfigurationError);
    expect(intentRecorded).toBe(false);
    expect(port.calls).toEqual([]);
  });
});

class ScriptedReportPort implements DatecsFiscalSaleCommandPort {
  readonly calls: Array<{ command: number; data: Uint8Array }> = [];
  readonly unresolvedCommands: number[] = [];
  private readonly options: {
    loseReply?: boolean;
    openReceipt?: boolean;
    rejectReport?: boolean;
    reportData?: string;
  };

  constructor(options: ScriptedReportPort['options'] = {}) {
    this.options = options;
  }

  synchronize(): Promise<DatecsFiscalResponse> {
    const status = readyStatus();
    if (this.options.openReceipt) status[2] = 0x88;
    return Promise.resolve(response(0x4a, '', status));
  }

  async execute(command: number, data = new Uint8Array()): Promise<DatecsFiscalResponse> {
    this.calls.push({ command, data: data.slice() });
    if (command !== 0x45) throw new Error(`Unexpected DATECS command: ${command}`);
    if (this.options.rejectReport) throw new DatecsProtocolRejectedError('scripted NAK');
    if (this.options.loseReply) {
      await this.markOutcomeUnknown(command);
      throw new DatecsCommandOutcomeUnknownError('scripted lost report reply', undefined, command);
    }
    return response(
      command,
      this.options.reportData ?? '0042,0.00,0.00,120.00,0.00,0.00,0.00,0.00,0.00,0.00',
      readyStatus(),
    );
  }

  markOutcomeUnknown(commandCode: number): Promise<void> {
    this.unresolvedCommands.push(commandCode);
    return Promise.resolve();
  }
}

function response(command: number, data: string, status: Uint8Array): DatecsFiscalResponse {
  return { command, data: new TextEncoder().encode(data), sequence: 0x40, status };
}

function readyStatus(): Uint8Array {
  return new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x86, 0x9a]);
}
