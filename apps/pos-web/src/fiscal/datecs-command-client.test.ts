import { describe, expect, it } from 'vitest';
import {
  DatecsCommandClient,
  type DatecsCommandClientOptions,
  DatecsCommandOutcomeUnknownError,
  DatecsProtocolRejectedError,
} from './datecs-command-client';
import { DatecsResponseTimeoutError, type DatecsByteTransport } from './datecs-transport';
import type {
  FiscalOutcomeLockStore,
  FiscalOutcomeReview,
  UnresolvedFiscalOutcome,
} from '../offline-store';

const STATUS_COMMAND = 0x4a;

describe('DATECS command client', () => {
  it('requires a safe status synchronization before commands and advances past a sequence collision', async () => {
    const transport = new ScriptedTransport((frame) => {
      const sequence = frame[2]!;
      const command = frame[3]!;
      if (sequence === 0x42) return [response(sequence, 0x38)];
      return [response(sequence, command)];
    });
    const client = createClient(transport, { initialSequence: 0x42 });

    await expect(client.execute(0x48)).rejects.toThrow('synchronize');
    const status = await client.synchronize();
    expect(status.command).toBe(STATUS_COMMAND);
    expect(transport.writes.map((frame) => frame[2])).toEqual([0x42, 0x43]);

    const next = await client.execute(0x4c);
    expect(next.command).toBe(0x4c);
    expect(transport.writes.at(-1)?.[2]).toBe(0x44);
  });

  it('retries a NAK with the identical frame and sequence', async () => {
    let receiptAttempts = 0;
    const transport = new ScriptedTransport((frame) => {
      const sequence = frame[2]!;
      const command = frame[3]!;
      if (command === STATUS_COMMAND) return [response(sequence, command)];
      receiptAttempts += 1;
      return receiptAttempts === 1 ? [new Uint8Array([0x15])] : [response(sequence, command)];
    });
    const client = createClient(transport, { initialSequence: 0x30 });
    await client.synchronize();

    const result = await client.execute(0x48, new TextEncoder().encode('1,0000,OP'));
    expect(result.command).toBe(0x48);
    expect(transport.writes.at(-1)).toEqual(transport.writes.at(-2));
    expect(transport.writes.at(-1)?.[2]).toBe(0x31);
  });

  it('waits through SYN while the printer completes a long-running command', async () => {
    const transport = new ScriptedTransport((frame) => [response(frame[2]!, frame[3]!)]);
    const client = createClient(transport, { initialSequence: 0x35 });
    await client.synchronize();
    transport.replyFactory = (frame) => [new Uint8Array([0x16]), response(frame[2]!, frame[3]!)];

    const result = await client.execute(0x38);
    expect(result.command).toBe(0x38);
    expect(client.isSynchronized).toBe(true);
  });

  it('blocks further commands after an unconfirmed fiscal outcome', async () => {
    const transport = new ScriptedTransport((frame) => [response(frame[2]!, frame[3]!)]);
    const outcomeLockStore = new MemoryFiscalOutcomeLockStore();
    const client = createClient(transport, {
      initialSequence: 0x39,
      maxAttempts: 2,
      responseTimeoutMs: 1,
      outcomeLockStore,
    });
    await client.synchronize();
    transport.replyFactory = () => [];

    await expect(client.execute(0x38)).rejects.toBeInstanceOf(DatecsCommandOutcomeUnknownError);
    await expect(client.execute(0x4c)).rejects.toBeInstanceOf(DatecsCommandOutcomeUnknownError);
    const writesBeforeUnsafeResynchronization = transport.writes.length;
    await expect(client.synchronize()).rejects.toBeInstanceOf(DatecsCommandOutcomeUnknownError);
    expect(transport.writes).toHaveLength(writesBeforeUnsafeResynchronization);
    expect(transport.writes.slice(-2)[0]).toEqual(transport.writes.at(-1));

    const restartedTransport = new ScriptedTransport((frame) => [response(frame[2]!, frame[3]!)]);
    const restartedClient = createClient(restartedTransport, {
      initialSequence: 0x40,
      clientTransactionId: 'transaction-next',
      outcomeLockStore,
    });
    await expect(restartedClient.synchronize()).rejects.toBeInstanceOf(
      DatecsCommandOutcomeUnknownError,
    );
    expect(restartedTransport.writes).toHaveLength(0);
  });

  it('does not mark a command successful when the printer rejects every retry', async () => {
    const transport = new ScriptedTransport((frame) =>
      frame[3] === STATUS_COMMAND ? [response(frame[2]!, frame[3])] : [new Uint8Array([0x15])],
    );
    const client = createClient(transport, { initialSequence: 0x50, maxAttempts: 2 });
    await client.synchronize();

    await expect(client.execute(0x48)).rejects.toBeInstanceOf(DatecsProtocolRejectedError);
    expect(client.isSynchronized).toBe(true);
  });

  it('retries a damaged response with the same sequence before accepting the device replay', async () => {
    let receiptAttempts = 0;
    const transport = new ScriptedTransport((frame) => {
      if (frame[3] === STATUS_COMMAND) return [response(frame[2]!, frame[3])];
      receiptAttempts += 1;
      if (receiptAttempts > 1) return [response(frame[2]!, frame[3]!)];
      const corrupt = response(frame[2]!, frame[3]!);
      corrupt[corrupt.length - 2] = corrupt[corrupt.length - 2]! ^ 1;
      return [corrupt];
    });
    const client = createClient(transport, {
      initialSequence: 0x55,
      maxAttempts: 2,
    });
    await client.synchronize();

    const result = await client.execute(0x48);
    expect(result.command).toBe(0x48);
    expect(transport.writes.at(-1)).toEqual(transport.writes.at(-2));
  });

  it('blocks when a valid frame does not confirm the outstanding command', async () => {
    const transport = new ScriptedTransport((frame) =>
      frame[3] === STATUS_COMMAND ? [response(frame[2]!, frame[3])] : [response(frame[2]!, 0x49)],
    );
    const client = createClient(transport, { initialSequence: 0x70 });
    await client.synchronize();

    await expect(client.execute(0x48)).rejects.toBeInstanceOf(DatecsCommandOutcomeUnknownError);
    await expect(client.execute(0x4c)).rejects.toBeInstanceOf(DatecsCommandOutcomeUnknownError);
  });

  it('serializes concurrent commands and assigns each a distinct sequence', async () => {
    const transport = new ScriptedTransport((frame) => [response(frame[2]!, frame[3]!)]);
    const client = createClient(transport, { initialSequence: 0x60 });
    await client.synchronize();

    const [first, second] = await Promise.all([client.execute(0x4c), client.execute(0x67)]);
    expect(first.command).toBe(0x4c);
    expect(second.command).toBe(0x67);
    expect(transport.writes.slice(-2).map((frame) => frame[2])).toEqual([0x61, 0x62]);
  });
});

