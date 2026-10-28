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
        const migrationRange = [
          '0065_scheduled_execution_evidence',
          '0066_subscription_finance_handoff',
          '0067_customer_advance_collection_allocation',
          '0068_sales_quotation_lifecycle',
          '0069_eur_transition',
          '0070_eur_demo_price_lists',
          '0071_service_customer_charges',
          '0072_receipt_cost_baseline',
          '0073_bank_duplicate_review',
          '0074_finance_payment_reversals',
          '0075_bnb_currency_rates',
          '0076_financial_document_issuance',
          '0077_finance_income_outcome_exports',
          '0078_finance_proforma_conversion_link',
          '0079_finance_collection_sources',
          '0080_recurring_invoice_issuance',
          '0081_financial_document_branding',
          '0082_collection_corrections',
          '0083_pos_account_collections',
          '0084_pos_account_return_refunds',
          '0085_pos_account_finance_collections',
          '0086_pos_account_supplier_offsets',
          '0087_finance_payment_status_register',
          '0088_supplier_invoice_rate_snapshots',
          '0089_procurement_acceptance_protocols',
          '0090_crm_warranty_coverage_offers',
          '0091_crm_customer_survey_delivery',
          '0092_logistics_courier_bookings',
          '0093_pos_fiscal_sale_saga',
          '0094_pos_fiscal_daily_reports',
          '0095_pos_fiscal_return_saga',
          '0096_pos_datecs_unp_leases',
          '0097_pos_card_authorization_lifecycle',
          '0098_pos_offline_sync_audit',
          '0099_finance_bank_value_date_semantics',
          '0100_backup_inventory_policies',
          '0101_backup_policy_approval',
          '0102_backup_execution_ledger',
          '0103_backup_restore_requests',
          '0104_backup_retention',
          '0105_backup_missed_schedules',
          '0106_backup_dr_tests',
          '0107_backup_plan_reviews',
          '0108_backup_object_storage_restore',
          '0109_backup_compression',
          '0110_backup_granular_file_restore',
          '0111_backup_file_share_source',
          '0112_backup_policy_disable_approval',
          '0113_backup_restore_point_deletion',
          '0114_backup_retention_reduction_approval',
          '0115_backup_independent_copies',
        ];
        for (const migration of [...migrationRange].reverse()) {
          expect(await migrateDown(database, directory)).toBe(migration);
        }

        // Seed representative pre-transition BGN data and a EUR-denominated
        // financial document before replaying the EUR migration. This checks
        // conversion and rate normalization, not only an empty-schema replay.
        const employeeId = randomUUID();
        const accountId = randomUUID();
        const partnerId = randomUUID();
        const legalEntityId = randomUUID();
        const branchId = randomUUID();
        const locationId = randomUUID();
        const financialDocumentId = randomUUID();
        const advanceId = randomUUID();
        const advanceEntryId = randomUUID();
        const loyaltyProgramId = randomUUID();
        const opportunityId = randomUUID();
        await database.query(
          `INSERT INTO identity.employees (id, employee_number, display_name, email)
           VALUES ($1, $2, $3, $4)`,
          [
            employeeId,
            `EUR-QA-${employeeId.slice(0, 8)}`,
            'EUR migration QA',
            `${employeeId}@vista.local`,
          ],
        );
        await database.query(
          'INSERT INTO identity.user_accounts (id, employee_id, password_hash) VALUES ($1, $2, $3)',
          [accountId, employeeId, 'test-only-hash'],
        );
        await database.query(
          `INSERT INTO master_data.partners (id, kind, display_name, created_by, updated_by)
           VALUES ($1, 'legal_entity', $2, $3, $3)`,
          [partnerId, `EUR migration QA ${partnerId.slice(0, 8)}`, accountId],
        );
        await database.query(
          `INSERT INTO organization.legal_entities (id, code, name, created_by, updated_by)
           VALUES ($1, $2, 'EUR migration QA issuer', $3, $3)`,
          [legalEntityId, `EUR-${legalEntityId.slice(0, 8)}`, accountId],
        );
        await database.query(
          `INSERT INTO organization.branches
             (id, legal_entity_id, code, name, created_by, updated_by)
           VALUES ($1, $2, $3, 'EUR migration QA branch', $4, $4)`,
          [branchId, legalEntityId, `EUR-${branchId.slice(0, 8)}`, accountId],
        );
        await database.query(
          `INSERT INTO organization.business_locations
             (id, branch_id, code, name, location_type, address_line_1, city, created_by, updated_by)
           VALUES ($1, $2, $3, 'EUR migration QA location', 'office',
             '1 Test Street', 'Vratsa', $4, $4)`,
          [locationId, branchId, `EUR-${locationId.slice(0, 8)}`, accountId],
        );
        await database.query(
          `INSERT INTO finance.financial_documents (
             id, draft_number, document_type, legal_entity_id, branch_id,
             business_location_id, customer_partner_id, issue_date, tax_event_date,
             due_date, currency_code, exchange_rate, rate_date, rate_source,
             issuer_name, issuer_address, customer_name, customer_address,
             net_total, vat_total, gross_total, bgn_net_total, bgn_vat_total,
             bgn_gross_total, created_by
           ) VALUES (
             $1, $2, 'invoice', $3, $4, $5, $6, CURRENT_DATE, CURRENT_DATE,
             CURRENT_DATE, 'EUR', 1.95583000, CURRENT_DATE, 'BNB',
             'EUR migration QA issuer', '1 Test Street, Vratsa',
             'EUR migration QA customer', '2 Test Street, Vratsa',
             100, 20, 120, 195.5830, 39.1166, 234.6996, $7
           )`,
          [
            financialDocumentId,
            `EUR-MIGRATION-${financialDocumentId.slice(0, 8)}`,
            legalEntityId,
            branchId,
            locationId,
            partnerId,
            accountId,
          ],
        );
        await database.query(
          `INSERT INTO sales.customer_payment_terms
             (id, customer_partner_id, on_account_enabled, credit_limit_bgn,
              payment_terms_days, valid_from, created_by, updated_by)
           VALUES ($1, $2, true, 1955.8300, 14, CURRENT_DATE, $3, $3)`,
          [randomUUID(), partnerId, accountId],
        );
        await database.query(
          `INSERT INTO finance.customer_advances
             (id, advance_number, customer_partner_id, currency_code, amount,
              received_on, payment_method, recorded_by)
           VALUES ($1, $2, $3, 'BGN', 1955.8300, CURRENT_DATE, 'bank_transfer', $4)`,
          [advanceId, `EUR-QA-${advanceId.slice(0, 8)}`, partnerId, accountId],
        );
        await database.query(
          `INSERT INTO finance.customer_advance_entries
             (id, advance_id, entry_type, amount, actor_account_id, correlation_id)
           VALUES ($1, $2, 'received', 1955.8300, $3, $4)`,
          [advanceEntryId, advanceId, accountId, `eur-migration-${advanceEntryId}`],
        );
        await database.query(
          `INSERT INTO pos.loyalty_programs
             (id, code, name, earn_points_per_bgn, redemption_value_bgn,
              valid_from, created_by, updated_by)
           VALUES ($1, $2, 'EUR migration QA', 1, 1.9558, CURRENT_DATE, $3, $3)`,
          [loyaltyProgramId, `EUR-QA-${loyaltyProgramId.slice(0, 8)}`, accountId],
        );
        await database.query(
          `INSERT INTO crm.opportunities
             (id, opportunity_number, customer_partner_id, title,
              estimated_revenue_bgn, probability_percent, owner_account_id,
              created_by, updated_by)
           VALUES ($1, $2, $3, 'EUR migration QA', 1955.83, 50, $4, $4, $4)`,
          [opportunityId, `EUR-QA-${opportunityId.slice(0, 8)}`, partnerId, accountId],
        );

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
        expect(await migrateUp(database, directory)).toEqual(migrationRange);
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

        const converted = await database.query(
          `SELECT terms.credit_limit_eur::text AS credit_limit_eur,
                  advance.currency_code,
                  advance.amount::text AS advance_amount,
                  entry.amount::text AS advance_entry_amount,
                  loyalty.earn_points_per_eur,
                  loyalty.redemption_value_eur::text AS redemption_value_eur,
                  opportunity.estimated_revenue_eur::text AS estimated_revenue_eur
           FROM sales.customer_payment_terms terms
           JOIN finance.customer_advances advance ON advance.customer_partner_id = terms.customer_partner_id
           JOIN finance.customer_advance_entries entry ON entry.advance_id = advance.id
           JOIN pos.loyalty_programs loyalty ON loyalty.created_by = terms.created_by
           JOIN crm.opportunities opportunity ON opportunity.customer_partner_id = terms.customer_partner_id
           WHERE advance.id = $1 AND entry.id = $2 AND loyalty.id = $3 AND opportunity.id = $4`,
          [advanceId, advanceEntryId, loyaltyProgramId, opportunityId],
        );
        expect(converted.rows).toEqual([
          {
            credit_limit_eur: '1000.0000',
            currency_code: 'EUR',
            advance_amount: '1000.0000',
            advance_entry_amount: '1000.0000',
            earn_points_per_eur: 2,
            redemption_value_eur: '1.0000',
            estimated_revenue_eur: '1000.00',
          },
        ]);
        const convertedDocument = await database.query(
          `SELECT currency_code, exchange_rate::text, rate_source,
                  net_total::text, vat_total::text, gross_total::text,
                  eur_net_total::text, eur_vat_total::text, eur_gross_total::text
           FROM finance.financial_documents WHERE id = $1`,
          [financialDocumentId],
        );
        expect(convertedDocument.rows).toEqual([
          {
            currency_code: 'EUR',
            exchange_rate: '1.00000000',
            rate_source: 'internal_eur',
            net_total: '100.0000',
            vat_total: '20.0000',
            gross_total: '120.0000',
            eur_net_total: '100.0000',
            eur_vat_total: '20.0000',
            eur_gross_total: '120.0000',
          },
        ]);
        await expect(
          database.query(
            "UPDATE finance.customer_advances SET currency_code = 'BGN' WHERE id = $1",
            [advanceId],
          ),
        ).rejects.toThrow();

        expect(await migrateUp(database, directory)).toEqual([]);
        await database.query('DELETE FROM crm.opportunities WHERE id = $1', [opportunityId]);
        await database.query('DELETE FROM finance.financial_documents WHERE id = $1', [
          financialDocumentId,
        ]);
        await database.query(
          'DELETE FROM sales.customer_payment_terms WHERE customer_partner_id = $1',
          [partnerId],
        );
        await database.query('DELETE FROM pos.loyalty_programs WHERE id = $1', [loyaltyProgramId]);
        await database.query(
          'ALTER TABLE finance.customer_advance_entries DISABLE TRIGGER customer_advance_entries_append_only',
        );
        await database.query('DELETE FROM finance.customer_advance_entries WHERE id = $1', [
          advanceEntryId,
        ]);
        await database.query(
          'ALTER TABLE finance.customer_advance_entries ENABLE TRIGGER customer_advance_entries_append_only',
        );
        await database.query('DELETE FROM finance.customer_advances WHERE id = $1', [advanceId]);
        await database.query('DELETE FROM master_data.partners WHERE id = $1', [partnerId]);
        await database.query('DELETE FROM organization.business_locations WHERE id = $1', [
          locationId,
        ]);
        await database.query('DELETE FROM organization.branches WHERE id = $1', [branchId]);
        await database.query('DELETE FROM organization.legal_entities WHERE id = $1', [
          legalEntityId,
        ]);
        await database.query('DELETE FROM identity.user_accounts WHERE id = $1', [accountId]);
        await database.query('DELETE FROM identity.employees WHERE id = $1', [employeeId]);
        for (const migration of [...migrationRange].reverse()) {
          expect(await migrateDown(database, directory)).toBe(migration);
        }
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
