import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from '../src/database/migration-runner.js';

describe.skipIf(process.env['RUN_INFRASTRUCTURE_TESTS'] !== 'true')(
  'collection correction migration',
  () => {
    it('backfills issued notes once with exact source/rate snapshots and preserves paid funds', async () => {
      const source = process.env['DATABASE_URL'];
      if (!source) throw new Error('DATABASE_URL required');
      const name = `vista_correction_test_${randomUUID().replaceAll('-', '')}`;
      if (!/^vista_correction_test_[a-f0-9]{32}$/u.test(name))
        throw new Error('Invalid disposable database name');
      const admin = new Pool({ connectionString: source, max: 1 });
      const url = new URL(source);
      url.pathname = `/${name}`;
      const database = new Pool({ connectionString: url.toString(), max: 1 });
      const directory = fileURLToPath(new URL('../src/database/migrations', import.meta.url));
      const employee = randomUUID(),
        actor = randomUUID(),
        partner = randomUUID(),
        company = randomUUID(),
        branch = randomUUID(),
        location = randomUUID(),
        invoice = randomUUID(),
        note = randomUUID(),
        draft = randomUUID(),
        collection = randomUUID();
      try {
        await admin.query(`CREATE DATABASE ${name}`);
        await migrateUp(database, directory);
        // Reach this migration explicitly as later Finance migrations are added.
        let reverted = await migrateDown(database, directory);
        while (reverted && reverted !== '0082_collection_corrections')
          reverted = await migrateDown(database, directory);
        expect(reverted).toBe('0082_collection_corrections');
        await database.query(
          "INSERT INTO identity.employees(id,employee_number,display_name,email) VALUES($1,'CORRECTION-QA','Correction migration QA','correction@example.invalid')",
          [employee],
        );
        await database.query(
          "INSERT INTO identity.user_accounts(id,employee_id,password_hash) VALUES($1,$2,'test-only-not-a-password')",
          [actor, employee],
        );
        await database.query(
          "INSERT INTO master_data.partners(id,kind,display_name,created_by,updated_by) VALUES($1,'legal_entity','Correction QA customer',$2,$2)",
          [partner, actor],
        );
        await database.query(
          "INSERT INTO organization.legal_entities(id,code,name,created_by,updated_by) VALUES($1,'CORRECTION-QA','Correction QA issuer',$2,$2)",
          [company, actor],
        );
        await database.query(
          "INSERT INTO organization.branches(id,legal_entity_id,code,name,created_by,updated_by) VALUES($1,$2,'CORRECTION-QA','Correction QA branch',$3,$3)",
          [branch, company, actor],
        );
        await database.query(
          "INSERT INTO organization.business_locations(id,branch_id,code,name,location_type,address_line_1,city,created_by,updated_by) VALUES($1,$2,'CORRECTION-QA','Correction QA office','office','1 Test Street','Vratsa',$3,$3)",
          [location, branch, actor],
        );
        await database.query(
          `INSERT INTO finance.financial_documents(id,draft_number,official_number,document_type,status,
        legal_entity_id,branch_id,business_location_id,customer_partner_id,correction_of_document_id,correction_reason,
        issue_date,tax_event_date,due_date,currency_code,exchange_rate,rate_date,rate_source,
        issuer_name,issuer_address,customer_name,customer_address,net_total,vat_total,gross_total,
        eur_net_total,eur_vat_total,eur_gross_total,created_by,issued_by,issued_at)
        SELECT entry.id,entry.reference,entry.number,entry.type,entry.status,$1,$2,$3,$4,
        CASE WHEN entry.type='invoice' THEN NULL ELSE $5::uuid END,
        CASE WHEN entry.type='invoice' THEN NULL ELSE 'Returned item' END,
        CURRENT_DATE,CURRENT_DATE,CURRENT_DATE,'USD',entry.rate,CURRENT_DATE,'BNB',
        'QA issuer','1 Test Street','QA customer','2 Test Street',entry.net,entry.vat,entry.net+entry.vat,
        entry.net*entry.rate,entry.vat*entry.rate,(entry.net+entry.vat)*entry.rate,$8,
        CASE WHEN entry.status='issued' THEN $8::uuid ELSE NULL END,
        CASE WHEN entry.status='issued' THEN now() ELSE NULL END
        FROM (VALUES($5::uuid,'MIG-INV','0000000001','invoice','issued',100::numeric,20::numeric,0.92::numeric),
        ($6::uuid,'MIG-CN','0000000002','credit_note','issued',20,4,0.95),
        ($7::uuid,'MIG-DRAFT',NULL,'credit_note','draft',10,2,0.95)) entry(id,reference,number,type,status,net,vat,rate)`,
          [company, branch, location, partner, invoice, note, draft, actor],
        );
        await database.query(
          `INSERT INTO finance.customer_documents(id,document_number,financial_document_id,customer_partner_id,
        document_date,due_date,currency_code,exchange_rate,rate_date,rate_source,total,allocated_total,outstanding_total,eur_total,payment_status,created_by)
        VALUES($1,'MIG-COLLECTION',$2,$3,CURRENT_DATE,CURRENT_DATE,'USD',0.92,CURRENT_DATE,'BNB',120,120,0,110.4,'paid',$4)`,
          [collection, invoice, partner, actor],
        );
        const payment = randomUUID();
        const allocation = randomUUID();
        await database.query(
          `INSERT INTO finance.payments(id,payment_number,customer_partner_id,payment_date,payment_method,currency_code,amount,recorded_by)
          VALUES($1,'MIG-PAYMENT',$2,CURRENT_DATE,'bank_transfer','USD',120,$3)`,
          [payment, partner, actor],
        );
        await database.query(
          `INSERT INTO finance.payment_allocations(id,payment_id,customer_document_id,amount,allocated_by)
          VALUES($1,$2,$3,120,$4)`,
          [allocation, payment, collection, actor],
        );
        const payments = () =>
          database.query<Record<string, unknown>>(
            `SELECT to_jsonb(payment)-'source_pos_sale_id' AS payment,to_jsonb(allocation) AS allocation FROM finance.payments payment
          JOIN finance.payment_allocations allocation ON allocation.payment_id=payment.id WHERE payment.id=$1`,
            [payment],
          );
        const paymentsBefore = (await payments()).rows;
        const originals = (
          await database.query(
            'SELECT id,gross_total,eur_gross_total,exchange_rate FROM finance.financial_documents ORDER BY id',
          )
        ).rows;
        expect(await migrateUp(database, directory)).toContain('0082_collection_corrections');
        const read = async () =>
          (
            await database.query<Record<string, string | number>>(
              'SELECT total::text,credit_total::text,adjusted_total::text,allocated_total::text,outstanding_total::text,overpaid_total::text,payment_status,version FROM finance.customer_documents WHERE id=$1',
              [collection],
            )
          ).rows[0];
        const balance = await read();
        expect(balance).toMatchObject({
          total: '120.0000',
          credit_total: '24.0000',
          adjusted_total: '96.0000',
          allocated_total: '120.0000',
          outstanding_total: '0.0000',
          overpaid_total: '24.0000',
          payment_status: 'paid',
        });
        expect(
          (
            await database.query(
              'SELECT correction_document_id,amount::text,eur_amount::text,origin FROM finance.collection_corrections',
            )
          ).rows,
        ).toEqual([
          {
            correction_document_id: note,
            amount: '24.0000',
            eur_amount: '22.8000',
            origin: 'migration',
          },
        ]);
        expect(await migrateUp(database, directory)).toEqual([]);
        expect(await read()).toEqual(balance);
        expect((await payments()).rows).toEqual(paymentsBefore);
        expect(
          (
            await database.query(
              'SELECT id,gross_total,eur_gross_total,exchange_rate FROM finance.financial_documents ORDER BY id',
            )
          ).rows,
        ).toEqual(originals);
        await expect(
          database.query(
            `INSERT INTO finance.collection_corrections(customer_document_id,original_document_id,correction_document_id,document_type,document_date,currency_code,amount,eur_amount,origin,actor_account_id,correlation_id)
        VALUES($1,$2,$3,'credit_note',CURRENT_DATE,'USD',12,11.4,'issuance',$4,'invalid-draft-test')`,
            [collection, invoice, draft, actor],
          ),
        ).rejects.toThrow('must match its issued note');
        while (
          (
            await database.query<{ id: string }>(
              `SELECT id FROM platform.schema_migrations ORDER BY id DESC LIMIT 1`,
            )
          ).rows[0]?.id !== '0082_collection_corrections'
        )
          await migrateDown(database, directory);
        await expect(migrateDown(database, directory)).rejects.toThrow(
          'Cannot downgrade collection corrections',
        );
      } finally {
        await database.end();
        await admin.query(`DROP DATABASE IF EXISTS ${name}`);
        await admin.end();
      }
    }, 60000);
  },
);
