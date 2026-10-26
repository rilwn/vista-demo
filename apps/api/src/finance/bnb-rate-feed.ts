export const bnbRatesUrl =
  'https://www.bnb.bg/Statistics/StExternalSector/StExchangeRates/StERForeignCurrencies/index.htm?download=xml&lang=BG&search=';
const maximumFeedBytes = 1_000_000;

export interface ParsedBnbRate {
  currencyCode: string;
  exchangeRate: string;
  rateDate: string;
}

export class BnbRateFeedError extends Error {
  constructor(
    readonly code:
      | 'BNB_RATE_FEED_UNAVAILABLE'
      | 'BNB_RATE_FEED_NOT_XML'
      | 'BNB_RATE_FEED_INVALID'
      | 'BNB_RATE_FEED_TOO_LARGE',
    message: string,
  ) {
    super(message);
    this.name = 'BnbRateFeedError';
  }
}

export async function downloadBnbRateFeed(): Promise<ParsedBnbRate[]> {
  let response: Response;
  try {
    response = await fetch(bnbRatesUrl, {
      headers: {
        accept: 'application/xml,text/xml;q=0.9',
        'user-agent': 'Vista/0.1 (BNB exchange-rate import)',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new BnbRateFeedError(
      'BNB_RATE_FEED_UNAVAILABLE',
      'The BNB exchange-rate download failed or timed out. Existing rates are unchanged.',
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new BnbRateFeedError(
      'BNB_RATE_FEED_UNAVAILABLE',
      `The BNB exchange-rate download returned HTTP ${response.status}. Existing rates are unchanged.`,
    );
  }
  if (Number(response.headers.get('content-length') ?? 0) > maximumFeedBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw oversized();
  }
  const reader = response.body?.getReader();
  if (!reader)
    throw new BnbRateFeedError(
      'BNB_RATE_FEED_INVALID',
      'The BNB exchange-rate feed was empty. Existing rates are unchanged.',
    );
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let xml = '',
    bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maximumFeedBytes) {
        await reader.cancel().catch(() => undefined);
        throw oversized();
      }
      xml += decoder.decode(next.value, { stream: true });
    }
    xml += decoder.decode();
  } catch (error) {
    if (error instanceof BnbRateFeedError) throw error;
    throw new BnbRateFeedError(
      'BNB_RATE_FEED_UNAVAILABLE',
      'The BNB exchange-rate download was interrupted or unreadable. Existing rates are unchanged.',
    );
  } finally {
    reader.releaseLock();
  }
  if (/<(?:!doctype\s+html|html)\b/iu.test(xml))
    throw new BnbRateFeedError(
      'BNB_RATE_FEED_NOT_XML',
      'BNB returned an HTML page instead of exchange-rate XML. Check provider access from this host. Existing rates are unchanged.',
    );
  try {
    return parseBnbRateXml(xml);
  } catch {
    throw new BnbRateFeedError(
      'BNB_RATE_FEED_INVALID',
      'The BNB XML contains invalid or inconsistent currency rates. Existing rates are unchanged.',
    );
  }
}

function oversized() {
  return new BnbRateFeedError(
    'BNB_RATE_FEED_TOO_LARGE',
    'The BNB exchange-rate feed exceeded the one-megabyte safety limit. Existing rates are unchanged.',
  );
}

export function parseBnbRateXml(xml: string): ParsedBnbRate[] {
  const normalized = xml
    .replace(/^\uFEFF/u, '')
    .trim()
    .replace(/^<\?xml\s[\s\S]*?\?>\s*/iu, '');
  const root = /^<ROWSET(?:\s[^>]*)?>([\s\S]*)<\/ROWSET>$/iu.exec(normalized);
  if (/<!DOCTYPE|<!ENTITY/iu.test(normalized) || !root)
    throw new Error('BNB rate feed must be a ROWSET XML document without external declarations.');
  const body = root[1]!;
  const rowPattern = /<ROW(?:\s[^>]*)?>([\s\S]*?)<\/ROW>/giu;
  // Never silently accept the valid rows of a truncated or miswrapped feed.
  if (body.replace(rowPattern, '').trim())
    throw new Error('BNB rate feed contains incomplete or unexpected rows.');
  const rates: ParsedBnbRate[] = [];
  let rowIndex = 0;
  for (const match of body.matchAll(rowPattern)) {
    const row = match[1]!;
    const code = xmlValue(row, 'CODE')?.toUpperCase();
    const rawRate = xmlValue(row, 'REVERSERATE');
    const rawDate = xmlValue(row, 'CURR_DATE');
    const firstRow = rowIndex++ === 0;
    if (code === 'EUR' || code === 'BGN') continue;
    if (!code || !/^[A-Z]{3}$/u.test(code)) {
      if (firstRow && !/^\d/u.test(rawRate ?? '') && !/^\d/u.test(rawDate ?? '')) continue;
      throw new Error('BNB rate feed contains an invalid currency code.');
    }
    const exchangeRate = rawRate?.replace(',', '.');
    const date = rawDate?.match(/^(\d{2})\.(\d{2})\.(\d{4})$/u);
    const rateDate = date ? `${date[3]}-${date[2]}-${date[1]}` : '';
    if (
      !exchangeRate ||
      !/^\d{1,10}(?:\.\d{1,8})?$/u.test(exchangeRate) ||
      !/[1-9]/u.test(exchangeRate) ||
      !isValidIsoDate(rateDate) ||
      rateDate < '2026-01-01'
    )
      throw new Error('BNB rate feed contains an invalid currency rate or publication date.');
    rates.push({ currencyCode: code, exchangeRate, rateDate });
  }
  if (!rates.length || rates.some((rate) => rate.rateDate !== rates[0]?.rateDate))
    throw new Error('BNB rate feed contained no consistent, usable rate rows.');
  if (new Set(rates.map((rate) => rate.currencyCode)).size !== rates.length)
    throw new Error('BNB rate feed contains duplicate currency rows.');
  return rates;
}

function xmlValue(xml: string, tag: string): string | undefined {
  const matches = [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'giu'))];
  if (matches.length > 1) throw new Error('BNB rate feed contains duplicate fields.');
  return matches[0]?.[1]
    ?.trim()
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>');
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
