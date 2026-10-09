import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from '../src/database/migration-runner.js';

describe.skipIf(process.env['RUN_INFRASTRUCTURE_TESTS'] !== 'true')(
  'scheduled execution repair migration',
  () => {
    it('repairs only execution-backed markers, preserves immutable content and rolls back precisely', async () => {
      const source = process.env['DATABASE_URL'];
      if (!source) throw new Error('DATABASE_URL required');
      const admin = new Pool({ connectionString: source, max: 1 });
      const name = `vista_qa_test_${randomUUID().replaceAll('-', '')}`;
      if (!/^vista_qa_test_[a-f0-9]{32}$/.test(name)) throw new Error('Invalid isolated database');
      const url = new URL(source);
      url.pathname = `/${name}`;
      const database = new Pool({ connectionString: url.toString(), max: 1 });
      const directory = fileURLToPath(new URL('../src/database/migrations', import.meta.url));
      try {
        await admin.query(`CREATE DATABASE ${name}`);
        await migrateUp(database, directory);
        expect(await migrateDown(database, directory)).toBe('0068_sales_quotation_lifecycle');
        expect(await migrateDown(database, directory)).toBe(
          '0067_customer_advance_collection_allocation',
        );
        expect(await migrateDown(database, directory)).toBe('0066_subscription_finance_handoff');
        expect(await migrateDown(database, directory)).toBe('0065_scheduled_execution_evidence');
        const fixtures = [
          ['scheduler.crm.sla.evaluate.requested', {}],
          ['scheduler.backup.verify.requested', {}],
          ['scheduler.finance.payment-notification.prepare.requested', {}],
          ['scheduler.report.generate.requested', { exportId: randomUUID() }],
          ['scheduler.report.generate.requested', {}],
          ['sales.order.confirmed', {}],
        ] as const;
        const ids: string[] = [];
        for (const [type, input] of fixtures) {
          const id = randomUUID();
          ids.push(id);
          await database.query(
            `INSERT INTO integration.outbox_events
          (id, aggregate_type, aggregate_id, event_type, event_version, correlation_id, idempotency_key, payload)
          VALUES ($1::uuid,$2,$1::uuid,$3,1,$1::text,$1::text,$4)`,
            [id, type.startsWith('scheduler.') ? 'scheduled_job' : 'sales_order', type, { input }],
          );
        }
        const before = await database.query(
          'SELECT id, payload, occurred_at, sequence_number FROM integration.outbox_events ORDER BY id',
        );
        expect(await migrateUp(database, directory)).toEqual([
          '0065_scheduled_execution_evidence',
          '0066_subscription_finance_handoff',
          '0067_customer_advance_collection_allocation',
          '0068_sales_quotation_lifecycle',
        ]);
        const states = await database.query<{ id: string; status: string }>(
          'SELECT id, status FROM integration.outbox_events',
        );
        expect(ids.map((id) => states.rows.find((row) => row.id === id)?.status)).toEqual([
          'completed',
          'pending',
          'pending',
          'completed',
          'pending',
          'pending',
        ]);
        const after = await database.query(
          'SELECT id, payload, occurred_at, sequence_number FROM integration.outbox_events ORDER BY id',
        );
        expect(after.rows).toEqual(before.rows);
        expect(await migrateUp(database, directory)).toEqual([]);
        expect(await migrateDown(database, directory)).toBe('0068_sales_quotation_lifecycle');
        expect(await migrateDown(database, directory)).toBe(
          '0067_customer_advance_collection_allocation',
        );
        expect(await migrateDown(database, directory)).toBe('0066_subscription_finance_handoff');
        expect(await migrateDown(database, directory)).toBe('0065_scheduled_execution_evidence');
        const reverted = await database.query(
          "SELECT count(*)::integer AS count FROM integration.outbox_events WHERE status = 'pending'",
        );
        expect(reverted.rows[0].count).toBe(6);
        await migrateUp(database, directory);
      } finally {
        await database.end();
        // Only the validated disposable database created by this test is removed.
        await admin.query(`DROP DATABASE IF EXISTS ${name}`);
        await admin.end();
      }
    }, 60000);
  },
);
