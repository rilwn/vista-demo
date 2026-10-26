import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from '../src/database/migration-runner.js';
import { bootstrapDevelopmentFixtures } from '../src/database/development-fixtures.js';
import { AuditService } from '../src/audit/audit.service.js';
import type { DatabaseService } from '../src/database/database.service.js';

const old = 'a29f4111bc30c5c9098cc77a05311cdfec49e5810529833dc257d3ccede5d6c9';
const current = '0d68a49b6d175ddfbdb166fae2da8b81a3d02ce40da9311f4979a15f51f46a78';
const id = '0069_eur_transition';
describe.skipIf(process.env['RUN_INFRASTRUCTURE_TESTS'] !== 'true')(
  'known EUR migration checksum reconciliation',
  () => {
    let admin: Pool, database: Pool;
    const name = `vista_checksum_test_${randomUUID().replaceAll('-', '')}`;
    const directory = fileURLToPath(new URL('../src/database/migrations', import.meta.url));
    beforeAll(async () => {
      const source = process.env['DATABASE_URL'];
      if (!source || !/^vista_checksum_test_[a-f0-9]{32}$/u.test(name))
        throw new Error('Isolated database settings required');
      admin = new Pool({ connectionString: source, max: 1 });
      await admin.query(`CREATE DATABASE ${name}`);
      const url = new URL(source);
      url.pathname = `/${name}`;
      database = new Pool({ connectionString: url.toString(), max: 1 });
      await migrateUp(database, directory);
      const client = await database.connect();
      try {
        await client.query('BEGIN');
        await bootstrapDevelopmentFixtures(client, 'test-only-placeholder-not-a-real-password');
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }, 30000);
    afterAll(async () => {
      if (database) await database.end();
      if (admin) {
        if (!/^vista_checksum_test_[a-f0-9]{32}$/u.test(name))
          throw new Error('Unsafe database cleanup');
        await admin.query(`DROP DATABASE IF EXISTS ${name}`);
        await admin.end();
      }
    });
    async function checksum() {
      return (
        await database.query<{ checksum: string; applied_at: Date }>(
          'SELECT checksum,applied_at FROM platform.schema_migrations WHERE id=$1',
          [id],
        )
      ).rows[0]!;
    }
    async function setChecksum(value: string) {
      await database.query('UPDATE platform.schema_migrations SET checksum=$2 WHERE id=$1', [
        id,
        value,
      ]);
    }
    async function repairEvents() {
      return (
        await database.query<{
          before_data: Record<string, unknown>;
          after_data: Record<string, unknown>;
        }>(
          "SELECT before_data,after_data FROM audit.events WHERE action='database.migration.checksum_reconciled' ORDER BY occurred_at,id",
        )
      ).rows;
    }
    async function snapshot() {
      return (
        await database.query<Record<string, unknown>>(`SELECT
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM finance.financial_documents t) AS documents,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM finance.payments t) AS payments,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM identity.user_accounts t) AS accounts,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM platform.currency_transition_runs t) AS transitions,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY warehouse_id,product_id) FROM inventory.stock_balances t) AS stock`)
      ).rows[0];
    }

    it('leaves a canonical deployed database unchanged', async () => {
      const before = await snapshot();
      expect(await migrateUp(database, directory)).toEqual([]);
      expect((await checksum()).checksum).toBe(current);
      expect(await repairEvents()).toEqual([]);
      expect(await snapshot()).toEqual(before);
    });
    it('rejects unknown drift anywhere before reconciling a known legacy row', async () => {
      await setChecksum(old);
      const other = '0078_finance_proforma_conversion_link';
      const previous = (
        await database.query<{ checksum: string }>(
          'SELECT checksum FROM platform.schema_migrations WHERE id=$1',
          [other],
        )
      ).rows[0]!.checksum;
      await database.query('UPDATE platform.schema_migrations SET checksum=$2 WHERE id=$1', [
        other,
        'f'.repeat(64),
      ]);
      try {
        await expect(migrateUp(database, directory)).rejects.toThrow(
          `Applied migration ${other} has been modified`,
        );
        expect((await checksum()).checksum).toBe(old);
        expect(await repairEvents()).toEqual([]);
      } finally {
        await database.query('UPDATE platform.schema_migrations SET checksum=$2 WHERE id=$1', [
          other,
          previous,
        ]);
        await setChecksum(current);
      }
      await setChecksum('e'.repeat(64));
      try {
        await expect(migrateUp(database, directory)).rejects.toThrow(
          `Applied migration ${id} has been modified`,
        );
      } finally {
        await setChecksum(current);
      }
    });
    it('refuses an unfinished transition and an unvalidated EUR constraint', async () => {
      await setChecksum(old);
      await database.query(
        "UPDATE platform.currency_transition_runs SET transition_code='checksum-test-incomplete'",
      );
      try {
        await expect(migrateUp(database, directory)).rejects.toThrow(
          'transition or EUR-rate state requires review',
        );
        expect((await checksum()).checksum).toBe(old);
        expect(await repairEvents()).toEqual([]);
      } finally {
        await database.query(
          "UPDATE platform.currency_transition_runs SET transition_code='bgn-to-eur-2026-10'",
        );
      }
      await database.query(`ALTER TABLE finance.financial_documents DROP CONSTRAINT finance_document_eur_rate_valid;
      ALTER TABLE finance.financial_documents ADD CONSTRAINT finance_document_eur_rate_valid
      CHECK(currency_code<>'EUR' OR (exchange_rate=1 AND rate_source='internal_eur')) NOT VALID`);
      try {
        await expect(migrateUp(database, directory)).rejects.toThrow(
          'transition or EUR-rate state requires review',
        );
        expect((await checksum()).checksum).toBe(old);
        expect(await repairEvents()).toEqual([]);
      } finally {
        await database.query(
          'ALTER TABLE finance.financial_documents VALIDATE CONSTRAINT finance_document_eur_rate_valid',
        );
        await setChecksum(current);
      }
    });
    it('rolls back the audit entry and history update together on a failed write', async () => {
      await setChecksum(old);
      await database.query(`CREATE FUNCTION platform.checksum_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'checksum test write failure'; END; $$;
      CREATE TRIGGER checksum_test_failure BEFORE UPDATE ON platform.schema_migrations
      FOR EACH STATEMENT EXECUTE FUNCTION platform.checksum_test_failure()`);
      try {
        await expect(migrateUp(database, directory)).rejects.toThrow('checksum test write failure');
        expect((await checksum()).checksum).toBe(old);
        expect(await repairEvents()).toEqual([]);
      } finally {
        await database.query(
          'DROP TRIGGER checksum_test_failure ON platform.schema_migrations;DROP FUNCTION platform.checksum_test_failure()',
        );
        await setChecksum(current);
      }
    });
    it('reconciles and audits the exact legacy version once without changing business data', async () => {
      await setChecksum(old);
      const before = await snapshot(),
        appliedAt = (await checksum()).applied_at;
      expect(await migrateUp(database, directory)).toEqual([]);
      expect(await checksum()).toEqual({ checksum: current, applied_at: appliedAt });
      expect(await snapshot()).toEqual(before);
      expect(await repairEvents()).toEqual([
        {
          before_data: { migrationId: id, checksum: old },
          after_data: { migrationId: id, checksum: current },
        },
      ]);
      expect(await migrateUp(database, directory)).toEqual([]);
      expect(await repairEvents()).toHaveLength(1);
      for (const sql of [
        "UPDATE audit.events SET action='changed' WHERE action='database.migration.checksum_reconciled'",
        "DELETE FROM audit.events WHERE action='database.migration.checksum_reconciled'",
      ])
        await expect(database.query(sql)).rejects.toThrow('append-only');
      const audit = new AuditService({ getPool: () => database } as DatabaseService);
      expect((await audit.verifyIntegrity()).valid).toBe(true);
      expect(await migrateDown(database, directory)).toBe('0083_pos_account_collections');
      expect(await migrateUp(database, directory)).toEqual(['0083_pos_account_collections']);
      expect(await snapshot()).toEqual(before);
    });
  },
);
