export interface DatecsSerialPortLike {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: DatecsSerialOpenOptions): Promise<void>;
  close(): Promise<void>;
}

export interface DatecsSerialProvider {
  requestPort(): Promise<DatecsSerialPortLike>;
}

export interface DatecsSerialOpenOptions {
  baudRate: number;
  dataBits: 8;
  stopBits: 1;
  parity: 'none';
  bufferSize: number;
}

export interface DatecsByteTransport {
  write(frame: Uint8Array): Promise<void>;
  readMessage(timeoutMs: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

interface MessageWaiter {
  resolve(message: Uint8Array): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const STX = 0x01;
const ETX = 0x03;
const NAK = 0x15;
const SYN = 0x16;
const MIN_FRAME_LENGTH = 17;
const MAX_FRAME_LENGTH = 229;

/**
 * Web Serial transport for a DATECS FP-2000 attached through a USB serial
 * interface. The caller must request the port from a direct user gesture.
 */
export class WebSerialDatecsTransport implements DatecsByteTransport {
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  private writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  private readBuffer = new Uint8Array();
  private readonly messages: Uint8Array[] = [];
  private readonly waiters: MessageWaiter[] = [];
  private readFailure: Error | undefined;
  private readLoop: Promise<void> | undefined;
  private opened = false;
  private closed = false;

  constructor(
    private readonly port: DatecsSerialPortLike,
    private readonly options: { baudRate?: number; bufferSize?: number } = {},
  ) {}

  async open(): Promise<void> {
    if (this.opened) return;
    if (this.closed) throw new Error('The DATECS serial connection is closed.');

    await this.port.open({
      baudRate: this.options.baudRate ?? 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      bufferSize: this.options.bufferSize ?? 4096,
    });

    if (!this.port.readable || !this.port.writable) {
      await this.port.close().catch(() => undefined);
      throw new Error('The selected serial port does not provide readable and writable streams.');
    }

    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    this.opened = true;
    this.readLoop = this.pumpMessages();
  }

  async write(frame: Uint8Array): Promise<void> {
    if (!this.opened || !this.writer || this.closed)
      throw new Error('The DATECS serial connection is not open.');
    await this.writer.write(frame.slice());
  }

  readMessage(timeoutMs: number): Promise<Uint8Array> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      return Promise.reject(new RangeError('The DATECS response timeout must be positive.'));
    const queued = this.messages.shift();
    if (queued) return Promise.resolve(queued);
    if (this.readFailure) return Promise.reject(this.readFailure);
    if (!this.opened || this.closed)
      return Promise.reject(new Error('The DATECS serial connection is not open.'));

    return new Promise<Uint8Array>((resolve, reject) => {
      const waiter: MessageWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.removeWaiter(waiter);
          reject(new DatecsResponseTimeoutError());
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.rejectWaiters(new Error('The DATECS serial connection was closed.'));

    await this.reader?.cancel().catch(() => undefined);
    await this.writer?.close().catch(() => undefined);
    this.reader?.releaseLock();
    this.writer?.releaseLock();
    this.reader = undefined;
    this.writer = undefined;

    if (this.opened) await this.port.close().catch(() => undefined);
    this.opened = false;
    await this.readLoop?.catch(() => undefined);
  }

  private async pumpMessages(): Promise<void> {
    const reader = this.reader;
    if (!reader) return;

    try {
      while (!this.closed) {
        const result = await reader.read();
        if (result.done) {
          if (!this.closed) throw new Error('The DATECS serial device disconnected.');
          return;
        }
        if (result.value?.byteLength) this.appendBytes(result.value);
      }
    } catch (cause) {
      if (this.closed) return;
      const error = cause instanceof Error ? cause : new Error('The DATECS serial device failed.');
      this.readFailure = error;
      this.rejectWaiters(error);
    }
  }

  private appendBytes(bytes: Uint8Array): void {
    const merged = new Uint8Array(this.readBuffer.byteLength + bytes.byteLength);
    merged.set(this.readBuffer);
    merged.set(bytes, this.readBuffer.byteLength);
    this.readBuffer = merged;

    while (this.readBuffer.byteLength) {
      const start = this.readBuffer.findIndex(
        (byte) => byte === STX || byte === NAK || byte === SYN,
      );
      if (start < 0) {
        this.readBuffer = new Uint8Array();
        return;
      }
      if (start > 0) this.readBuffer = this.readBuffer.slice(start);

      const firstByte = this.readBuffer[0]!;
      if (firstByte === NAK || firstByte === SYN) {
        this.deliver(this.readBuffer.slice(0, 1));
        this.readBuffer = this.readBuffer.slice(1);
        continue;
      }

      if (this.readBuffer.byteLength < 2) return;
      const declaredLength = this.readBuffer[1]!;
      const frameLength = declaredLength - 0x20 + 6;
      if (
        declaredLength < 0x20 ||
        frameLength < MIN_FRAME_LENGTH ||
        frameLength > MAX_FRAME_LENGTH
      ) {
        this.readBuffer = this.readBuffer.slice(1);
        continue;
      }
      if (this.readBuffer.byteLength < frameLength) return;

      const message = this.readBuffer.slice(0, frameLength);
      this.readBuffer = this.readBuffer.slice(frameLength);
      if (message.at(-1) === ETX) this.deliver(message);
    }
  }

  private deliver(message: Uint8Array): void {
    const waiter = this.waiters.shift();
    if (!waiter) {
      this.messages.push(message);
      return;
    }
    clearTimeout(waiter.timer);
    waiter.resolve(message);
  }

  private rejectWaiters(error: Error): void {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  private removeWaiter(waiter: MessageWaiter): void {
    const index = this.waiters.indexOf(waiter);
    if (index >= 0) this.waiters.splice(index, 1);
  }
}

export class DatecsResponseTimeoutError extends Error {
  constructor() {
    super('The DATECS printer did not respond before the timeout.');
    this.name = 'DatecsResponseTimeoutError';
  }
}

export function browserDatecsSerialProvider(): DatecsSerialProvider | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { serial?: DatecsSerialProvider }).serial;
}

/** Call from a cashier's explicit Connect action so the browser can show its port picker. */
export async function requestDatecsSerialTransport(
  provider: DatecsSerialProvider | undefined = browserDatecsSerialProvider(),
  options: { baudRate?: number; bufferSize?: number } = {},
): Promise<WebSerialDatecsTransport> {
  if (!provider) throw new Error('This browser does not support USB serial connections.');
  const transport = new WebSerialDatecsTransport(await provider.requestPort(), options);
  try {
    await transport.open();
    return transport;
  } catch (error) {
    await transport.close();
    throw error;
  }
}
