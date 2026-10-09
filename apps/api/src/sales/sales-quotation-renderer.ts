import { createRequire } from 'node:module';

import type { SalesWorkflow } from '@vista/contracts';
import PDFDocument from 'pdfkit';

const require = createRequire(import.meta.url);
const latinRegular = require.resolve('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff');
const latinBold = require.resolve('@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff');
const cyrillicRegular =
  require.resolve('@fontsource/noto-sans/files/noto-sans-cyrillic-400-normal.woff');
const cyrillicBold =
  require.resolve('@fontsource/noto-sans/files/noto-sans-cyrillic-700-normal.woff');

export async function renderSalesQuotation(workflow: SalesWorkflow): Promise<Buffer> {
  const document = new PDFDocument({ margin: 42, size: 'A4' });
  document.info.Author = 'Vista Service Ltd.';
  document.info.Creator = 'Vista Operations';
  document.info.Title = `Quotation ${workflow.number}`;
  document.registerFont('VistaLatin', latinRegular);
  document.registerFont('VistaLatinBold', latinBold);
  document.registerFont('VistaCyrillic', cyrillicRegular);
  document.registerFont('VistaCyrillicBold', cyrillicBold);

  const chunks: Buffer[] = [];
  document.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
  });

  const left = 42;
  const right = 553;
  const width = right - left;
  document.roundedRect(left, 42, width, 100, 12).fill('#17382f');
  drawText(document, 'VISTA SERVICE LTD.', left + 22, 59, 9, '#cce4d5', true);
  drawText(document, 'Quotation / Оферта', left + 22, 80, 22, '#ffffff', true);
  drawText(document, workflow.number, left + 22, 112, 10, '#e0ece5');

  let y = 164;
  y = drawDetail(document, left, y, 'Customer / Клиент', workflow.customerName);
  y = drawDetail(document, left, y, 'Quotation date / Дата', formatDate(workflow.createdAt));
  y = drawDetail(document, left, y, 'Valid until / Валидна до', formatDate(workflow.validUntil));
  y = drawDetail(document, left, y, 'Warehouse / Склад', workflow.warehouseName);
  y += 17;

  const columns = [
    { label: 'Product / Продукт', x: left, width: 228 },
    { label: 'Qty / Кол.', x: 274, width: 55 },
    { label: 'Unit price / Цена', x: 333, width: 82 },
    { label: 'Discount / Отстъпка', x: 420, width: 68 },
    { label: 'Net / Нетно', x: 493, width: 60 },
  ];
  drawTableHeader(document, columns, y);
  y += 32;

  for (const [index, line] of workflow.lines.entries()) {
    const descriptionHeight = document
      .font('VistaLatin')
      .fontSize(8.5)
      .heightOfString(line.productName, { width: columns[0]!.width - 12 });
    const rowHeight = Math.max(34, descriptionHeight + 14);
    if (y + rowHeight > document.page.height - 130) {
      document.addPage();
      y = 52;
      drawTableHeader(document, columns, y);
      y += 32;
    }
    if (index % 2 === 0) document.rect(left, y, width, rowHeight).fill('#f5f8f6');
    document
      .font(fontFor(line.productName))
      .fontSize(8.5)
      .fillColor('#263a33')
      .text(line.productName, columns[0]!.x + 6, y + 8, {
        width: columns[0]!.width - 12,
      });
    drawText(document, line.quantity, columns[1]!.x + 5, y + 9, 8.5, '#263a33');
    drawText(
      document,
      money(line.unitPrice, workflow.currencyCode),
      columns[2]!.x + 4,
      y + 9,
      8,
      '#263a33',
    );
    drawText(document, `${line.discountPercent}%`, columns[3]!.x + 4, y + 9, 8, '#263a33');
    drawText(
      document,
      money(line.lineTotal, workflow.currencyCode),
      columns[4]!.x + 4,
      y + 9,
      8,
      '#263a33',
    );
    document
      .moveTo(left, y + rowHeight)
      .lineTo(right, y + rowHeight)
      .strokeColor('#d8e1dd')
      .lineWidth(0.6)
      .stroke();
    y += rowHeight;
  }

  y += 20;
  if (y + 112 > document.page.height - 55) {
    document.addPage();
    y = 56;
  }
  drawTotal(
    document,
    left + 292,
    y,
    'Subtotal / Данъчна основа',
    money(workflow.subtotal, workflow.currencyCode),
  );
  drawTotal(
    document,
    left + 292,
    y + 25,
    'VAT / ДДС',
    money(workflow.vatTotal, workflow.currencyCode),
  );
  document.roundedRect(left + 286, y + 51, width - 286, 38, 7).fillAndStroke('#e9f1ec', '#cfddd4');
  drawText(document, 'Total / Общо', left + 298, y + 63, 10, '#17382f', true);
  drawText(
    document,
    money(workflow.total, workflow.currencyCode),
    left + 398,
    y + 63,
    10,
    '#17382f',
    true,
  );
  drawText(
    document,
    'Commercial quotation, not a tax invoice. / Търговска оферта, не е данъчна фактура.',
    left,
    y + 105,
    8,
    '#63716c',
  );
  document.end();
  return finished;
}

