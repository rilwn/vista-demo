import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { DatabaseService } from '../database/database.service.js';

export interface AuditEventInput {
  action: string;
  actorAccountId?: string;
  after?: Record<string, unknown>;
  before?: Record<string, unknown>;
  correlationId: string;
  metadata?: Record<string, unknown>;
  sourceIp?: string;
  targetId?: string;
  targetType: string;
  userAgent?: string;
}

export interface AppendedAuditEvent {
  eventHash: string;
  id: string;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async append(input: AuditEventInput, transaction?: PoolClient): Promise<AppendedAuditEvent> {
    if (transaction) {
      return this.appendInTransaction(transaction, input);
    }

    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await this.appendInTransaction(client, input);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async appendInTransaction(
    client: PoolClient,
    input: AuditEventInput,
  ): Promise<AppendedAuditEvent> {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('vista.audit.events.chain'))");
    const previousResult = await client.query<{ event_hash: string }>(
      'SELECT event_hash FROM audit.events ORDER BY occurred_at DESC, id DESC LIMIT 1',
    );
    const previousEventHash = previousResult.rows[0]?.event_hash;
    const id = randomUUID();
    const occurredAt = new Date().toISOString();
    const metadata = input.metadata ?? {};
    const eventHash = createHash('sha256')
      .update(
        canonicalJson({
          action: input.action,
          actorAccountId: input.actorAccountId ?? null,
          after: input.after ?? null,
          before: input.before ?? null,
          correlationId: input.correlationId,
          id,
          metadata,
          occurredAt,
          previousEventHash: previousEventHash ?? null,
          sourceIp: input.sourceIp ?? null,
          targetId: input.targetId ?? null,
          targetType: input.targetType,
          userAgent: input.userAgent ?? null,
        }),
      )
      .digest('hex');

    await client.query(
      `INSERT INTO audit.events (
         id, occurred_at, actor_account_id, action, target_type, target_id,
         correlation_id, source_ip, user_agent, before_data, after_data,
         metadata, previous_event_hash, event_hash
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
       )`,
      [
        id,
        occurredAt,
        input.actorAccountId ?? null,
        input.action,
        input.targetType,
        input.targetId ?? null,
        input.correlationId,
        input.sourceIp ?? null,
        input.userAgent ?? null,
        input.before ?? null,
        input.after ?? null,
        metadata,
        previousEventHash ?? null,
        eventHash,
      ],
    );
    return { eventHash, id };
  }
}

function canonicalJson(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
