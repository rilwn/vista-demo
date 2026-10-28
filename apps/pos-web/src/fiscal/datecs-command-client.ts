import {
  decodeDatecsMessage,
  encodeDatecsCommand,
  nextDatecsSequence,
  validateDatecsResponse,
  type DatecsFiscalResponse,
} from './datecs-protocol';
import { DatecsResponseTimeoutError, type DatecsByteTransport } from './datecs-transport';
import { IndexedDbFiscalOutcomeLockStore, type FiscalOutcomeLockStore } from '../offline-store';

const GET_PRINTER_STATUS = 0x4a;
const NAK = 0x15;
const SYN = 0x16;
const MIN_SEQUENCE = 0x20;
const SEQUENCE_COUNT = 0x60;

export interface DatecsCommandClientOptions {
  accountId: string;
  clientTransactionId: string;
  /** Starting point before a harmless status command aligns with the printer. */
  initialSequence?: number;
  outcomeLockStore: FiscalOutcomeLockStore;
  responseTimeoutMs?: number;
  maxAttempts?: number;
  maxCommandDurationMs?: number;
  registerId: string;
}

/**
 * Serializes DATECS commands and keeps one sequence for bounded retries. A
 * fresh client must synchronize before it can send any business command.
 */
export class DatecsCommandClient {
  private sequence: number;
  private synchronized = false;
  private outcomeUnknown = false;
  private lock: Promise<void> = Promise.resolve();

  private readonly responseTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly maxCommandDurationMs: number;
  private readonly identity: Pick<
    DatecsCommandClientOptions,
    'accountId' | 'clientTransactionId' | 'outcomeLockStore' | 'registerId'
  >;

