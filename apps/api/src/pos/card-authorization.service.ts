import { randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import type { CardAuthorizationCommand, CardAuthorizationResult } from './card-terminal-adapter.js';
import { POS_CARD_TERMINAL_ADAPTER, type CardTerminalAdapter } from './card-terminal-adapter.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { DatabaseService } from '../database/database.service.js';

export interface CardAuthorizationContext {
  cashierAccountId: string;
  clientTransactionId: string;
  shiftId: string;
}

interface CardAuthorizationAttemptRow {
  adapter: string;
  amount_eur: string;
  cashier_account_id: string;
  cash_register_id: string;
  client_transaction_id: string;
  id: string;
  provider_reference: string | null;
  response_code: string | null;
  shift_id: string;
  status: 'approved' | 'authorizing' | 'declined' | 'uncertain';
}

interface CardAuthorizationAttemptState {
  attempt: CardAuthorizationAttemptRow;
  created: boolean;
}

@Injectable()
export class CardAuthorizationService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(POS_CARD_TERMINAL_ADAPTER) private readonly adapter: CardTerminalAdapter,
  ) {}

  async authorize(
    command: CardAuthorizationCommand,
    context: CardAuthorizationContext,
  ): Promise<Extract<CardAuthorizationResult, { status: 'approved' }>> {
    const expectedKey = `pos-sale:${context.clientTransactionId}:card`;
    if (command.idempotencyKey !== expectedKey)
      throw new ApiErrorException(
        'POS_CARD_IDEMPOTENCY_CONFLICT',
        'This card payment reference does not match its sale.',
        HttpStatus.CONFLICT,
      );

    const client = await this.database.getPool().connect();
    let lockHeld = false;
    try {
      await client.query('SELECT pg_advisory_lock(hashtextextended($1::text, 0::bigint))', [
        command.idempotencyKey,
      ]);
      lockHeld = true;

      const { attempt, created } = await this.beginOrReadAttempt(client, command, context);
      if (attempt.status === 'approved' || attempt.status === 'declined')
        return this.approvedOrDeclined(attempt);

      if (!created) {
        const lookup = await this.lookupPreviousAttempt(client, command, attempt);
        if (lookup) return lookup;
        await this.markAuthorizing(client, attempt, command, context);
      }

      let result: CardAuthorizationResult;
      try {
        result = await this.adapter.authorize(command);
      } catch {
        await this.saveOutcome(client, attempt.id, {
          adapter: attempt.adapter === 'pending' ? 'card-terminal' : attempt.adapter,
          code: 'ADAPTER_ERROR',
          eventType: 'authorization_uncertain',
          status: 'uncertain',
        });
        throw this.outcomeUnknown();
      }
      const outcome = outcomeFor(result);
      await this.saveOutcome(client, attempt.id, outcome);
      if (outcome.status === 'uncertain') throw this.outcomeUnknown();
      return this.approvedOrDeclined({
        ...attempt,
        adapter: outcome.adapter,
        provider_reference: 'providerReference' in outcome ? outcome.providerReference : null,
        response_code: 'code' in outcome ? outcome.code : null,
        status: outcome.status,
      });
    } finally {
      try {
        if (lockHeld)
          await client.query('SELECT pg_advisory_unlock(hashtextextended($1::text, 0::bigint))', [
            command.idempotencyKey,
          ]);
      } finally {
        client.release();
      }
    }
  }

  private async beginOrReadAttempt(
    client: PoolClient,
    command: CardAuthorizationCommand,
    context: CardAuthorizationContext,
  ): Promise<CardAuthorizationAttemptState> {
    const id = randomUUID();
    await client.query('BEGIN');
    try {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO pos.card_authorization_attempts (
           id, idempotency_key, client_transaction_id, shift_id, cash_register_id,
           cashier_account_id, amount_eur, status, adapter, attempt_count
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'authorizing','pending',1)
         ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
        [
          id,
          command.idempotencyKey,
          context.clientTransactionId,
          context.shiftId,
          command.cashRegisterId,
          context.cashierAccountId,
          command.amountEur,
        ],
      );
      const row = await client.query<CardAuthorizationAttemptRow>(
        `SELECT id, amount_eur::text, cashier_account_id, cash_register_id,
           client_transaction_id, shift_id, status, adapter, provider_reference, response_code
         FROM pos.card_authorization_attempts WHERE idempotency_key = $1 FOR UPDATE`,
        [command.idempotencyKey],
      );
      const attempt = row.rows[0];
      if (!attempt) throw new Error('Card authorization attempt was not stored.');
      if (
        attempt.cashier_account_id !== context.cashierAccountId ||
        attempt.client_transaction_id !== context.clientTransactionId ||
        attempt.shift_id !== context.shiftId ||
        attempt.cash_register_id !== command.cashRegisterId ||
        canonicalAmount(attempt.amount_eur) !== canonicalAmount(command.amountEur)
      )
        throw new ApiErrorException(
          'POS_CARD_IDEMPOTENCY_CONFLICT',
          'This card payment reference was already used for a different sale or amount.',
          HttpStatus.CONFLICT,
        );
      if (inserted.rowCount)
        await this.recordEvent(
          client,
          attempt.id,
          context.cashierAccountId,
          'authorization_started',
          {
            attempt: 1,
          },
        );
      await client.query('COMMIT');
      return { attempt, created: Boolean(inserted.rowCount) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  private async lookupPreviousAttempt(
    client: PoolClient,
    command: CardAuthorizationCommand,
    attempt: CardAuthorizationAttemptRow,
  ): Promise<Extract<CardAuthorizationResult, { status: 'approved' }> | undefined> {
    let lookup;
    try {
      lookup = await this.adapter.reconcile(command);
    } catch {
      await this.saveOutcome(client, attempt.id, {
        adapter: attempt.adapter,
        code: 'RECONCILIATION_ERROR',
        eventType: 'authorization_uncertain',
        status: 'uncertain',
      });
      throw this.outcomeUnknown();
    }
    if (lookup.status === 'not_found') return undefined;
    const outcome = outcomeFor(lookup);
    await this.saveOutcome(client, attempt.id, outcome);
    if (lookup.status === 'uncertain') throw this.outcomeUnknown();
    return this.approvedOrDeclined({
      ...attempt,
      adapter: outcome.adapter,
      provider_reference: 'providerReference' in outcome ? outcome.providerReference : null,
      response_code: 'code' in outcome ? outcome.code : null,
      status: outcome.status,
    });
  }

  private async markAuthorizing(
    client: PoolClient,
    attempt: CardAuthorizationAttemptRow,
    command: CardAuthorizationCommand,
    context: CardAuthorizationContext,
  ): Promise<void> {
    await client.query('BEGIN');
    try {
      const result = await client.query<{ attempt_count: number }>(
        `UPDATE pos.card_authorization_attempts
         SET status = 'authorizing', attempt_count = attempt_count + 1,
             response_code = NULL, updated_at = now()
         WHERE id = $1 AND status IN ('authorizing', 'uncertain')
         RETURNING attempt_count`,
        [attempt.id],
      );
      const attemptCount = result.rows[0]?.attempt_count;
      if (attemptCount === undefined) throw new Error('Card authorization state changed.');
      await this.recordEvent(
        client,
        attempt.id,
        context.cashierAccountId,
        'authorization_started',
        {
          attempt: attemptCount,
          amountEur: canonicalAmount(command.amountEur),
        },
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  private async saveOutcome(
    client: PoolClient,
    attemptId: string,
    outcome: ReturnType<typeof outcomeFor>,
  ): Promise<void> {
    try {
      await client.query('BEGIN');
      const updated = await client.query<{ cashier_account_id: string }>(
        `UPDATE pos.card_authorization_attempts
         SET status = $2::varchar, adapter = $3::varchar, provider_reference = $4::varchar,
             response_code = $5::varchar, updated_at = now(),
             resolved_at = CASE WHEN $2::varchar IN ('approved', 'declined') THEN now() ELSE NULL END
         WHERE id = $1 RETURNING cashier_account_id`,
        [
          attemptId,
          outcome.status,
          outcome.adapter,
          'providerReference' in outcome ? outcome.providerReference : null,
          'code' in outcome ? outcome.code : null,
        ],
      );
      const actor = updated.rows[0]?.cashier_account_id;
      if (!actor) throw new Error('Card authorization attempt was not found.');
      await this.recordEvent(client, attemptId, actor, outcome.eventType, {
        ...(outcome.code ? { code: outcome.code } : {}),
        ...(outcome.providerReference ? { providerReference: outcome.providerReference } : {}),
        status: outcome.status,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  private async recordEvent(
    client: PoolClient,
    attemptId: string,
    actorAccountId: string,
    eventType: string,
    details: object,
  ): Promise<void> {
    await client.query(
      `INSERT INTO pos.card_authorization_events (id, attempt_id, event_type, actor_account_id, details)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [randomUUID(), attemptId, eventType, actorAccountId, details],
    );
  }

  private approvedOrDeclined(
    attempt: CardAuthorizationAttemptRow,
  ): Extract<CardAuthorizationResult, { status: 'approved' }> {
    if (attempt.status === 'approved' && attempt.provider_reference)
      return {
        adapter: attempt.adapter,
        providerReference: attempt.provider_reference,
        status: 'approved',
      };
    if (attempt.status === 'declined')
      throw new ApiErrorException(
        'POS_CARD_PAYMENT_DECLINED',
        'The card payment was declined. Use another payment method.',
        HttpStatus.CONFLICT,
      );
    throw this.outcomeUnknown();
  }

  private outcomeUnknown(): ApiErrorException {
    return new ApiErrorException(
      'POS_CARD_PAYMENT_OUTCOME_UNKNOWN',
      'The card payment result is still being checked. Review the terminal before retrying.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

function outcomeFor(result: CardAuthorizationResult) {
  if (result.status === 'approved') {
    if (!result.providerReference.trim() || result.providerReference.length > 120)
      return {
        adapter: result.adapter,
        code: 'PROVIDER_REFERENCE_MISSING',
        eventType: 'authorization_uncertain' as const,
        status: 'uncertain' as const,
      };
    return {
      adapter: result.adapter,
      eventType: 'authorization_approved' as const,
      providerReference: result.providerReference,
      status: 'approved' as const,
    };
  }
  if (result.status === 'declined')
    return {
      adapter: result.adapter,
      code: safeCode(result.code),
      eventType: 'authorization_declined' as const,
      status: 'declined' as const,
    };
  return {
    adapter: result.adapter,
    code: 'OUTCOME_UNKNOWN',
    eventType: 'authorization_uncertain' as const,
    status: 'uncertain' as const,
  };
}

function safeCode(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/gu, '').slice(0, 64) || 'PROVIDER_DECLINED';
}

function canonicalAmount(value: string): string {
  if (!/^\d+(?:\.\d{1,4})?$/u.test(value))
    throw new ApiErrorException(
      'POS_CARD_AMOUNT_INVALID',
      'The card amount must be a positive EUR amount.',
      HttpStatus.BAD_REQUEST,
    );
  const [whole = '0', fraction = ''] = value.split('.');
  const normalizedWhole = BigInt(whole);
  const normalizedFraction = BigInt(fraction.padEnd(4, '0'));
  if (normalizedWhole === 0n && normalizedFraction === 0n)
    throw new ApiErrorException(
      'POS_CARD_AMOUNT_INVALID',
      'The card amount must be a positive EUR amount.',
      HttpStatus.BAD_REQUEST,
    );
  return `${normalizedWhole.toString()}.${fraction.padEnd(4, '0')}`;
}
