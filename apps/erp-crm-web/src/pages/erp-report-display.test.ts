import { describe, expect, it } from 'vitest';
import {
  defaultReportColumns,
  isReportUuid,
  reportDate,
  reportDecimal,
} from './erp-report-display';
import type { ErpReportDefinition } from '@vista/contracts';

describe('Report display', () => {
  it('formats decimal strings without losing large values or fractional precision', () => {
    expect(reportDecimal('12345678901234567890.1250', true)).toBe('12,345,678,901,234,567,890.125');
    expect(reportDecimal('-1234.0000', true)).toBe('-1,234.00');
    expect(reportDecimal('1.2500', false)).toBe('1.25');
    expect(reportDecimal('0.0000', false)).toBe('0');
    expect(reportDecimal('unavailable', true)).toBe('unavailable');
  });
  it('formats dates and identifies only complete UUID references', () => {
    expect(reportDate('2026-09-08')).toBe('8 Sept 2026');
    expect(isReportUuid('98765432-1234-4567-89ab-123456789abc')).toBe(true);
    expect(isReportUuid('PO-2026-000001')).toBe(false);
  });
  it('starts with a focused view without removing any available fields', () => {
    const keys = [
      'supplier',
      'product',
      'ordered',
      'received',
      'invoiced',
      'status',
      'order',
      'warehouse',
      'price',
      'currency',
    ];
    const definition: ErpReportDefinition = {
      key: 'procurement.order-comparison',
      name: 'Purchase order comparison',
      description: '',
      formats: ['csv'],
      requiresDateRange: true,
      columns: keys.map((key) => ({ key, label: key, type: 'text' })),
    };
    expect(defaultReportColumns(definition)).toEqual(keys.slice(0, 7));
    expect(definition.columns).toHaveLength(10);
  });
});