function drawTableHeader(
  document: PDFKit.PDFDocument,
  columns: Array<{ label: string; x: number; width: number }>,
  y: number,
): void {
  document.rect(42, y, 511, 28).fill('#edf3ef');
  for (const column of columns) {
    document
      .font(fontFor(column.label, true))
      .fontSize(7)
      .fillColor('#465850')
      .text(column.label, column.x + 5, y + 9, { width: column.width - 8, lineBreak: false });
  }
}

function drawDetail(
  document: PDFKit.PDFDocument,
  x: number,
  y: number,
  label: string,
  value: string,
) {
  drawText(document, label, x, y, 8, '#63716c');
  document
    .font(fontFor(value, true))
    .fontSize(9)
    .fillColor('#263a33')
    .text(value, x + 154, y - 1, { width: 350, ellipsis: true, lineBreak: false });
  document
    .moveTo(x, y + 17)
    .lineTo(553, y + 17)
    .strokeColor('#e1e8e4')
    .lineWidth(0.6)
    .stroke();
  return y + 28;
}

function drawTotal(
  document: PDFKit.PDFDocument,
  x: number,
  y: number,
  label: string,
  value: string,
): void {
  drawText(document, label, x, y, 8.5, '#63716c');
  document
    .font(fontFor(value, true))
    .fontSize(8.5)
    .fillColor('#263a33')
    .text(value, x + 150, y, { align: 'right', width: 65, lineBreak: false });
}

function drawText(
  document: PDFKit.PDFDocument,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  bold = false,
): void {
  document.font(fontFor(value, bold)).fontSize(size).fillColor(color).text(value, x, y, {
    lineBreak: false,
  });
}

function fontFor(value: string, bold = false): string {
  const cyrillic = /[\u0400-\u04ff]/u.test(value);
  return cyrillic
    ? bold
      ? 'VistaCyrillicBold'
      : 'VistaCyrillic'
    : bold
      ? 'VistaLatinBold'
      : 'VistaLatin';
}

function money(value: string, currency: string): string {
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(value);
  if (!match) return `${value} ${currency}`;
  const whole = BigInt(match[1]!);
  const fractional = (match[2] ?? '').padEnd(3, '0');
  let minor = BigInt(fractional.slice(0, 2));
  if ((fractional[2] ?? '0') >= '5') minor += 1n;
  const roundedWhole = whole + (minor >= 100n ? 1n : 0n);
  if (minor >= 100n) minor = 0n;
  const grouped = roundedWhole.toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  return `${grouped}.${minor.toString().padStart(2, '0')} ${currency}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value));
}
