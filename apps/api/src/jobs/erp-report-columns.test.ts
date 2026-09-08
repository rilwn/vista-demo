import { describe, expect, it } from 'vitest';
import { erpReportDefinitionKeys } from '@vista/contracts';
import { erpReportDefinitions, erpReportColumns, erpReportSql } from './erp-report-definitions.js';
import { validateReportColumns, reportFilters } from './finance-report-exports.service.js';
import { renderFinanceReport } from './finance-report-renderer.js';
import { selectReportColumns } from '../finance/finance-reports.service.js';

describe('ERP report catalogue and exports', () => {
  it('covers the ten reviewed reports without duplicate fields or arbitrary SQL', () => {
    const definitions = erpReportDefinitions();
    expect(definitions.map((d) => d.key)).toEqual([...erpReportDefinitionKeys]);
    for (const d of definitions) {
      expect(new Set(d.columns!.map((c) => c.key)).size).toBe(d.columns!.length);
      expect(d.formats).toEqual(['csv', 'xlsx', 'pdf']);
      expect(erpReportSql(d.key)).toContain('jsonb_each_text');
    }
    expect(() => erpReportColumns('finance.fake' as never)).toThrow();
  });
  it.each(erpReportDefinitionKeys)('validates field selections for %s', (key) => {
    const columns = erpReportColumns(key);
    expect(validateReportColumns(key, [columns[0]!.key])).toEqual([columns[0]!.key]);
    expect(() => validateReportColumns(key, [])).toThrow();
    expect(() => validateReportColumns(key, ['password_hash'])).toThrow();
    expect(() => validateReportColumns(key, [columns[0]!.key, columns[0]!.key])).toThrow();
  });
  it('keeps searches literal and distinguishes current-state from date reports', () => {
    expect(
      reportFilters(
        { definitionKey: 'warehouse.stock-balances', format: 'csv', search: ' 100%_stock ' },
        'warehouse.stock-balances',
      ),
    ).toEqual({ search: '100%_stock' });
    expect(() =>
      reportFilters(
        { definitionKey: 'warehouse.stock-balances', format: 'csv', dateFrom: '2026-01-01' },
        'warehouse.stock-balances',
      ),
    ).toThrow();
    expect(() =>
      reportFilters(
        { definitionKey: 'sales.quotation-register', format: 'csv' },
        'sales.quotation-register',
      ),
    ).toThrow();
  });
  it.each(['csv', 'xlsx', 'pdf'] as const)('renders selected ERP columns in %s', async (format) => {
    const definition = erpReportDefinitions()[0]!;
    const data = {
      columns: definition.columns!,
      rows: [{ order: '=TEST()', supplier: 'Vista', product: 'Device' }],
      criteria: [definition.description],
      generatedAt: '2026-09-08T10:00:00Z',
      title: definition.name,
    };
    const selected = selectReportColumns(data, ['supplier', 'product']);
    const result = await renderFinanceReport(format, selected);
    expect(result.buffer.length).toBeGreaterThan(50);
    if (format === 'csv') {
      expect(result.buffer.toString()).toContain('Supplier,Product');
      expect(result.buffer.toString()).not.toContain('=TEST()');
    }
  });
});
import 'reflect-metadata';
