import { createRequire } from 'node:module';

import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { ReportExportFormat } from '@vista/contracts';

import type {
  FinanceReportExportColumn,
  FinanceReportExportData,
} from '../finance/finance-reports.service.js';

export interface RenderedFinanceReport {
  buffer: Buffer;
  extension: ReportExportFormat;
  mediaType: string;
}

const require = createRequire(import.meta.url);
const latinRegularFont =
  require.resolve('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff');
const latinBoldFont =
  require.resolve('@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff');
const cyrillicRegularFont =
  require.resolve('@fontsource/noto-sans/files/noto-sans-cyrillic-400-normal.woff');
const cyrillicBoldFont =
  require.resolve('@fontsource/noto-sans/files/noto-sans-cyrillic-700-normal.woff');

export async function renderFinanceReport(
  format: ReportExportFormat,
  data: FinanceReportExportData,
): Promise<RenderedFinanceReport> {
  if (format === 'csv') {
    return {
      buffer: renderCsv(data),
      extension: 'csv',
      mediaType: 'text/csv; charset=utf-8',
    };
  }
  if (format === 'xlsx') {
    return {
      buffer: await renderWorkbook(data),
      extension: 'xlsx',
      mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
  return {
    buffer: await renderPdf(data),
    extension: 'pdf',
    mediaType: 'application/pdf',
  };
}

function renderCsv(data: FinanceReportExportData): Buffer {
  const lines = [
    ['Report', data.title],
    ['Generated', data.generatedAt],
    ...data.criteria.map((criterion) => ['Filter', criterion]),
    [],
    data.columns.map((column) => column.label),
    ...data.rows.map((row) => data.columns.map((column) => csvValue(row[column.key], column))),
  ];
  return Buffer.from(`\uFEFF${lines.map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`);
}

async function renderWorkbook(data: FinanceReportExportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Vista Service';
  workbook.created = new Date(data.generatedAt);
  workbook.modified = new Date(data.generatedAt);
  const sheet = workbook.addWorksheet(safeSheetName(data.title), {
    pageSetup: { fitToPage: true, fitToWidth: 1, orientation: 'landscape', paperSize: 9 },
    views: [{ state: 'frozen', ySplit: data.criteria.length + 4 }],
  });
  sheet.addRow([data.title]);
  sheet.mergeCells(1, 1, 1, data.columns.length);
  const title = sheet.getCell(1, 1);
  title.font = { bold: true, color: { argb: 'FF17382F' }, size: 16 };
  title.alignment = { vertical: 'middle' };
  sheet.getRow(1).height = 28;
  sheet.addRow(['Generated', data.generatedAt]);
  for (const criterion of data.criteria) sheet.addRow(['Filter', criterion]);
  sheet.addRow([]);
  const headerRow = sheet.addRow(data.columns.map((column) => column.label));
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { pattern: 'solid', type: 'pattern', fgColor: { argb: 'FF17382F' } };
  headerRow.alignment = { vertical: 'middle' };
  headerRow.height = 22;

  for (const source of data.rows) {
    const row = sheet.addRow(
      data.columns.map((column) => workbookValue(source[column.key], column)),
    );
    row.eachCell((cell, columnIndex) => {
      const definition = data.columns[columnIndex - 1];
      if (definition?.type === 'money') cell.numFmt = '#,##0.00';
      if (definition?.type === 'number') cell.numFmt = '0';
      cell.alignment = { vertical: 'top', wrapText: true };
    });
  }

  data.columns.forEach((column, index) => {
    const maxContent = data.rows.reduce(
      (maximum, row) => Math.max(maximum, String(row[column.key] ?? '').length),
      column.label.length,
    );
    sheet.getColumn(index + 1).width = Math.min(Math.max(maxContent + 2, 12), 34);
  });
  sheet.autoFilter = {
    from: { column: 1, row: headerRow.number },
    to: { column: data.columns.length, row: headerRow.number },
  };
  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}

async function renderPdf(data: FinanceReportExportData): Promise<Buffer> {
  const document = new PDFDocument({
    bufferPages: true,
    layout: 'landscape',
    margin: 34,
    size: 'A4',
  });
  document.info.Author = 'Vista Service';
  document.info.CreationDate = new Date(data.generatedAt);
  document.info.Creator = 'Vista integrated information system';
  document.info.Title = data.title;
  document.registerFont('VistaLatin', latinRegularFont);
  document.registerFont('VistaLatinBold', latinBoldFont);
  document.registerFont('VistaCyrillic', cyrillicRegularFont);
  document.registerFont('VistaCyrillicBold', cyrillicBoldFont);
  const chunks: Buffer[] = [];
  document.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
  });

  drawPdfHeading(document, data);
  drawPdfTable(document, data);
  const range = document.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    document.switchToPage(index);
    document
      .font('VistaLatin')
      .fontSize(7)
      .fillColor('#63716c')
      .text(`Page ${index + 1} of ${range.count}`, 34, 555, {
        align: 'right',
        width: 773,
      });
  }
  document.end();
  return finished;
}

