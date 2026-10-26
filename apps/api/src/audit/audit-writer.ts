import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

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

export async function appendAuditEvent(
  client: PoolClient,
  input: AuditEventInput,
): Promise<AppendedAuditEvent> {
  // Hash exactly the JSON representation PostgreSQL will store, including dates
  // and omitted undefined properties. Never change existing events or hashes.
  const before = input.before ? storedJson(input.before) : null;
  const after = input.after ? storedJson(input.after) : null;
  const metadata = storedJson(input.metadata ?? {});
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
  const eventHash = calculateEventHash({
    action: input.action,
    actorAccountId: input.actorAccountId ?? null,
    after,
    before,
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
      before,
      after,
      metadata,
      previousEventHash ?? null,
      eventHash,
    ],
  );
  return { eventHash, id };
}

function storedJson(value: Record<string, unknown>): Record<string, unknown> {
  const parsed: unknown = JSON.parse(JSON.stringify(value));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Audit data must serialize to a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export function calculateEventHash(value: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
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
