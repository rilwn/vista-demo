import { describe, expect, it } from 'vitest';
import {
  decodeDatecsMessage,
  encodeDatecsCommand,
  nextDatecsSequence,
  validateDatecsResponse,
} from './datecs-protocol';

describe('DATECS FP-2000 fiscal-printer protocol', () => {
  it('frames a command with the required length and checksum encoding', () => {
    const command = encodeDatecsCommand(0x20, 0x30, new TextEncoder().encode('1,000000,123'));

    expect([...command.slice(0, 4)]).toEqual([0x01, 0x30, 0x20, 0x30]);
    expect(command[command.length - 6]).toBe(0x05);
    expect(command[command.length - 1]).toBe(0x03);
    expect(validChecksum(command)).toBe(true);
  });

  it('decodes a packed response and preserves command data and device status bytes', () => {
    const frame = packedResponse(0x26, 0x38, new TextEncoder().encode('4,3'));
    const decoded = decodeDatecsMessage(frame);

    expect(decoded.kind).toBe('response');
    if (decoded.kind !== 'response') throw new Error('Expected a packed response.');
    expect(decoded.value.sequence).toBe(0x26);
    expect(decoded.value.command).toBe(0x38);
    expect(new TextDecoder().decode(decoded.value.data)).toBe('4,3');
    expect([...decoded.value.status]).toEqual([0x80, 0x80, 0x80, 0x80, 0x80, 0x80]);
    expect(() =>
      validateDatecsResponse(decoded.value, { command: 0x38, sequence: 0x26 }),
    ).not.toThrow();
  });

  it('recognizes the documented NAK and SYN one-byte messages', () => {
    expect(decodeDatecsMessage(new Uint8Array([0x15]))).toEqual({ kind: 'nak' });
    expect(decodeDatecsMessage(new Uint8Array([0x16]))).toEqual({ kind: 'syn' });
  });

  it('allows protocol separators but rejects unsupported control bytes and overlong commands', () => {
    expect(() => encodeDatecsCommand(0x20, 0x31, new Uint8Array([0x09, 0x0a]))).not.toThrow();
    expect(() => encodeDatecsCommand(0x20, 0x31, new Uint8Array([0x00]))).toThrow(
      'unsupported control byte',
    );
    expect(() => encodeDatecsCommand(0x20, 0x31, new Uint8Array(219).fill(0x41))).toThrow(
      'cannot exceed 218 bytes',
    );
  });

  it('rejects corrupt framing, lengths, status and checksum instead of accepting uncertain fiscal evidence', () => {
    const valid = packedResponse(0x20, 0x38, new Uint8Array());
    const badChecksum = valid.slice();
    badChecksum[badChecksum.length - 2] = badChecksum[badChecksum.length - 2]! ^ 1;
    const badStatus = valid.slice();
    badStatus[valid.length - 8] = 0x7f;
    const badLength = valid.slice();
    badLength[1] = badLength[1]! + 1;

    expect(() => decodeDatecsMessage(new Uint8Array([0x02, ...valid.slice(1)]))).toThrow(
      'frame boundary',
    );
    expect(() => decodeDatecsMessage(badChecksum)).toThrow('checksum');
    expect(() => decodeDatecsMessage(badStatus)).toThrow('status');
    expect(() => decodeDatecsMessage(badLength)).toThrow('length');
  });

  it('rejects a reply for another command or sequence and wraps sequence values safely', () => {
    const decoded = decodeDatecsMessage(packedResponse(0x20, 0x38, new Uint8Array()));
    if (decoded.kind !== 'response') throw new Error('Expected a packed response.');

    expect(() => validateDatecsResponse(decoded.value, { command: 0x39, sequence: 0x20 })).toThrow(
      'does not match',
    );
    expect(() => validateDatecsResponse(decoded.value, { command: 0x38, sequence: 0x21 })).toThrow(
      'does not match',
    );
    expect(nextDatecsSequence(0x7f)).toBe(0x20);
    expect(nextDatecsSequence(0x20)).toBe(0x21);
    expect(() => nextDatecsSequence(0x1f)).toThrow('between 0x20 and 0x7F');
  });
});

function packedResponse(sequence: number, command: number, data: Uint8Array): Uint8Array {
  const status = new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x80]);
  const length = 0x20 + data.byteLength + 11;
  const checksumInput = new Uint8Array([length, sequence, command, ...data, 0x04, ...status, 0x05]);
  const checksum = checksumInput.reduce((sum, byte) => (sum + byte) & 0xffff, 0);
  const checksumBytes = Uint8Array.from(
    [...checksum.toString(16).toUpperCase().padStart(4, '0')].map(
      (digit) => Number.parseInt(digit, 16) + 0x30,
    ),
  );
  return new Uint8Array([0x01, ...checksumInput, ...checksumBytes, 0x03]);
}

function validChecksum(frame: Uint8Array): boolean {
  const postambleIndex = frame.indexOf(0x05, 4);
  const checksumBytes = frame.slice(postambleIndex + 1, postambleIndex + 5);
  const received = [...checksumBytes].reduce((sum, byte) => (sum << 4) | (byte - 0x30), 0);
  const expected = frame
    .slice(1, postambleIndex + 1)
    .reduce((sum, byte) => (sum + byte) & 0xffff, 0);
  return received === expected;
}
