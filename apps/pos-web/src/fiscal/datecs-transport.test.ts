import { describe, expect, it } from 'vitest';
import {
  requestDatecsSerialTransport,
  WebSerialDatecsTransport,
  type DatecsSerialOpenOptions,
  type DatecsSerialPortLike,
} from './datecs-transport';

describe('DATECS Web Serial transport', () => {
  it('opens an 8N1 serial port and reconstructs a fragmented frame after discarding line noise', async () => {
    const port = new FakeSerialPort();
    const transport = new WebSerialDatecsTransport(port);
    await transport.open();
    port.onWrite = () => {
      const frame = response(0x20, 0x4a);
      port.emit(new Uint8Array([0xff, ...frame.slice(0, 5)]));
      port.emit(frame.slice(5));
    };

    await transport.write(new Uint8Array([0x01, 0x02]));
    const frame = await transport.readMessage(100);

    expect(port.openOptions).toEqual({
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      bufferSize: 4096,
    });
    expect([...frame]).toEqual([...response(0x20, 0x4a)]);
    await transport.close();
    expect(port.closed).toBe(true);
  });

  it('keeps single-byte NAK and SYN control messages distinct from packed frames', async () => {
    const port = new FakeSerialPort();
    const transport = new WebSerialDatecsTransport(port);
    await transport.open();
    port.emit(new Uint8Array([0x15, 0x16, ...response(0x21, 0x4a)]));

    expect([...(await transport.readMessage(100))]).toEqual([0x15]);
    expect([...(await transport.readMessage(100))]).toEqual([0x16]);
    expect([...(await transport.readMessage(100))]).toEqual([...response(0x21, 0x4a)]);
    await transport.close();
  });

  it('times out a waiting read without stopping the continuous serial reader', async () => {
    const port = new FakeSerialPort();
    const transport = new WebSerialDatecsTransport(port);
    await transport.open();

    await expect(transport.readMessage(1)).rejects.toThrow('did not respond before the timeout');
    port.emit(response(0x22, 0x4a));
    expect([...(await transport.readMessage(100))]).toEqual([...response(0x22, 0x4a)]);
    await transport.close();
  });

  it('requests the port at connection time and closes it if opening fails', async () => {
    const port = new FakeSerialPort();
    let requests = 0;
    const transport = await requestDatecsSerialTransport({
      requestPort: () => {
        requests += 1;
        return Promise.resolve(port);
      },
    });

    expect(requests).toBe(1);
    expect(port.openOptions?.baudRate).toBe(9600);
    await transport.close();

    await expect(requestDatecsSerialTransport(undefined)).rejects.toThrow(
      'does not support USB serial',
    );
  });
});

class FakeSerialPort implements DatecsSerialPortLike {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  openOptions: DatecsSerialOpenOptions | undefined;
  onWrite: ((frame: Uint8Array) => void) | undefined;
  closed = false;

  private controller: ReadableStreamDefaultController<Uint8Array> | undefined;

  constructor() {
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: (frame) => this.onWrite?.(frame.slice()),
    });
  }

  open(options: DatecsSerialOpenOptions): Promise<void> {
    this.openOptions = options;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  emit(bytes: Uint8Array): void {
    this.controller?.enqueue(bytes);
  }
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
