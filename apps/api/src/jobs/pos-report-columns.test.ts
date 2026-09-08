import 'reflect-metadata';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { posReportDefinitionKeys } from '@vista/contracts';
import { posReportColumns } from '../pos/pos-reports.service.js';
import { selectReportColumns } from '../finance/finance-reports.service.js';
import { validateReportColumns } from './finance-report-exports.service.js';
import { renderFinanceReport } from './finance-report-renderer.js';

describe('POS report field selection', () => {
  it('keeps X and Z report totals complete', () => {
    expect(() => validateReportColumns('pos.x-report', ['shiftNumber'])).toThrow();
    expect(() => validateReportColumns('pos.z-report', ['shiftNumber'])).toThrow();
  });
  it.each(
    posReportDefinitionKeys.filter((key) => key !== 'pos.x-report' && key !== 'pos.z-report'),
  )('validates allowed fields for %s', (key) => {
    const columns = posReportColumns(key);
    const selected = columns
      .slice(0, 2)
      .map((column) => column.key)
      .reverse();
    expect(validateReportColumns(key, selected)).toEqual(selected);
    for (const invalid of [[], ['password_hash'], [selected[0]!, selected[0]!]])
      expect(() => validateReportColumns(key, invalid)).toThrow();
  });
  it.each(['csv', 'xlsx', 'pdf'] as const)('renders selected POS fields in %s', async (format) => {
    const selected = selectReportColumns(
      {
        columns: posReportColumns('pos.product-sales'),
        rows: [
          {
            productName: 'Sample product',
            quantitySold: 7,
            netRevenueBgn: '120.0000',
          },
        ],
        title: 'POS product sales',
        criteria: ['Period: 2026-01-01 to 2026-12-31'],
        generatedAt: '2026-09-08T00:00:00Z',
      },
      ['productName', 'quantitySold'],
    );
    expect(selected.columns.map((column) => column.label)).toEqual(['Product', 'Quantity sold']);
    const rendered = await renderFinanceReport(format, selected);
    if (format === 'csv') {
      expect(rendered.buffer.toString()).toContain('Sample product');
      expect(rendered.buffer.toString()).not.toContain('120.00');
    } else if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Uint8Array.from(rendered.buffer).buffer);
      const values: unknown[] = [];
      workbook.worksheets[0]?.eachRow((row) => row.eachCell((cell) => values.push(cell.value)));
      expect(values).toContain('Sample product');
      expect(values).toContain(7);
      expect(values).not.toContain('Net revenue BGN');
      expect(values).not.toContain(120);
    } else expect(rendered.buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