class ScriptedTransport implements DatecsByteTransport {
  writes: Uint8Array[] = [];
  replyFactory: (frame: Uint8Array) => Uint8Array[];

  constructor(replyFactory: (frame: Uint8Array) => Uint8Array[]) {
    this.replyFactory = replyFactory;
  }

  write(frame: Uint8Array): Promise<void> {
    this.writes.push(frame.slice());
    this.replies.push(...this.replyFactory(frame));
    return Promise.resolve();
  }

  readMessage(timeoutMs: number): Promise<Uint8Array> {
    void timeoutMs;
    const reply = this.replies.shift();
    return reply ? Promise.resolve(reply) : Promise.reject(new DatecsResponseTimeoutError());
  }

  async close(): Promise<void> {}

  private readonly replies: Uint8Array[] = [];
}

class MemoryFiscalOutcomeLockStore implements FiscalOutcomeLockStore {
  private readonly outcomes = new Map<string, UnresolvedFiscalOutcome>();

  findUnresolved(registerId: string): Promise<UnresolvedFiscalOutcome | undefined> {
    return Promise.resolve(
      [...this.outcomes.values()].find(
        (outcome) => outcome.registerId === registerId && outcome.status === 'unresolved',
      ),
    );
  }

  async recordUnresolved(
    outcome: Omit<UnresolvedFiscalOutcome, 'id' | 'status' | 'review'>,
  ): Promise<void> {
    const existing = await this.findUnresolved(outcome.registerId);
    if (existing && existing.clientTransactionId !== outcome.clientTransactionId)
      throw new Error('Another fiscal outcome is already waiting for review.');
    this.outcomes.set(`${outcome.registerId}:${outcome.clientTransactionId}`, {
      ...outcome,
      id: `${outcome.registerId}:${outcome.clientTransactionId}`,
      status: 'unresolved',
    });
  }

  markReviewed(
    registerId: string,
    clientTransactionId: string,
    review: FiscalOutcomeReview,
  ): Promise<void> {
    const key = `${registerId}:${clientTransactionId}`;
    const outcome = this.outcomes.get(key);
    if (outcome) this.outcomes.set(key, { ...outcome, review, status: 'reviewed' });
    return Promise.resolve();
  }
}

let nextTransaction = 0;

function createClient(
  transport: DatecsByteTransport,
  options: Partial<DatecsCommandClientOptions> = {},
): DatecsCommandClient {
  const defaults: DatecsCommandClientOptions = {
    accountId: 'cashier-1',
    clientTransactionId: `transaction-${++nextTransaction}`,
    initialSequence: 0x40,
    outcomeLockStore: new MemoryFiscalOutcomeLockStore(),
    registerId: 'register-1',
  };
  return new DatecsCommandClient(transport, { ...defaults, ...options });
}

function response(sequence: number, command: number): Uint8Array {
  const status = new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x80]);
  const input = new Uint8Array([0x20 + 11, sequence, command, 0x04, ...status, 0x05]);
  const checksum = input.reduce((sum, byte) => (sum + byte) & 0xffff, 0);
  const checksumBytes = Uint8Array.from(
    [...checksum.toString(16).toUpperCase().padStart(4, '0')].map(
      (digit) => Number.parseInt(digit, 16) + 0x30,
    ),
  );
  return new Uint8Array([0x01, ...input, ...checksumBytes, 0x03]);
}
