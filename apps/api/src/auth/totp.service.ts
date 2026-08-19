import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';

import { APP_ENVIRONMENT } from '../config/config.module.js';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const algorithm = 'aes-256-gcm';
const initializationVectorLength = 12;
const tagLength = 16;
const formatVersion = 1;

@Injectable()
export class TotpService {
  private readonly encryptionKey: Buffer;
  private readonly issuer: string;
  private readonly windowSteps: number;

  constructor(@Inject(APP_ENVIRONMENT) environment: AppEnvironment) {
    this.encryptionKey = createHash('sha256').update(environment.TOTP_ENCRYPTION_KEY).digest();
    this.issuer = environment.TOTP_ISSUER;
    this.windowSteps = environment.TOTP_WINDOW_STEPS;
  }

  generateSecret(): string {
    return encodeBase32(randomBytes(20));
  }

  createEnrollmentUri(accountName: string, secret: string): string {
    const label = encodeURIComponent(`${this.issuer}:${accountName}`);
    const parameters = new URLSearchParams({
      algorithm: 'SHA1',
      digits: '6',
      issuer: this.issuer,
      period: '30',
      secret,
    });
    return `otpauth://totp/${label}?${parameters.toString()}`;
  }

  encryptSecret(secret: string): Buffer {
    decodeBase32(secret);
    return this.encryptValue(secret);
  }

  decryptSecret(value: Buffer): string {
    const secret = this.decryptValue(value);
    decodeBase32(secret);
    return secret;
  }

  encryptValue(value: string): Buffer {
    const initializationVector = randomBytes(initializationVectorLength);
    const cipher = createCipheriv(algorithm, this.encryptionKey, initializationVector);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([
      Buffer.from([formatVersion]),
      initializationVector,
      cipher.getAuthTag(),
      encrypted,
    ]);
  }

  decryptValue(value: Buffer): string {
    if (value.length <= 1 + initializationVectorLength + tagLength || value[0] !== formatVersion) {
      throw new Error('Unsupported encrypted TOTP secret format');
    }
    const initializationVector = value.subarray(1, 1 + initializationVectorLength);
    const tag = value.subarray(
      1 + initializationVectorLength,
      1 + initializationVectorLength + tagLength,
    );
    const encrypted = value.subarray(1 + initializationVectorLength + tagLength);
    const decipher = createDecipheriv(algorithm, this.encryptionKey, initializationVector);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  verify(code: string, encryptedSecret: Buffer, now = new Date()): boolean {
    if (!/^\d{6}$/u.test(code)) {
      return false;
    }
    const secret = this.decryptSecret(encryptedSecret);
    const counter = Math.floor(now.getTime() / 30_000);
    for (let offset = -this.windowSteps; offset <= this.windowSteps; offset += 1) {
      const expected = generateTotp(secret, counter + offset);
      if (timingSafeEqual(Buffer.from(code), Buffer.from(expected))) {
        return true;
      }
    }
    return false;
  }

  generateCode(secret: string, now = new Date()): string {
    return generateTotp(secret, Math.floor(now.getTime() / 30_000));
  }
}

function generateTotp(secret: string, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const binary =
    ((digest[offset] ?? 0) & 0x7f) * 0x1000000 +
    (digest[offset + 1] ?? 0) * 0x10000 +
    (digest[offset + 2] ?? 0) * 0x100 +
    (digest[offset + 3] ?? 0);
  return String(binary % 1_000_000).padStart(6, '0');
}

function encodeBase32(value: Buffer): string {
  let bits = '';
  for (const byte of value) {
    bits += byte.toString(2).padStart(8, '0');
  }
  let output = '';
  for (let index = 0; index < bits.length; index += 5) {
    const segment = bits.slice(index, index + 5).padEnd(5, '0');
    output += alphabet[Number.parseInt(segment, 2)];
  }
  return output;
}

function decodeBase32(value: string): Buffer {
  const normalized = value.toUpperCase().replace(/=+$/u, '');
  if (!/^[A-Z2-7]+$/u.test(normalized)) {
    throw new Error('Invalid base32 TOTP secret');
  }
  let bits = '';
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}
