import { describe, expect, it, vi } from 'vitest';
import type { AppEnvironment } from '@vista/config';
import type { DatabaseService } from '../database/database.service.js';
import { ErpReportDataService } from './erp-report-data.service.js';

function fixture(total: number) {
  const query = vi.fn((sql: string) => {
    if (sql.startsWith('SELECT count')) return Promise.resolve({ rows: [{ total }] });
    if (sql.startsWith('SELECT *'))
      return Promise.resolve({ rows: [{ _id: 'internal', code: 'ROW-001' }] });
    if (sql.startsWith('SELECT now'))
      return Promise.resolve({ rows: [{ generated: '2026-09-10T10:00:00Z' }] });
    return Promise.resolve({ rows: [] });
  });
  const release = vi.fn();
  const database = {
    getPool: () => ({ connect: () => Promise.resolve({ query, release }) }),
  } as unknown as DatabaseService;
  const service = new ErpReportDataService(database, {
    BUSINESS_TIMEZONE: 'Europe/Sofia',
  } as AppEnvironment);
  return { service, query, release };
}

describe('ERP report data bounds and snapshot safety', () => {
  it('rejects an oversized export before fetching rows and releases the connection', async () => {
    const { service, query, release } = fixture(100001);
    await expect(service.exportData('warehouse.stock-balances', {})).rejects.toMatchObject({
      message: 'Narrow the dates or search to export fewer than 100,001 rows.',
    });
    expect(query.mock.calls.some(([sql]) => sql.startsWith('SELECT *'))).toBe(false);
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });

  it('allows bounded previews of larger datasets, binds search and omits internal row keys', async () => {
    const { service, query, release } = fixture(100001);
    const search = "'; DROP TABLE reports; --";
    const result = await service.read('warehouse.stock-balances', { search }, 2);
    expect(query).toHaveBeenCalledWith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('LIMIT $5 OFFSET $6'), [
      null,
      null,
      'Europe/Sofia',
      search,
      25,
      25,
    ]);
    expect(query.mock.calls.some(([sql]) => sql.includes(search))).toBe(false);
    expect(result).toMatchObject({
      page: 2,
      total: 100001,
      totalPages: 4001,
      rows: [{ code: 'ROW-001' }],
    });
    expect(query).toHaveBeenLastCalledWith('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('permits the exact export limit and rolls back database failures', async () => {
    const { service, query, release } = fixture(100000);
    await expect(service.exportData('warehouse.stock-balances', {})).resolves.toMatchObject({
      rows: [{ code: 'ROW-001' }],
    });
    query.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(service.read('warehouse.stock-balances', {})).rejects.toThrow(
      'Database unavailable',
    );
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledTimes(2);
  });
});
