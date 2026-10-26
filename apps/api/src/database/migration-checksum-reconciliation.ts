import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { appendAuditEvent } from '../audit/audit-writer.js';

// Released 0069 changed only by adding an EUR-rate normalization statement.
// Never accept another version or rerun its lossy currency conversion.
const eurMigration = '0069_eur_transition';
const historicalChecksum = 'a29f4111bc30c5c9098cc77a05311cdfec49e5810529833dc257d3ccede5d6c9';
const canonicalChecksum = '0d68a49b6d175ddfbdb166fae2da8b81a3d02ce40da9311f4979a15f51f46a78';

export function isKnownEquivalentMigration(
  id: string,
  appliedChecksum: string,
  sourceChecksum: string,
): boolean {
  return (
    id === eurMigration &&
    appliedChecksum === historicalChecksum &&
    sourceChecksum === canonicalChecksum
  );
}

export async function reconcileKnownEquivalentMigration(
  client: PoolClient,
  id: string,
  appliedChecksum: string,
  sourceChecksum: string,
): Promise<void> {
  if (!isKnownEquivalentMigration(id, appliedChecksum, sourceChecksum))
    throw new Error(`Applied migration ${id} has been modified`);

  await client.query('BEGIN');
  try {
    const stored = await client.query<{ checksum: string }>(
      'SELECT checksum FROM platform.schema_migrations WHERE id=$1 FOR UPDATE',
      [id],
    );
    if (stored.rows[0]?.checksum !== appliedChecksum)
      throw new Error('Migration history changed during EUR checksum reconciliation');

    // The added UPDATE must already be a no-op. Reject missing/unfinished
    // transitions and unvalidated constraints instead of repairing money.
    const state = await client.query<{ equivalent: boolean }>(`
      SELECT
        (SELECT count(*)=1 FROM platform.currency_transition_runs
          WHERE transition_code='bgn-to-eur-2026-10' AND source_currency='BGN'
            AND target_currency='EUR' AND conversion_rate=1.95583000)
        AND EXISTS (SELECT 1 FROM pg_constraint
          WHERE conrelid='finance.financial_documents'::regclass
            AND conname='finance_document_eur_rate_valid' AND contype='c' AND convalidated)
        AND NOT EXISTS (SELECT 1 FROM finance.financial_documents WHERE currency_code='BGN'
          OR (currency_code='EUR' AND (exchange_rate IS DISTINCT FROM 1
            OR rate_source IS DISTINCT FROM 'internal_eur'))) AS equivalent`);
    if (!state.rows[0]?.equivalent)
      throw new Error(
        'EUR migration checksum cannot be reconciled: transition or EUR-rate state requires review',
      );

    const context = (
      await client.query<{ database_user: string; application_name: string }>(
        "SELECT current_user::text AS database_user,current_setting('application_name') AS application_name",
      )
    ).rows[0]!;
    await appendAuditEvent(client, {
      action: 'database.migration.checksum_reconciled',
      targetType: 'schema_migration',
      correlationId: randomUUID(),
      before: { migrationId: id, checksum: appliedChecksum },
      after: { migrationId: id, checksum: sourceChecksum },
      metadata: {
        databaseUser: context.database_user,
        applicationName: context.application_name,
        sourceRelease: '53374fb',
        reason:
          'Known 0069 EUR normalization release; verified completed conversion and already-normalized EUR rates. No business amounts or rates changed.',
      },
    });
    await client.query('UPDATE platform.schema_migrations SET checksum=$2 WHERE id=$1', [
      id,
      sourceChecksum,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
