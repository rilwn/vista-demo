import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { validatePasswordPolicy, type PasswordPolicy } from '@vista/auth';
import type { AppEnvironment } from '@vista/config';

import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';

const keyLength = 32;
const scryptCost = 32_768;
const scryptBlockSize = 8;
const scryptParallelization = 1;
const scryptMaxMemory = 64 * 1024 * 1024;

@Injectable()
export class PasswordService {
  private readonly expiryDays: number;
  private readonly policy: PasswordPolicy;

  constructor(@Inject(APP_ENVIRONMENT) environment: AppEnvironment) {
    this.expiryDays = environment.PASSWORD_EXPIRY_DAYS;
    this.policy = {
      minimumLength: environment.PASSWORD_MIN_LENGTH,
      requireLowercase: environment.PASSWORD_REQUIRE_LOWERCASE,
      requireNumber: environment.PASSWORD_REQUIRE_NUMBER,
      requireSymbol: environment.PASSWORD_REQUIRE_SYMBOL,
      requireUppercase: environment.PASSWORD_REQUIRE_UPPERCASE,
    };
  }

  async hash(password: string): Promise<string> {
    this.assertPolicy(password);
    const salt = randomBytes(16);
    const derivedKey = await deriveKey(password, salt, {
      blockSize: scryptBlockSize,
      cost: scryptCost,
      parallelization: scryptParallelization,
    });
    return [
      'scrypt',
      'v1',
      String(scryptCost),
      String(scryptBlockSize),
      String(scryptParallelization),
      salt.toString('base64url'),
      derivedKey.toString('base64url'),
    ].join('$');
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    const parsed = parseHash(encodedHash);
    if (!parsed) {
      await deriveKey(password, Buffer.alloc(16), {
        blockSize: scryptBlockSize,
        cost: scryptCost,
        parallelization: scryptParallelization,
      });
      return false;
    }

    const derivedKey = await deriveKey(password, parsed.salt, parsed);
    return derivedKey.length === parsed.hash.length && timingSafeEqual(derivedKey, parsed.hash);
  }

  passwordExpiresAt(changedAt = new Date()): Date | undefined {
    if (this.expiryDays === 0) {
      return undefined;
    }
    return new Date(changedAt.getTime() + this.expiryDays * 86_400_000);
  }

  private assertPolicy(password: string): void {
    if (password.length > 128) {
      throw new ApiErrorException(
        'PASSWORD_POLICY_VIOLATION',
        'Password does not satisfy the configured policy',
        HttpStatus.BAD_REQUEST,
        [{ field: 'password', message: 'Password must not exceed 128 characters' }],
      );
    }
    const violations = validatePasswordPolicy(password, this.policy);
    if (violations.length > 0) {
      throw new ApiErrorException(
        'PASSWORD_POLICY_VIOLATION',
        'Password does not satisfy the configured policy',
        HttpStatus.BAD_REQUEST,
        violations.map(({ message }) => ({ field: 'password', message })),
      );
    }
  }
}

interface ScryptParameters {
  blockSize: number;
  cost: number;
  parallelization: number;
}

interface ParsedHash extends ScryptParameters {
  hash: Buffer;
  salt: Buffer;
}

function deriveKey(password: string, salt: Buffer, parameters: ScryptParameters): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keyLength,
      {
        maxmem: scryptMaxMemory,
        N: parameters.cost,
        p: parameters.parallelization,
        r: parameters.blockSize,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

function parseHash(encodedHash: string): ParsedHash | undefined {
  const [algorithm, version, cost, blockSize, parallelization, salt, hash, ...rest] =
    encodedHash.split('$');
  if (
    algorithm !== 'scrypt' ||
    version !== 'v1' ||
    rest.length > 0 ||
    !cost ||
    !blockSize ||
    !parallelization ||
    !salt ||
    !hash
  ) {
    return undefined;
  }

  const parameters = {
    blockSize: Number(blockSize),
    cost: Number(cost),
    parallelization: Number(parallelization),
  };
  if (
    parameters.cost !== scryptCost ||
    parameters.blockSize !== scryptBlockSize ||
    parameters.parallelization !== scryptParallelization
  ) {
    return undefined;
  }

  try {
    const parsedSalt = Buffer.from(salt, 'base64url');
    const parsedHash = Buffer.from(hash, 'base64url');
    if (parsedSalt.length !== 16 || parsedHash.length !== keyLength) {
      return undefined;
    }
    return { ...parameters, hash: parsedHash, salt: parsedSalt };
  } catch {
    return undefined;
  }
}
