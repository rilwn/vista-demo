import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import type { StructuredLogger } from '../logging/structured-logger.service.js';
import { BnbCurrencyRatesService } from './bnb-currency-rates.service.js';

const xml =
  '<ROWSET><ROW><CODE>USD</CODE><REVERSERATE>0.8934</REVERSERATE><CURR_DATE>23.10.2026</CURR_DATE></ROW></ROWSET>';
afterEach(() => vi.unstubAllGlobals());
describe('safe BNB rate refresh', () => {
  function subject() {
    const query = vi
      .fn<
        (
          sql: string,
          values?: unknown[],
        ) => Promise<{ rows: { eur_per_unit: string; rate_date: string }[] }>
      >()
      .mockResolvedValue({ rows: [] });
    const release = vi.fn();
    const connect = vi.fn().mockResolvedValue({ query, release });
    const getPool = vi.fn().mockReturnValue({ connect, query });
    const event = vi.fn();
    return {
      service: new BnbCurrencyRatesService(
        { getPool } as unknown as DatabaseService,
        { event } as unknown as StructuredLogger,
      ),
      query,
      release,
      connect,
      getPool,
      event,
    };
  }
  it('does not open a database transaction for blocked HTML and still serves EUR', async () => {
    const test = subject();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Access denied</html>')));
    await expect(test.service.refresh()).rejects.toMatchObject({ code: 'BNB_RATE_FEED_NOT_XML' });
    expect(test.getPool).not.toHaveBeenCalled();
    await expect(test.service.rate('EUR', '2026-10-26')).resolves.toMatchObject({
      exchangeRate: '1.00000000',
      rateSource: 'internal_eur',
    });
    expect(test.getPool).not.toHaveBeenCalled();
    expect(test.event).toHaveBeenCalledWith(
      'warn',
      'finance.bnb-rates.refresh.failed',
      expect.objectContaining({ code: 'BNB_RATE_FEED_NOT_XML' }),
    );
  });
  it('writes only a validated feed and retains the same-date no-op predicate', async () => {
    const test = subject();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(xml)));
    await expect(test.service.refresh()).resolves.toEqual({
      currencyCount: 1,
      rateDate: '2026-10-23',
    });
    expect(test.query.mock.calls.map((call) => call[0])).toEqual([
      'BEGIN',
      expect.stringContaining('IS DISTINCT FROM EXCLUDED.eur_per_unit'),
      'COMMIT',
    ]);
    expect(test.query.mock.calls[1]?.[1]).toEqual(['USD', '2026-10-23', '0.8934']);
    expect(test.release).toHaveBeenCalledOnce();
  });
  it('rolls back a failed rate write and never logs completion', async () => {
    const test = subject();
    test.query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error('write failed'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(xml)));
    await expect(test.service.refresh()).rejects.toThrow('write failed');
    expect(test.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(test.event).not.toHaveBeenCalledWith(
      'info',
      'finance.bnb-rates.refresh.completed',
      expect.anything(),
    );
    expect(test.release).toHaveBeenCalledOnce();
  });
  it('keeps the actual cached publication date and refuses a missing foreign rate', async () => {
    const test = subject();
    test.query.mockResolvedValueOnce({
      rows: [{ eur_per_unit: '0.89340000', rate_date: '2026-10-23' }],
    });
    await expect(test.service.rate('USD', '2026-10-26')).resolves.toMatchObject({
      rateDate: '2026-10-23',
      exchangeRate: '0.89340000',
    });
    await expect(test.service.rate('USD', '2026-10-26')).rejects.toHaveProperty(
      'response.code',
      'FINANCE_BNB_RATE_UNAVAILABLE',
    );
  });
});
