import { HttpStatus } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { ApiErrorException } from '../common/api-error.exception.js';

interface NumberScope {
  legalEntityId: string;
  businessLocationId: string;
  cashRegisterId?: string | null;
  operatorId?: string | null;
}

export async function allocateOfficialNumber(
  client: PoolClient,
  scope: NumberScope,
  blockSize: number,
): Promise<{ number: string; seriesId: string }> {
  const scopeKey = [
    scope.legalEntityId,
    scope.businessLocationId,
    scope.cashRegisterId ?? 'general',
    scope.operatorId ?? 'general',
  ].join(':');
  await client.query(
    `INSERT INTO finance.official_number_series (
       scope_key, legal_entity_id, business_location_id, cash_register_id, operator_id
     ) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (scope_key) DO NOTHING`,
    [
      scopeKey,
      scope.legalEntityId,
      scope.businessLocationId,
      scope.cashRegisterId ?? null,
      scope.operatorId ?? null,
    ],
  );
  const series = (
    await client.query<{ id: string; next_value: string; range_end: string }>(
      `SELECT id, next_value::text, range_end::text FROM finance.official_number_series
     WHERE scope_key = $1 FOR UPDATE`,
      [scopeKey],
    )
  ).rows[0];
  if (!series) throw new Error('Official number series is unavailable');
  let next = BigInt(series.next_value);
  if (next > BigInt(series.range_end)) {
    await client.query(
      `INSERT INTO finance.official_document_sequences (legal_entity_id)
       VALUES ($1) ON CONFLICT DO NOTHING`,
      [scope.legalEntityId],
    );
    const global = (
      await client.query<{ next_value: string }>(
        `SELECT next_value::text FROM finance.official_document_sequences
       WHERE legal_entity_id = $1 FOR UPDATE`,
        [scope.legalEntityId],
      )
    ).rows[0];
    next = BigInt(global?.next_value ?? '10000000000');
    if (next > 9999999999n)
      throw new ApiErrorException(
        'FINANCE_OFFICIAL_SEQUENCE_EXHAUSTED',
        'The document number range is exhausted. Contact the system administrator.',
        HttpStatus.CONFLICT,
      );
    const end =
      next + BigInt(blockSize) - 1n > 9999999999n ? 9999999999n : next + BigInt(blockSize) - 1n;
    await client.query(
      'UPDATE finance.official_document_sequences SET next_value = $2 WHERE legal_entity_id = $1',
      [scope.legalEntityId, (end + 1n).toString()],
    );
    await client.query('UPDATE finance.official_number_series SET range_end = $2 WHERE id = $1', [
      series.id,
      end.toString(),
    ]);
  }
  await client.query('UPDATE finance.official_number_series SET next_value = $2 WHERE id = $1', [
    series.id,
    (next + 1n).toString(),
  ]);
  return { number: next.toString().padStart(10, '0'), seriesId: series.id };
}
