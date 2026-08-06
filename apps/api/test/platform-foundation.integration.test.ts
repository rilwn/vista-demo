import { randomUUID } from 'node:crypto';

import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const runDatabaseTests = process.env['RUN_DATABASE_TESTS'] === 'true';

describe.skipIf(!runDatabaseTests)('platform foundation database guarantees', () => {
  let pool: Pool;
  let client: PoolClient;
  let requesterId: string;
  let approverId: string;

  beforeAll(async () => {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required when RUN_DATABASE_TESTS=true');
    }

    pool = new Pool({ connectionString: databaseUrl, max: 1 });
    client = await pool.connect();
    await client.query('BEGIN');

    requesterId = await createAccount(client, 'requester');
    approverId = await createAccount(client, 'approver');
  });

  afterAll(async () => {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  });

  it('rejects mutation of an audit event', async () => {
    const eventId = randomUUID();
    await client.query("SELECT pg_advisory_xact_lock(hashtext('vista.audit.events.chain'))");
    const previous = await client.query<{ event_hash: string }>(
      'SELECT event_hash FROM audit.events ORDER BY occurred_at DESC, id DESC LIMIT 1',
    );
    await client.query(
      `INSERT INTO audit.events (
         id, actor_account_id, action, target_type, target_id,
         correlation_id, previous_event_hash, event_hash
       ) VALUES ($1, $2, 'test.create', 'test_target', $3, $4, $5, $6)`,
      [
        eventId,
        requesterId,
        randomUUID(),
        randomUUID(),
        previous.rows[0]?.event_hash ?? null,
        randomUUID().replaceAll('-', '').padEnd(64, '0'),
      ],
    );

    await client.query('SAVEPOINT audit_mutation_check');
    await expect(
      client.query('UPDATE audit.events SET action = $1 WHERE id = $2', ['test.modified', eventId]),
    ).rejects.toThrow('audit events are append-only');
    await client.query('ROLLBACK TO SAVEPOINT audit_mutation_check');
  });

  it('enforces a different approver for a critical backup action', async () => {
    const requestId = randomUUID();
    await client.query(
      `INSERT INTO backup.approval_requests (
         id, critical_action, target_type, target_id, requested_by,
         expires_at, justification, correlation_id
       ) VALUES ($1, 'destructive_restore', 'restore_job', $2, $3,
                 now() + interval '1 hour', 'Integration test', $4)`,
      [requestId, randomUUID(), requesterId, randomUUID()],
    );

    await client.query('SAVEPOINT self_approval_check');
    await expect(
      client.query(
        `INSERT INTO backup.approvals (request_id, approver_account_id, decision)
         VALUES ($1, $2, 'approve')`,
        [requestId, requesterId],
      ),
    ).rejects.toThrow('critical backup actions require a different approver');
    await client.query('ROLLBACK TO SAVEPOINT self_approval_check');

    const result = await client.query(
      `INSERT INTO backup.approvals (request_id, approver_account_id, decision)
       VALUES ($1, $2, 'approve')`,
      [requestId, approverId],
    );
    expect(result.rowCount).toBe(1);
  });
});

async function createAccount(client: PoolClient, label: string): Promise<string> {
  const employeeId = randomUUID();
  const accountId = randomUUID();
  const suffix = randomUUID();

  await client.query(
    `INSERT INTO identity.employees (id, employee_number, display_name, email)
     VALUES ($1, $2, $3, $4)`,
    [employeeId, `${label}-${suffix}`, `Test ${label}`, `${label}-${suffix}@example.invalid`],
  );
  await client.query(
    `INSERT INTO identity.user_accounts (id, employee_id, password_hash)
     VALUES ($1, $2, $3)`,
    [accountId, employeeId, 'test-only-password-hash-placeholder'],
  );

  return accountId;
}
