const STX = 0x01;
const ETX = 0x03;
const NAK = 0x15;
const SYN = 0x16;
const DATA_SEPARATOR = 0x04;
const POSTAMBLE = 0x05;
const MIN_SEQUENCE = 0x20;
const MAX_SEQUENCE = 0x7f;
const MAX_COMMAND_DATA = 218;
const MAX_RESPONSE_DATA = 213;

// DATECS FP-2000 programming interface, version 3.00BG.
export interface DatecsFiscalResponse {
  command: number;
  data: Uint8Array;
  sequence: number;
  status: Uint8Array;
}

export type DatecsProtocolMessage =
  { kind: 'nak' } | { kind: 'syn' } | { kind: 'response'; value: DatecsFiscalResponse };

/**
 * Creates a DATECS FP-2000 command frame. Command data is kept as bytes so
 * caller-specific Bulgarian character encoding remains explicit.
 */
export function encodeDatecsCommand(
  sequence: number,
  command: number,
  data: Uint8Array = new Uint8Array(),
): Uint8Array {
  validateSequence(sequence);
  if (!Number.isInteger(command) || command < 0x20 || command > 0xff)
    throw new RangeError('DATECS command must be between 0x20 and 0xFF.');
  if (data.byteLength > MAX_COMMAND_DATA)
    throw new RangeError(`DATECS command data cannot exceed ${MAX_COMMAND_DATA} bytes.`);
  for (const byte of data) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a)
      throw new RangeError('DATECS command data contains an unsupported control byte.');
  }

  const length = 0x20 + data.byteLength + 4;
  const checksumInput = new Uint8Array([length, sequence, command, ...data, POSTAMBLE]);
  const checksum = checksumInput.reduce((sum, byte) => (sum + byte) & 0xffff, 0);
  const checksumBytes = encodeChecksum(checksum);
  return new Uint8Array([STX, ...checksumInput, ...checksumBytes, ETX]);
}

/**
 * Decodes one complete DATECS response frame or the documented single-byte
 * NAK/SYN control messages. Framing, command and checksum errors fail closed.
 */
export function decodeDatecsMessage(frame: Uint8Array): DatecsProtocolMessage {
  if (frame.byteLength === 1 && frame[0] === NAK) return { kind: 'nak' };
  if (frame.byteLength === 1 && frame[0] === SYN) return { kind: 'syn' };
  if (frame.byteLength < 17 || frame[0] !== STX || frame.at(-1) !== ETX)
    throw new Error('DATECS response has an invalid frame boundary.');

  const declaredLength = frame[1]!;
  const postambleIndex = declaredLength - 0x20;
  if (
    postambleIndex < 11 ||
    postambleIndex + 6 !== frame.byteLength ||
    frame[postambleIndex] !== POSTAMBLE
  )
    throw new Error('DATECS response has an invalid length or postamble.');

  const statusEnd = postambleIndex - 1;
  const statusStart = statusEnd - 5;
  const separatorIndex = statusStart - 1;
  if (frame[separatorIndex] !== DATA_SEPARATOR)
    throw new Error('DATECS response is missing its status separator.');
  const status = frame.slice(statusStart, statusEnd + 1);
  if (status.some((byte) => byte < 0x80))
    throw new Error('DATECS response contains an invalid status byte.');
  validateSequence(frame[2]!);
  if (frame[3]! < 0x20) throw new Error('DATECS response contains an invalid command byte.');
  const data = frame.slice(4, separatorIndex);
  if (data.byteLength > MAX_RESPONSE_DATA)
    throw new Error(`DATECS response data cannot exceed ${MAX_RESPONSE_DATA} bytes.`);
  for (const byte of data) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a)
      throw new Error('DATECS response data contains an unsupported control byte.');
  }

  const receivedChecksum = decodeChecksum(frame.slice(postambleIndex + 1, postambleIndex + 5));
  const calculatedChecksum = frame
    .slice(1, postambleIndex + 1)
    .reduce((sum, byte) => (sum + byte) & 0xffff, 0);
  if (receivedChecksum !== calculatedChecksum)
    throw new Error('DATECS response checksum does not match.');

  return {
    kind: 'response',
    value: {
      sequence: frame[2]!,
      command: frame[3]!,
      data,
      status,
    },
  };
}

export function nextDatecsSequence(sequence: number): number {
  validateSequence(sequence);
  return sequence === MAX_SEQUENCE ? MIN_SEQUENCE : sequence + 1;
}

export function validateDatecsResponse(
  response: DatecsFiscalResponse,
  expected: { command: number; sequence: number },
): void {
  if (response.command !== expected.command || response.sequence !== expected.sequence)
    throw new Error('DATECS response does not match the outstanding command.');
  if (response.data.byteLength > MAX_RESPONSE_DATA)
    throw new Error(`DATECS response data cannot exceed ${MAX_RESPONSE_DATA} bytes.`);
}

function validateSequence(sequence: number): void {
  if (!Number.isInteger(sequence) || sequence < MIN_SEQUENCE || sequence > MAX_SEQUENCE)
    throw new RangeError('DATECS sequence must be between 0x20 and 0x7F.');
}

function encodeChecksum(checksum: number): Uint8Array {
  const hex = checksum.toString(16).toUpperCase().padStart(4, '0');
  return Uint8Array.from([...hex].map((digit) => Number.parseInt(digit, 16) + 0x30));
}

function decodeChecksum(bytes: Uint8Array): number {
  if (bytes.byteLength !== 4 || bytes.some((byte) => byte < 0x30 || byte > 0x3f))
    throw new Error('DATECS response checksum is malformed.');
  const hex = String.fromCharCode(...bytes)
    .split('')
    .map((digit) => digit.charCodeAt(0) - 0x30);
  return hex.reduce((value, digit) => (value << 4) | digit, 0);
}
