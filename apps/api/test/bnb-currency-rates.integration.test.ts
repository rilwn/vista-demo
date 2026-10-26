import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrateUp } from '../src/database/migration-runner.js';
import { bootstrapDevelopmentFixtures, fixtureId } from '../src/database/development-fixtures.js';
import { BnbCurrencyRatesService } from '../src/finance/bnb-currency-rates.service.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { StructuredLogger } from '../src/logging/structured-logger.service.js';

describe.skipIf(process.env['RUN_INFRASTRUCTURE_TESTS'] !== 'true')(
  'BNB cache and issued-rate snapshot guarantees',
  () => {
    const name = `vista_bnb_test_${randomUUID().replaceAll('-', '')}`;
    const documentId = randomUUID();
    let admin: Pool, database: Pool, service: BnbCurrencyRatesService;
    beforeAll(async () => {
      const source = process.env['DATABASE_URL'];
      if (!source || !/^vista_bnb_test_[a-f0-9]{32}$/u.test(name))
        throw new Error('Isolated database required');
      admin = new Pool({ connectionString: source, max: 1 });
      await admin.query(`CREATE DATABASE ${name}`);
      const url = new URL(source);
      url.pathname = `/${name}`;
      database = new Pool({ connectionString: url.toString(), max: 1 });
      await migrateUp(
        database,
        fileURLToPath(new URL('../src/database/migrations', import.meta.url)),
      );
      const client = await database.connect();
      try {
        await client.query('BEGIN');
        await bootstrapDevelopmentFixtures(client, 'test-only-placeholder-not-an-account-password');
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      await database.query(
        "INSERT INTO finance.currency_rates(currency_code,rate_date,eur_per_unit) VALUES('USD','2026-10-23',0.8)",
      );
      await database.query(
        `INSERT INTO finance.financial_documents(
      id,draft_number,official_number,document_type,status,legal_entity_id,branch_id,business_location_id,customer_partner_id,
      issue_date,tax_event_date,currency_code,exchange_rate,rate_date,rate_source,issuer_name,issuer_address,customer_name,customer_address,
      net_total,vat_total,gross_total,eur_net_total,eur_vat_total,eur_gross_total,created_by,issued_by,issued_at)
      VALUES($1,'BNB-SNAPSHOT-TEST','9999999999','invoice','issued',$2,$3,$4,$5,
      '2026-10-23','2026-10-23','USD',0.8,'2026-10-23','BNB','Test issuer','1 Test Street','Test customer','2 Test Street',
      100,20,120,80,16,96,$6,$6,now())`,
        [
          documentId,
          fixtureId('organization:entity'),
          fixtureId('organization:branch'),
          fixtureId('organization:location'),
          fixtureId('partner:alfa'),
          fixtureId('account:manager'),
        ],
      );
      service = new BnbCurrencyRatesService(
        { getPool: () => database } as DatabaseService,
        { event: vi.fn() } as unknown as StructuredLogger,
      );
    }, 30000);
    afterEach(() => vi.unstubAllGlobals());
    afterAll(async () => {
      if (database) await database.end();
      if (admin) {
        if (!/^vista_bnb_test_[a-f0-9]{32}$/u.test(name)) throw new Error('Unsafe cleanup');
        await admin.query(`DROP DATABASE IF EXISTS ${name}`);
        await admin.end();
      }
    });
    async function rates() {
      return (
        await database.query<Record<string, unknown>>(
          'SELECT currency_code,rate_date::text,eur_per_unit::text,imported_at::text,xmin::text FROM finance.currency_rates ORDER BY currency_code,rate_date',
        )
      ).rows;
    }
    async function document() {
      return (
        await database.query<Record<string, unknown>>(
          'SELECT to_jsonb(document) AS snapshot FROM finance.financial_documents document WHERE id=$1',
          [documentId],
        )
      ).rows[0];
    }
    function feed(usd = '0.8934', gbp = '1.1943') {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() =>
          Promise.resolve(
            new Response(`<ROWSET>
      <ROW><CODE>USD</CODE><REVERSERATE>${usd}</REVERSERATE><CURR_DATE>23.10.2026</CURR_DATE></ROW>
      <ROW><CODE>GBP</CODE><REVERSERATE>${gbp}</REVERSERATE><CURR_DATE>23.10.2026</CURR_DATE></ROW></ROWSET>`),
          ),
        ),
      );
    }
    it('keeps the original cache and issued document when upstream returns blocked HTML', async () => {
      const before = await rates(),
        snapshot = await document();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Access denied</html>')));
      await expect(service.refresh()).rejects.toMatchObject({ code: 'BNB_RATE_FEED_NOT_XML' });
      expect(await rates()).toEqual(before);
      expect(await document()).toEqual(snapshot);
    });
    it('imports valid precise rates once and does not recalculate an issued snapshot', async () => {
      const snapshot = await document();
      feed();
      await expect(service.refresh()).resolves.toEqual({
        currencyCount: 2,
        rateDate: '2026-10-23',
      });
      const first = await rates();
      expect(first).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ currency_code: 'USD', eur_per_unit: '0.89340000' }),
          expect.objectContaining({ currency_code: 'GBP', eur_per_unit: '1.19430000' }),
        ]),
      );
      await service.refresh();
      expect(await rates()).toEqual(first);
      expect(await document()).toEqual(snapshot);
      await expect(service.rate('USD', '2026-10-26')).resolves.toMatchObject({
        exchangeRate: '0.89340000',
        rateDate: '2026-10-23',
      });
    });
    it('rolls back the complete feed if a later write fails', async () => {
      const before = await rates(),
        snapshot = await document();
      await database.query(`CREATE FUNCTION finance.bnb_test_write_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.currency_code='USD' THEN RAISE EXCEPTION 'test rate write failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER bnb_test_write_failure BEFORE INSERT OR UPDATE ON finance.currency_rates
      FOR EACH ROW EXECUTE FUNCTION finance.bnb_test_write_failure()`);
      try {
        feed('0.9', '1.2');
        await expect(service.refresh()).rejects.toThrow('test rate write failure');
        expect(await rates()).toEqual(before);
        expect(await document()).toEqual(snapshot);
      } finally {
        await database.query(
          'DROP TRIGGER bnb_test_write_failure ON finance.currency_rates;DROP FUNCTION finance.bnb_test_write_failure()',
        );
      }
    });
  },
);
