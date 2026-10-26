import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { DatabaseService } from '../database/database.service.js';
import type { AuditIntegrityResult } from '@vista/contracts';

import {
  appendAuditEvent,
  calculateEventHash,
  type AuditEventInput,
  type AppendedAuditEvent,
} from './audit-writer.js';
export { appendAuditEvent, type AuditEventInput, type AppendedAuditEvent } from './audit-writer.js';

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

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
