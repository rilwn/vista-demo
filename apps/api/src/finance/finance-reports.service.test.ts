import { describe, expect, it } from 'vitest';

import {
  agingBucket,
  financeReportColumns,
  selectReportColumns,
} from './finance-reports.service.js';
import { financeReportDefinitionKeys } from '@vista/contracts';

describe('Finance report aging buckets', () => {
  it('provides a controlled field catalogue for every Finance report', () => {
    for (const key of financeReportDefinitionKeys) {
      const columns = financeReportColumns(key);
      expect(columns.length).toBeGreaterThan(0);
      expect(new Set(columns.map((column) => column.key)).size).toBe(columns.length);
    }
  });

  it('projects only selected fields while preserving their order and report criteria', () => {
    const data = {
      columns: financeReportColumns('finance.supplier-turnover'),
      rows: [{ partnerName: 'Supplier', grossBgnTotal: '33.0000', documentCount: 1 }],
      criteria: ['Includes prepared documents'],
      generatedAt: '2026-09-07',
      title: 'Supplier turnover',
    };
    expect(selectReportColumns(data, ['grossBgnTotal', 'partnerName'])).toEqual({
      ...data,
      columns: [data.columns[2], data.columns[0]],
      rows: [{ grossBgnTotal: '33.0000', partnerName: 'Supplier' }],
    });
    for (const keys of [[], ['partnerName', 'partnerName'], ['password_hash'], ['__proto__']]) {
      expect(() => selectReportColumns(data, keys)).toThrow();
    }
  });
  it('uses the required inclusive aging boundaries', () => {
    expect(agingBucket(0)).toBe('current');
    expect(agingBucket(1)).toBe('days_0_30');
    expect(agingBucket(30)).toBe('days_0_30');
    expect(agingBucket(31)).toBe('days_31_60');
    expect(agingBucket(60)).toBe('days_31_60');
    expect(agingBucket(61)).toBe('days_61_90');
    expect(agingBucket(90)).toBe('days_61_90');
    expect(agingBucket(91)).toBe('over_90');
  });
});