  constructor(
    private readonly transport: DatecsByteTransport,
    options: DatecsCommandClientOptions,
  ) {
    this.identity = options;
    this.sequence = options.initialSequence ?? randomSequence();
    this.responseTimeoutMs = options.responseTimeoutMs ?? 500;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.maxCommandDurationMs = options.maxCommandDurationMs ?? 30_000;
    if (!Number.isInteger(this.sequence) || this.sequence < 0x20 || this.sequence > 0x7f)
      throw new RangeError('DATECS sequence must be between 0x20 and 0x7F.');
    if (!Number.isInteger(this.responseTimeoutMs) || this.responseTimeoutMs <= 0)
      throw new RangeError('DATECS response timeout must be a positive integer.');
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > 5)
      throw new RangeError('DATECS attempts must be between one and five.');
    if (!Number.isInteger(this.maxCommandDurationMs) || this.maxCommandDurationMs < 500)
      throw new RangeError('DATECS command duration must be at least 500 ms.');
  }

  async synchronize(): Promise<DatecsFiscalResponse> {
    return this.exclusive(async () => {
      const persistedOutcome = await this.identity.outcomeLockStore.findUnresolved(
        this.identity.registerId,
      );
      if (this.outcomeUnknown || persistedOutcome) {
        this.outcomeUnknown = true;
        throw new DatecsCommandOutcomeUnknownError(
          'A prior fiscal command has an unknown outcome. Review the printer status and last receipt before continuing.',
        );
      }
      this.synchronized = false;

      // A new browser session cannot assume which sequence the printer last
      // saw. Command 74 only reads status, so sequence collisions are harmless:
      // the printer repeats the prior reply and the client advances and probes
      // again until the response identifies this status command.
      for (let probe = 0; probe < SEQUENCE_COUNT; probe += 1) {
        const sequence = this.sequence;
        const reply = await this.exchange(sequence, GET_PRINTER_STATUS, new Uint8Array());
        if (reply.kind !== 'response')
          throw new DatecsProtocolRejectedError('The printer rejected the status query.');
        if (reply.value.sequence !== sequence) {
          throw new Error('DATECS status response has an unexpected sequence number.');
        }
        this.sequence = nextDatecsSequence(sequence);
        if (reply.value.command === GET_PRINTER_STATUS) {
          this.synchronized = true;
          return reply.value;
        }
      }

      throw new Error('Could not synchronize the DATECS command sequence.');
    });
  }

  async execute(
    command: number,
    data: Uint8Array = new Uint8Array(),
  ): Promise<DatecsFiscalResponse> {
    return this.exclusive(async () => {
      if (!this.synchronized)
        throw new Error('Connect and synchronize the DATECS printer before sending commands.');
      if (this.outcomeUnknown)
        throw new DatecsCommandOutcomeUnknownError(
          'The printer outcome is uncertain. Reconnect and review printer status before continuing.',
        );
      const persistedOutcome = await this.identity.outcomeLockStore.findUnresolved(
        this.identity.registerId,
      );
      if (persistedOutcome) {
        this.outcomeUnknown = true;
        throw new DatecsCommandOutcomeUnknownError(
          'A prior fiscal command is waiting for review. Do not issue another receipt.',
        );
      }

      const sequence = this.sequence;
      let reply: DatecsProtocolMessageSafe;
      try {
        reply = await this.exchange(sequence, command, data);
      } catch (error) {
        if (!(error instanceof DatecsProtocolRejectedError)) {
          await this.markOutcomeUnknown(command);
        }
        throw error;
      }

      if (reply.kind !== 'response') throw new DatecsProtocolRejectedError();
      try {
        validateDatecsResponse(reply.value, { command, sequence });
      } catch (error) {
        await this.markOutcomeUnknown(command);
        throw new DatecsCommandOutcomeUnknownError(
          'The printer reply did not confirm the requested command. Reconnect and review printer status before continuing.',
          error,
        );
      }

      this.sequence = nextDatecsSequence(sequence);
      return reply.value;
    });
  }

  get isSynchronized(): boolean {
    return this.synchronized && !this.outcomeUnknown;
  }

  /** Keep a register closed when a command was acknowledged but its meaning is unsafe. */
  async markOutcomeUnknown(commandCode: number): Promise<void> {
    this.outcomeUnknown = true;
    try {
      await this.identity.outcomeLockStore.recordUnresolved({
        accountId: this.identity.accountId,
        clientTransactionId: this.identity.clientTransactionId,
        commandCode,
        createdAt: new Date().toISOString(),
        registerId: this.identity.registerId,
      });
    } catch (error) {
      throw new DatecsOutcomeLockPersistenceError(error);
    }
  }

  private async exchange(
    sequence: number,
    command: number,
    data: Uint8Array,
  ): Promise<DatecsProtocolMessageSafe> {
    const frame = encodeDatecsCommand(sequence, command, data);
    let lastAttemptWasNak = false;

    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      lastAttemptWasNak = false;
      try {
        await this.transport.write(frame);
      } catch (error) {
        throw new DatecsCommandOutcomeUnknownError(
          'The command could not be confirmed after writing to the DATECS printer.',
          error,
        );
      }

      const deadline = Date.now() + this.maxCommandDurationMs;
      while (Date.now() < deadline) {
        let bytes: Uint8Array;
        try {
          bytes = await this.transport.readMessage(
            Math.min(this.responseTimeoutMs, deadline - Date.now()),
          );
        } catch (error) {
          if (error instanceof DatecsResponseTimeoutError) break;
          throw new DatecsCommandOutcomeUnknownError(
            'The DATECS connection ended before the command reply was confirmed.',
            error,
          );
        }

        if (bytes.byteLength === 1 && bytes[0] === SYN) continue;
        if (bytes.byteLength === 1 && bytes[0] === NAK) {
          lastAttemptWasNak = true;
          break;
        }

        try {
          const decoded = decodeDatecsMessage(bytes);
          if (decoded.kind === 'syn') continue;
          if (decoded.kind === 'nak') {
            lastAttemptWasNak = true;
            break;
          }
          return decoded;
        } catch {
          // Re-send the exact frame and sequence; the printer's duplicate
          // sequence rule returns the prior response instead of repeating it.
          break;
        }
      }
    }

    if (lastAttemptWasNak) throw new DatecsProtocolRejectedError();
    throw new DatecsCommandOutcomeUnknownError(
      'The DATECS printer did not confirm the command after bounded retries.',
    );
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export function createBrowserDatecsCommandClient(
  transport: DatecsByteTransport,
  identity: Pick<DatecsCommandClientOptions, 'accountId' | 'clientTransactionId' | 'registerId'>,
  options: Omit<
    DatecsCommandClientOptions,
    'accountId' | 'clientTransactionId' | 'outcomeLockStore' | 'registerId'
  > = {},
): DatecsCommandClient {
  return new DatecsCommandClient(transport, {
    ...identity,
    ...options,
    outcomeLockStore: new IndexedDbFiscalOutcomeLockStore(),
  });
}

type DatecsProtocolMessageSafe = ReturnType<typeof decodeDatecsMessage>;

export class DatecsProtocolRejectedError extends Error {
  constructor(message = 'The DATECS printer rejected the command frame.') {
    super(message);
    this.name = 'DatecsProtocolRejectedError';
  }
}

export class DatecsCommandOutcomeUnknownError extends Error {
  commandCode: number | undefined;

  constructor(message: string, options?: unknown, commandCode?: number) {
    super(message, options ? { cause: options } : undefined);
    this.name = 'DatecsCommandOutcomeUnknownError';
    this.commandCode = commandCode;
  }
}

export class DatecsOutcomeLockPersistenceError extends Error {
  constructor(options?: unknown) {
    super(
      'The printer response is uncertain and its recovery lock could not be saved. Stop cashier operations and contact an administrator.',
      options ? { cause: options } : undefined,
    );
    this.name = 'DatecsOutcomeLockPersistenceError';
  }
}

function randomSequence(): number {
  const bytes = new Uint8Array(1);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  return MIN_SEQUENCE + (bytes[0]! % SEQUENCE_COUNT);
}
