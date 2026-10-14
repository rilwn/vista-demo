import { HttpStatus, Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ApiErrorException } from '../common/api-error.exception.js';
import { DatabaseService } from '../database/database.service.js';
import { StructuredLogger } from '../logging/structured-logger.service.js';

const bnbRatesUrl =
  'https://www.bnb.bg/Statistics/StExternalSector/StExchangeRates/StERForeignCurrencies/index.htm?download=xml&lang=BG';

export interface FinanceExchangeRate {
  currencyCode: string;
  exchangeRate: string;
  rateDate: string;
  rateSource: 'BNB' | 'internal_eur';
}

export interface ParsedBnbRate {
  currencyCode: string;
  exchangeRate: string;
  rateDate: string;
}

@Injectable()
export class BnbCurrencyRatesService implements OnApplicationBootstrap {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(StructuredLogger) private readonly logger: StructuredLogger,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env['NODE_ENV'] === 'test') return;
    void this.refresh().catch((error: unknown) => {
      this.logger.event('warn', 'finance.bnb-rates.startup-refresh.failed', {
        error: error instanceof Error ? error.message : 'Unknown BNB rate error',
      });
    });
  }

  async refresh(): Promise<{ currencyCount: number; rateDate: string }> {
    const response = await fetch(bnbRatesUrl, {
      headers: { accept: 'application/xml,text/xml;q=0.9,*/*;q=0.5' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`BNB rate feed returned HTTP ${response.status}.`);
    const xml = await response.text();
    if (xml.length > 1_000_000)
      throw new Error('BNB rate feed exceeded the one-megabyte safety limit.');
    const rates = parseBnbRateXml(xml);
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      for (const rate of rates) {
        await client.query(
          `INSERT INTO finance.currency_rates (
             currency_code, rate_date, eur_per_unit, rate_source, imported_at
           ) VALUES ($1,$2,$3,'BNB',now())
           ON CONFLICT (currency_code, rate_date) DO UPDATE
           SET eur_per_unit = EXCLUDED.eur_per_unit,
               imported_at = EXCLUDED.imported_at`,
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

export function parseBnbRateXml(xml: string): ParsedBnbRate[] {
  const normalizedXml = xml.replace(/^\uFEFF/u, '');
  const rates: ParsedBnbRate[] = [];
  const rows = normalizedXml.matchAll(/<ROW>([\s\S]*?)<\/ROW>/giu);
  for (const match of rows) {
    const row = match[1];
    if (!row) continue;
    const currencyCode = xmlValue(row, 'CODE')?.toUpperCase();
    const rawRate = xmlValue(row, 'REVERSERATE');
    const rawDate = xmlValue(row, 'CURR_DATE');
    if (
      !currencyCode ||
      !/^[A-Z]{3}$/u.test(currencyCode) ||
      currencyCode === 'EUR' ||
      currencyCode === 'BGN'
    )
      continue;
    const exchangeRate = rawRate?.replace(',', '.');
    if (!exchangeRate || !/^\d+(?:\.\d{1,8})?$/u.test(exchangeRate) || Number(exchangeRate) <= 0)
      continue;
    const dateMatch = rawDate?.match(/^(\d{2})\.(\d{2})\.(\d{4})$/u);
    if (!dateMatch) continue;
    const rateDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
    if (!isValidIsoDate(rateDate)) continue;
    rates.push({ currencyCode, exchangeRate, rateDate });
  }
  if (rates.length === 0 || rates.some((rate) => rate.rateDate !== rates[0]?.rateDate))
    throw new Error('BNB rate feed contained no consistent, usable rate rows.');
  if (new Set(rates.map((rate) => rate.currencyCode)).size !== rates.length)
    throw new Error('BNB rate feed contains duplicate currency rows.');
  return rates;
}

function xmlValue(xml: string, tag: string): string | undefined {
  const value = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'iu'))?.[1]?.trim();
  return value?.replace(/&amp;/gu, '&').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>');
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
