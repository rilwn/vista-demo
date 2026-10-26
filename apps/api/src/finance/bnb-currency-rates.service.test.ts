import { describe, expect, it } from 'vitest';

import { parseBnbRateXml } from './bnb-currency-rates.service.js';

describe('parseBnbRateXml', () => {
  it('reads the BNB EUR-per-unit value and publication date', () => {
    const xml = `\uFEFF<?xml version="1.0"?>
      <ROWSET>
        <ROW><CODE>Код</CODE><REVERSERATE>Евро за единица</REVERSERATE><CURR_DATE>Дата</CURR_DATE></ROW>
        <ROW><CODE>USD</CODE><REVERSERATE>0.8938</REVERSERATE><RATE>1.1188</RATE><CURR_DATE>13.10.2026</CURR_DATE></ROW>
        <ROW><CODE>JPY</CODE><REVERSERATE>0.005653</REVERSERATE><RATE>176.91</RATE><CURR_DATE>13.10.2026</CURR_DATE></ROW>
        <ROW><CODE>EUR</CODE><REVERSERATE>1</REVERSERATE><CURR_DATE>13.10.2026</CURR_DATE></ROW>
        <ROW><CODE>BGN</CODE><REVERSERATE>0.5113</REVERSERATE><CURR_DATE>13.10.2026</CURR_DATE></ROW>
      </ROWSET>`;

    expect(parseBnbRateXml(xml)).toEqual([
      { currencyCode: 'USD', exchangeRate: '0.8938', rateDate: '2026-10-13' },
      { currencyCode: 'JPY', exchangeRate: '0.005653', rateDate: '2026-10-13' },
    ]);
  });

  it('rejects empty, inconsistent, malformed, and duplicate rate payloads', () => {
    expect(() => parseBnbRateXml('<ROWSET/>')).toThrow('ROWSET');
    expect(() =>
      parseBnbRateXml(
        '<ROWSET><ROW><CODE>USD</CODE><REVERSERATE>0.9</REVERSERATE><CURR_DATE>13.10.2026</CURR_DATE></ROW><ROW><CODE>GBP</CODE><REVERSERATE>1.1</REVERSERATE><CURR_DATE>14.10.2026</CURR_DATE></ROW></ROWSET>',
      ),
    ).toThrow('no consistent, usable rate rows');
    expect(() =>
      parseBnbRateXml(
        '<ROWSET><ROW><CODE>USD</CODE><REVERSERATE>0.9</REVERSERATE><CURR_DATE>13.10.2026</CURR_DATE></ROW><ROW><CODE>USD</CODE><REVERSERATE>0.91</REVERSERATE><CURR_DATE>13.10.2026</CURR_DATE></ROW></ROWSET>',
      ),
    ).toThrow('duplicate currency rows');
    expect(() =>
      parseBnbRateXml(
        '<ROWSET><ROW><CODE>USD</CODE><REVERSERATE>0.9</REVERSERATE><CURR_DATE>31.02.2026</CURR_DATE></ROW></ROWSET>',
      ),
    ).toThrow('invalid currency rate or publication date');
  });
});
