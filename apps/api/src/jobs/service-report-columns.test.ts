import 'reflect-metadata';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { serviceReportDefinitionKeys } from '@vista/contracts';
import { serviceReportColumns } from '../service/service-reports.service.js';
import { selectReportColumns } from '../finance/finance-reports.service.js';
import { validateReportColumns } from './finance-report-exports.service.js';
import { renderFinanceReport } from './finance-report-renderer.js';

describe('Service report field selection', () => {
  it.each(serviceReportDefinitionKeys)('validates allowed fields for %s', (key) => {
    const columns = serviceReportColumns(key);
    const selected = columns
      .slice(0, 2)
      .map((column) => column.key)
      .reverse();
    expect(validateReportColumns(key, selected)).toEqual(selected);
    for (const invalid of [[], ['password_hash'], [selected[0]!, selected[0]!]])
      expect(() => validateReportColumns(key, invalid)).toThrow();
  });
  it.each(['csv', 'xlsx', 'pdf'] as const)(
    'renders selected Service fields in %s',
    async (format) => {
      const selected = selectReportColumns(
        {
          columns: serviceReportColumns('service.request-register'),
          rows: [
            {
              requestNumber: 'SR-TEST-001',
              customerName: 'Sample customer',
              totalCostBgn: '120.0000',
            },
          ],
          title: 'Service request register',
          criteria: ['Period: 2026-01-01 to 2026-12-31'],
          generatedAt: '2026-09-08T00:00:00Z',
        },
        ['requestNumber', 'customerName'],
      );
      expect(selected.columns.map((column) => column.label)).toEqual(['Request', 'Customer']);
      const rendered = await renderFinanceReport(format, selected);
      if (format === 'csv') {
        expect(rendered.buffer.toString()).toContain('SR-TEST-001');
        expect(rendered.buffer.toString()).not.toContain('120.00');
      } else if (format === 'xlsx') {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(Uint8Array.from(rendered.buffer).buffer);
        const values: unknown[] = [];
        workbook.worksheets[0]?.eachRow((row) => row.eachCell((cell) => values.push(cell.value)));
        expect(values).toContain('SR-TEST-001');
        expect(values).toContain('Sample customer');
        expect(values).not.toContain('Total BGN');
        expect(values).not.toContain(120);
      } else expect(rendered.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    },
  );
});