function drawPdfHeading(document: PDFKit.PDFDocument, data: FinanceReportExportData): void {
  document.font('VistaLatinBold').fontSize(18).fillColor('#17382f').text(data.title, 34, 30);
  document
    .font('VistaLatin')
    .fontSize(8)
    .fillColor('#63716c')
    .text(`Generated ${formatTimestamp(data.generatedAt)}`, 34, 57);
  document
    .fontSize(8)
    .fillColor('#33443e')
    .text(data.criteria.join('   •   '), 34, 73, { width: 773 });
  document.moveTo(34, 94).lineTo(807, 94).strokeColor('#dce5e1').lineWidth(1).stroke();
}

function drawPdfTable(document: PDFKit.PDFDocument, data: FinanceReportExportData): void {
  const left = 34;
  const width = 773;
  const rowHeight = 22;
  const widths = pdfColumnWidths(data.columns, width);
  let y = 106;

  const header = () => {
    document.rect(left, y, width, rowHeight).fill('#17382f');
    let x = left;
    data.columns.forEach((column, index) => {
      document
        .font('VistaLatinBold')
        .fontSize(6.4)
        .fillColor('#ffffff')
        .text(column.label, x + 4, y + 7, {
          align: column.type === 'money' || column.type === 'number' ? 'right' : 'left',
          ellipsis: true,
          height: rowHeight - 8,
          width: (widths[index] ?? 0) - 8,
        });
      x += widths[index] ?? 0;
    });
    y += rowHeight;
  };

  header();
  for (let rowIndex = 0; rowIndex < data.rows.length; rowIndex += 1) {
    if (y + rowHeight > 544) {
      document.addPage();
      y = 34;
      header();
    }
    if (rowIndex % 2 === 1) document.rect(left, y, width, rowHeight).fill('#f5f8f7');
    let x = left;
    const row = data.rows[rowIndex] ?? {};
    data.columns.forEach((column, index) => {
      const value = printableValue(row[column.key], column);
      const cyrillic = /[\u0400-\u04ff]/.test(value);
      document
        .font(cyrillic ? 'VistaCyrillic' : 'VistaLatin')
        .fontSize(6.4)
        .fillColor('#263932')
        .text(value, x + 4, y + 7, {
          align: column.type === 'money' || column.type === 'number' ? 'right' : 'left',
          ellipsis: true,
          height: rowHeight - 8,
          width: (widths[index] ?? 0) - 8,
        });
      x += widths[index] ?? 0;
    });
    document
      .moveTo(left, y + rowHeight)
      .lineTo(left + width, y + rowHeight)
      .strokeColor('#e4ebe8')
      .stroke();
    y += rowHeight;
  }
  if (!data.rows.length) {
    document
      .font('VistaLatin')
      .fontSize(9)
      .fillColor('#63716c')
      .text('No records matched the selected report.', left, y + 14, { align: 'center', width });
  }
}

function pdfColumnWidths(columns: FinanceReportExportColumn[], available: number): number[] {
  const weights = columns.map((column) => {
    if (column.key === 'partnerName') return 1.8;
    if (column.type === 'money') return 1.15;
    if (column.type === 'date') return 1;
    if (column.type === 'number') return 0.72;
    return 1.25;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => (weight / total) * available);
}

function workbookValue(
  value: number | string | undefined,
  column: FinanceReportExportColumn,
): number | string {
  if (column.type === 'money' || column.type === 'number') {
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) ? numeric : 0;
  }
  return safeSpreadsheetText(String(value ?? ''));
}

function csvValue(
  value: number | string | undefined,
  column: FinanceReportExportColumn,
): number | string {
  if (column.type === 'money' || column.type === 'number') return printableValue(value, column);
  return safeSpreadsheetText(String(value ?? ''));
}

function printableValue(
  value: number | string | undefined,
  column: FinanceReportExportColumn,
): string {
  if (column.type === 'money') {
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) ? numeric.toFixed(2) : '0.00';
  }
  return String(value ?? '');
}

function safeSpreadsheetText(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvCell(value: number | string): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function safeSheetName(value: string): string {
  return value.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31) || 'Report';
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Sofia',
  }).format(new Date(value));
}
