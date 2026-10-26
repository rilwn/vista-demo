import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ApiErrorException } from '../common/api-error.exception.js';
import { DatabaseService } from '../database/database.service.js';
import { StructuredLogger } from '../logging/structured-logger.service.js';

import {
  BnbRateFeedError,
  downloadBnbRateFeed,
  isValidIsoDate,
  type ParsedBnbRate,
} from './bnb-rate-feed.js';
export { parseBnbRateXml, type ParsedBnbRate } from './bnb-rate-feed.js';

export interface FinanceExchangeRate {
  currencyCode: string;
  exchangeRate: string;
  rateDate: string;
  rateSource: 'BNB' | 'internal_eur';
}

@Injectable()
export class BnbCurrencyRatesService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(StructuredLogger) private readonly logger: StructuredLogger,
  ) {}

  async refresh(): Promise<{ currencyCount: number; rateDate: string }> {
    let rates: ParsedBnbRate[];
    try {
      rates = await downloadBnbRateFeed();
    } catch (error) {
      this.logger.event('warn', 'finance.bnb-rates.refresh.failed', {
        code: error instanceof BnbRateFeedError ? error.code : 'BNB_RATE_FEED_UNAVAILABLE',
        error: error instanceof Error ? error.message : 'The BNB rate download failed.',
      });
      throw error;
    }
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      for (const rate of [...rates].sort((a, b) => a.currencyCode.localeCompare(b.currencyCode))) {
        await client.query(
          `INSERT INTO finance.currency_rates (
             currency_code, rate_date, eur_per_unit, rate_source, imported_at
           ) VALUES ($1,$2,$3,'BNB',now())
           ON CONFLICT (currency_code, rate_date) DO UPDATE
           SET eur_per_unit = EXCLUDED.eur_per_unit,
               imported_at = EXCLUDED.imported_at
           WHERE finance.currency_rates.eur_per_unit IS DISTINCT FROM EXCLUDED.eur_per_unit`,
          [rate.currencyCode, rate.rateDate, rate.exchangeRate],
        );
      }
      await client.query('COMMIT');
      this.logger.event('info', 'finance.bnb-rates.refresh.completed', {
        currencyCount: rates.length,
        rateDate: rates[0]?.rateDate,
      });
      return { currencyCount: rates.length, rateDate: rates[0]!.rateDate };
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.event('error', 'finance.bnb-rates.refresh.failed', {
        error: error instanceof Error ? error.message : 'Unknown BNB rate error',
      });
      throw error;
    } finally {
      client.release();
    }
  }

  async rate(currencyCode: string, rateDate: string): Promise<FinanceExchangeRate> {
    const code = currencyCode.trim().toUpperCase();
    if (!/^[A-Z]{3}$/u.test(code) || code === 'BGN')
      throw new ApiErrorException(
        'FINANCE_CURRENCY_INVALID',
        'Choose a supported three-letter currency code.',
        HttpStatus.BAD_REQUEST,
      );
    if (!isValidIsoDate(rateDate))
      throw new ApiErrorException(
        'FINANCE_RATE_DATE_INVALID',
        'Enter a valid rate date.',
        HttpStatus.BAD_REQUEST,
      );
    if (code === 'EUR')
      return {
        currencyCode: code,
        exchangeRate: '1.00000000',
        rateDate,
        rateSource: 'internal_eur',
      };
    const result = await this.database.getPool().query<{
      eur_per_unit: string;
      rate_date: string;
    }>(
      `SELECT eur_per_unit::text, rate_date::text
       FROM finance.currency_rates
       WHERE currency_code = $1 AND rate_date <= $2::date
       ORDER BY rate_date DESC
       LIMIT 1`,
      [code, rateDate],
    );
    const stored = result.rows[0];
    if (!stored)
      throw new ApiErrorException(
        'FINANCE_BNB_RATE_UNAVAILABLE',
        'No Bulgarian National Bank rate is available on or before this date. Refresh rates or choose a later date.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    return {
      currencyCode: code,
      exchangeRate: stored.eur_per_unit,
      rateDate: stored.rate_date,
      rateSource: 'BNB',
    };
  }

  async latestRate(currencyCode: string, rateDate: string): Promise<FinanceExchangeRate> {
    return this.rate(currencyCode, rateDate);
  }
}
