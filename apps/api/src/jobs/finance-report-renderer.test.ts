import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import type { FinanceReportExportData } from '../finance/finance-reports.service.js';
import { renderFinanceReport } from './finance-report-renderer.js';
import { selectReportColumns } from '../finance/finance-reports.service.js';

const report: FinanceReportExportData = {
  columns: [
    { key: 'partner', label: 'Partner', type: 'text' },
    { key: 'documentCount', label: 'Documents', type: 'number' },
    { key: 'amount', label: 'Outstanding BGN', type: 'money' },
  ],
  criteria: ['Period: 2026-08-01 to 2026-08-25', 'Currency: BGN'],
  generatedAt: '2026-08-25T10:30:00.000Z',
  rows: [
    { amount: '60.0000', documentCount: 1, partner: 'Алфа Маркет ООД' },
    { amount: '12.5000', documentCount: 2, partner: '=unsafe spreadsheet text' },
  ],
  title: 'Customer turnover',
};

describe('Finance report renderer', () => {
  it('preserves fractional quantities and prices in Excel numeric cells', async () => {
    const output = await renderFinanceReport('xlsx', {
      ...report,
      rows: [{ partner: 'Fractional item', documentCount: '1.2500', amount: '60.00' }],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(output.buffer).buffer);
    expect(workbook.worksheets[0]?.getCell('B7').value).toBe(1.25);
    expect(workbook.worksheets[0]?.getCell('B7').numFmt).toBe('0.####');
  });
  it.each(['csv', 'xlsx', 'pdf'] as const)('renders a selected-field %s report', async (format) => {
    const selected = selectReportColumns(report, ['amount']);
    const output = await renderFinanceReport(format, selected);
    expect(output.buffer.length).toBeGreaterThan(0);
    if (format === 'csv') {
      expect(output.buffer.toString('utf8')).toContain('Outstanding BGN');
      expect(output.buffer.toString('utf8')).not.toContain('Алфа Маркет');
    }
    if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Uint8Array.from(output.buffer).buffer);
      expect(workbook.worksheets[0]?.getCell('A7').value).toBe(60);
      expect(workbook.worksheets[0]?.getCell('B7').value).toBeNull();
    }
  });
  it('creates an Excel-safe UTF-8 CSV export', async () => {
    const output = await renderFinanceReport('csv', report);
    const content = output.buffer.toString('utf8');

    expect(output.mediaType).toBe('text/csv; charset=utf-8');
    expect(content.startsWith('\uFEFF')).toBe(true);
    expect(content).toContain('Алфа Маркет ООД');
    expect(content).toContain("'=unsafe spreadsheet text");
    expect(content).toContain('60.00');
  });

  it('creates a readable Excel workbook with numeric money cells', async () => {
    const output = await renderFinanceReport('xlsx', report);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(output.buffer).buffer);
    const sheet = workbook.worksheets[0];

    expect(output.mediaType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(sheet?.getCell('A1').value).toBe('Customer turnover');
    expect(sheet?.getCell('A7').value).toBe('Алфа Маркет ООД');
    expect(sheet?.getCell('C7').value).toBe(60);
    expect(sheet?.getCell('A8').value).toBe("'=unsafe spreadsheet text");
  });

  it('creates a PDF using the packaged Latin and Cyrillic fonts', async () => {
    const output = await renderFinanceReport('pdf', report);

    expect(output.mediaType).toBe('application/pdf');
    expect(output.buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(output.buffer.toString('latin1').match(/\/Type \/Page\b/gu)).toHaveLength(1);
    expect(output.buffer.length).toBeGreaterThan(2_000);
  });
});
