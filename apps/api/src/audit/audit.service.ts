import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { DatabaseService } from '../database/database.service.js';
import type { AuditIntegrityResult } from '@vista/contracts';

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
      return appendAuditEvent(transaction, input);
    }

    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await appendAuditEvent(client, input);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async verifyIntegrity(): Promise<AuditIntegrityResult> {
    const result = await this.database.getPool().query<AuditVerificationRow>(
      `SELECT id, occurred_at, actor_account_id, action, target_type, target_id,
              correlation_id, host(source_ip) AS source_ip, user_agent, before_data, after_data,
              metadata, previous_event_hash, event_hash
       FROM audit.events
       ORDER BY occurred_at, id`,
    );
    let previousEventHash: string | undefined;
    for (const row of result.rows) {
      const expected = calculateEventHash({
        action: row.action,
        actorAccountId: row.actor_account_id ?? null,
        after: row.after_data,
        before: row.before_data,
        correlationId: row.correlation_id,
        id: row.id,
        metadata: row.metadata,
        occurredAt: asIso(row.occurred_at),
        previousEventHash: previousEventHash ?? null,
        sourceIp: row.source_ip ?? null,
        targetId: row.target_id ?? null,
        targetType: row.target_type,
        userAgent: row.user_agent ?? null,
      });
      if (row.previous_event_hash !== (previousEventHash ?? null) || row.event_hash !== expected) {
        return {
          brokenEventId: row.id,
          checkedEvents: result.rows.indexOf(row) + 1,
          ...(previousEventHash ? { headHash: previousEventHash } : {}),
          valid: false,
        };
      }
      previousEventHash = row.event_hash;
    }
    return {
      checkedEvents: result.rows.length,
      ...(previousEventHash ? { headHash: previousEventHash } : {}),
      valid: true,
    };
  }
}

export async function appendAuditEvent(
  client: PoolClient,
  input: AuditEventInput,
): Promise<AppendedAuditEvent> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('vista.audit.events.chain'))");
  const previousResult = await client.query<{ event_hash: string; occurred_at: Date | string }>(
    'SELECT event_hash, occurred_at FROM audit.events ORDER BY occurred_at DESC, id DESC LIMIT 1',
  );
  const previousEvent = previousResult.rows[0];
  const previousEventHash = previousEvent?.event_hash;
  const id = randomUUID();
  const occurredAt = new Date(
    Math.max(Date.now(), previousEvent ? new Date(previousEvent.occurred_at).getTime() + 1 : 0),
  ).toISOString();
  const metadata = input.metadata ?? {};
  const eventHash = calculateEventHash({
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
  });

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

interface AuditVerificationRow {
  action: string;
  actor_account_id: string | null;
  after_data: Record<string, unknown> | null;
  before_data: Record<string, unknown> | null;
  correlation_id: string;
  event_hash: string;
  id: string;
  metadata: Record<string, unknown>;
  occurred_at: Date | string;
  previous_event_hash: string | null;
  source_ip: string | null;
  target_id: string | null;
  target_type: string;
  user_agent: string | null;
}

function calculateEventHash(value: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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
