import { afterEach, describe, expect, it, vi } from 'vitest';
import { bnbRatesUrl, downloadBnbRateFeed, parseBnbRateXml } from './bnb-rate-feed.js';

// Published EUR-per-unit values/direction on BNB's official 23 October page.
const row = (code: string, rate: string, date = '23.10.2026') =>
  `<ROW><CODE>${code}</CODE><REVERSERATE>${rate}</REVERSERATE><CURR_DATE>${date}</CURR_DATE></ROW>`;
const xml = `<ROWSET>${row('USD', '0.8934')}${row('JPY', '0.005698')}</ROWSET>`;
afterEach(() => vi.unstubAllGlobals());

describe('BNB published feed transport and validation', () => {
  it('uses the advertised HTTPS XML link and preserves EUR-per-unit precision', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(xml, { headers: { 'content-type': 'text/xml' } }));
    vi.stubGlobal('fetch', request);
    expect(await downloadBnbRateFeed()).toEqual([
      { currencyCode: 'USD', exchangeRate: '0.8934', rateDate: '2026-10-23' },
      { currencyCode: 'JPY', exchangeRate: '0.005698', rateDate: '2026-10-23' },
    ]);
    expect(request).toHaveBeenCalledOnce();
    const [url, options] = request.mock.calls[0]!;
    expect(url).toBe(bnbRatesUrl);
    expect(options?.redirect).toBe('error');
    expect(new Headers(options?.headers).get('user-agent')).toContain('Vista/');
    expect(bnbRatesUrl).toContain('&search=');
  });
  it('identifies a 200 HTML access-error page without echoing its body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<!DOCTYPE html><html><body>Error: private-provider-content</body></html>', {
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );
    await expect(downloadBnbRateFeed()).rejects.toMatchObject({ code: 'BNB_RATE_FEED_NOT_XML' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>private-provider-content</html>')),
    );
    await expect(downloadBnbRateFeed()).rejects.not.toThrow('private-provider-content');
  });
  it('rejects malformed, partial and pre-EUR feeds rather than importing their valid subset', () => {
    for (const body of [
      `<ROWSET>${row('USD', '0.8934')}${row('GBP', 'bad')}</ROWSET>`,
      `<ROWSET>${row('USD', '0.8934')}${row('US', '0.9')}</ROWSET>`,
      `<ROWSET>${row('USD', '0.8934')}<ROW><CODE>GBP</CODE></ROWSET>`,
      `<ROWSET>${row('USD', '0.8934')}</ROWSET><ROWSET></ROWSET>`,
      `<ROWSET>${row('USD', '0.9', '23.10.2025')}</ROWSET>`,
      `<ROWSET>${row('USD', '0')}</ROWSET>`,
      `<ROWSET>${row('USD', '-0.9')}</ROWSET>`,
      `<ROWSET>${row('USD', '0.123456789')}</ROWSET>`,
      `<ROWSET>${row('USD', '99999999999')}</ROWSET>`,
      `<ROWSET>${row('USD', '0.9').replace('</CODE>', '</CODE><CODE>GBP</CODE>')}</ROWSET>`,
      '<!DOCTYPE ROWSET [<!ENTITY x SYSTEM "file:///private">]><ROWSET></ROWSET>',
    ])
      expect(() => parseBnbRateXml(body)).toThrow();
  });
  it('accepts the header/BOM and row attributes but retains decimal strings, not reciprocal floats', () => {
    expect(
      parseBnbRateXml(`\uFEFF<?xml version="1.0"?><ROWSET>
      <ROW><CODE>Код</CODE><REVERSERATE>Евро за единица</REVERSERATE><CURR_DATE>Дата</CURR_DATE></ROW>
      ${row('GBP', '1,1943').replace('<ROW>', '<ROW id="GBP">')}
      </ROWSET>`),
    ).toEqual([{ currencyCode: 'GBP', exchangeRate: '1.1943', rateDate: '2026-10-23' }]);
  });
  it('rejects declared and streamed oversized payloads, including multibyte text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('tiny', { headers: { 'content-length': '1000001' } })),
    );
    await expect(downloadBnbRateFeed()).rejects.toMatchObject({ code: 'BNB_RATE_FEED_TOO_LARGE' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('б'.repeat(500001))));
    await expect(downloadBnbRateFeed()).rejects.toMatchObject({ code: 'BNB_RATE_FEED_TOO_LARGE' });
  });
  it('reports HTTP failures, aborted downloads and invalid XML safely', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('private response', { status: 503 })),
    );
    await expect(downloadBnbRateFeed()).rejects.toMatchObject({
      code: 'BNB_RATE_FEED_UNAVAILABLE',
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private network details')));
    await expect(downloadBnbRateFeed()).rejects.toMatchObject({
      code: 'BNB_RATE_FEED_UNAVAILABLE',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<ROWSET/>')));
    await expect(downloadBnbRateFeed()).rejects.toMatchObject({ code: 'BNB_RATE_FEED_INVALID' });
  });
});
