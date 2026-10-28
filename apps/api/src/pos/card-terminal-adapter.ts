import { createHash } from 'node:crypto';

import { HttpStatus } from '@nestjs/common';

import { ApiErrorException } from '../common/api-error.exception.js';

export interface CardAuthorizationCommand {
  amountEur: string;
  cashRegisterId: string;
  idempotencyKey: string;
}

export type CardAuthorizationResult =
  | { adapter: string; providerReference: string; status: 'approved' }
  | { adapter: string; code: string; message: string; status: 'declined' }
  | { adapter: string; message: string; status: 'uncertain' };

export type CardAuthorizationLookup = CardAuthorizationResult | { status: 'not_found' };

export interface CardTerminalAdapter {
  authorize(command: CardAuthorizationCommand): Promise<CardAuthorizationResult>;
  /** Looks up a prior attempt without initiating a new payment. */
  reconcile(command: CardAuthorizationCommand): Promise<CardAuthorizationLookup>;
}

export const POS_CARD_TERMINAL_ADAPTER = Symbol('POS_CARD_TERMINAL_ADAPTER');

/**
 * Local-only test double. It has no connection to a bank or payment device.
 * The same key and request always return the same simulated result.
 */
export class DevelopmentCardTerminalSimulator implements CardTerminalAdapter {
  private readonly authorizations = new Map<
    string,
    { fingerprint: string; result: CardAuthorizationResult }
  >();

  authorize(command: CardAuthorizationCommand): Promise<CardAuthorizationResult> {
    const fingerprint = `${command.cashRegisterId}:${command.amountEur}`;
    const previous = this.authorizations.get(command.idempotencyKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        return Promise.reject(
          new ApiErrorException(
            'POS_CARD_IDEMPOTENCY_CONFLICT',
            'This card payment reference was already used for a different amount.',
            HttpStatus.CONFLICT,
          ),
        );
      return Promise.resolve(previous.result);
    }

    const reference = createHash('sha256')
      .update(command.idempotencyKey)
      .digest('hex')
      .slice(0, 24)
      .toUpperCase();
    const result: CardAuthorizationResult = {
      adapter: 'development-card-simulator',
      providerReference: `SIM-CARD-${reference}`,
      status: 'approved',
    };
    this.authorizations.set(command.idempotencyKey, { fingerprint, result });
    return Promise.resolve(result);
  }

  reconcile(command: CardAuthorizationCommand): Promise<CardAuthorizationLookup> {
    const fingerprint = `${command.cashRegisterId}:${command.amountEur}`;
    const previous = this.authorizations.get(command.idempotencyKey);
    if (previous && previous.fingerprint !== fingerprint)
      return Promise.reject(
        new ApiErrorException(
          'POS_CARD_IDEMPOTENCY_CONFLICT',
          'This card payment reference was already used for a different amount.',
          HttpStatus.CONFLICT,
        ),
      );
    return Promise.resolve(previous?.result ?? { status: 'not_found' });
  }
}

export async function requireApprovedCardAuthorization(
  adapter: CardTerminalAdapter,
  command: CardAuthorizationCommand,
): Promise<Extract<CardAuthorizationResult, { status: 'approved' }>> {
  const result = await adapter.authorize(command);
  if (result.status === 'approved') return result;
  if (result.status === 'declined')
    throw new ApiErrorException(
      'POS_CARD_PAYMENT_DECLINED',
      result.message || 'The card payment was declined. Use another payment method.',
      HttpStatus.CONFLICT,
    );
  throw new ApiErrorException(
    'POS_CARD_PAYMENT_OUTCOME_UNKNOWN',
    result.message ||
      'The card terminal response could not be confirmed. Check the terminal before retrying.',
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}
