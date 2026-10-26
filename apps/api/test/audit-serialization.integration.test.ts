import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { calculateEventHash } from '../src/audit/audit-writer.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { migrateUp } from '../src/database/migration-runner.js';

describe.skipIf(process.env['RUN_INFRASTRUCTURE_TESTS'] !== 'true')(
  'audit JSON serialization and integrity',
  () => {
    const name = `vista_audit_test_${randomUUID().replaceAll('-', '')}`;
    let admin: Pool, database: Pool, audit: AuditService;
    beforeAll(async () => {
      const source = process.env['DATABASE_URL'];
      if (!source || !/^vista_audit_test_[a-f0-9]{32}$/u.test(name)) {
        throw new Error('Isolated database required');
      }
      admin = new Pool({ connectionString: source, max: 1 });
      await admin.query(`CREATE DATABASE ${name}`);
      const url = new URL(source);
      url.pathname = `/${name}`;
      database = new Pool({ connectionString: url.toString(), max: 1 });
      await migrateUp(
        database,
        fileURLToPath(new URL('../src/database/migrations', import.meta.url)),
      );
      audit = new AuditService({ getPool: () => database } as DatabaseService);
    }, 30000);
    afterAll(async () => {
      if (database) await database.end();
      if (admin) {
        if (!/^vista_audit_test_[a-f0-9]{32}$/u.test(name)) throw new Error('Unsafe cleanup');
        await admin.query(`DROP DATABASE IF EXISTS ${name}`);
        await admin.end();
      }
    });

    it('verifies new events after dates, undefined fields and arrays pass through JSONB', async () => {
      const before = {
        updated_at: new Date('2026-10-26T12:00:00.000Z'),
        optional: undefined,
        nested: { date: new Date('2026-10-23T15:00:00.000Z'), optional: undefined },
        list: [undefined, new Date('2026-10-23T15:00:00.000Z')],
      };
      const after = { status: 'responded', updatedAt: '2026-10-26T12:01:00.000Z' };
      const event = await audit.append({
        action: 'test.serialization',
        targetType: 'test',
        correlationId: randomUUID(),
        before,
        after,
        metadata: { date: before.updated_at, missing: undefined },
      });
      const { rows } = await database.query<{
        before_data: Record<string, unknown>;
        after_data: Record<string, unknown>;
        metadata: Record<string, unknown>;
      }>('SELECT before_data,after_data,metadata FROM audit.events WHERE id=$1', [event.id]);
      expect(rows[0]?.before_data).toEqual(JSON.parse(JSON.stringify(before)));
      expect(rows[0]?.after_data).toEqual(after);
      expect(rows[0]?.metadata).toEqual({ date: '2026-10-26T12:00:00.000Z' });
      await expect(audit.verifyIntegrity()).resolves.toMatchObject({ valid: true });
      await audit.append({
        action: 'test.followup',
        targetType: 'test',
        correlationId: randomUUID(),
        after: { amount: '12.3400' },
      });
      await expect(audit.verifyIntegrity()).resolves.toMatchObject({ valid: true });
    });

    it('preserves the existing hash format and rejects unserializable input without appending', async () => {
      const safe = { status: 'responded', nested: { amount: '12.3400', optional: null } };
      expect(calculateEventHash(safe)).toBe(
        calculateEventHash(JSON.parse(JSON.stringify(safe)) as Record<string, unknown>),
      );
      const before = await audit.verifyIntegrity();
      await expect(
        audit.append({
          action: 'test.invalid',
          targetType: 'test',
          correlationId: randomUUID(),
          after: { invalid: 1n },
        }),
      ).rejects.toThrow();
      expect(await audit.verifyIntegrity()).toEqual(before);
    });
  },
);
