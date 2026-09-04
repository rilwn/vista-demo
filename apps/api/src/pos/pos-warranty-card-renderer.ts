import { createRequire } from 'node:module';

import PDFDocument from 'pdfkit';

export interface PosWarrantyCardPrintData {
  cardNumber: string;
  customerLocationName: string;
  customerName: string;
  fiscalReceiptNumber: string;
  issuedAt: string;
  issuerAddress: string;
  issuerName: string;
  productName: string;
  saleNumber: string;
  serialNumber: string;
  warrantyEndsOn: string;
  warrantyStartsOn: string;
}

const require = createRequire(import.meta.url);
const regularFont = require.resolve('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff');
const boldFont = require.resolve('@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff');
const cyrillicRegularFont =
  require.resolve('@fontsource/noto-sans/files/noto-sans-cyrillic-400-normal.woff');
const cyrillicBoldFont =
  require.resolve('@fontsource/noto-sans/files/noto-sans-cyrillic-700-normal.woff');

export async function renderPosWarrantyCard(data: PosWarrantyCardPrintData): Promise<Buffer> {
  const document = new PDFDocument({ margin: 42, size: 'A4' });
  document.info.Author = data.issuerName;
  document.info.Creator = 'Vista integrated information system';
  document.info.Title = `Warranty card ${data.cardNumber}`;
  document.registerFont('Vista', regularFont);
  document.registerFont('VistaBold', boldFont);
  document.registerFont('VistaCyrillic', cyrillicRegularFont);
  document.registerFont('VistaCyrillicBold', cyrillicBoldFont);
  const chunks: Buffer[] = [];
  document.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
  });

  document.roundedRect(42, 42, 511, 96, 14).fill('#17382f');
  document.font('VistaBold').fontSize(10).fillColor('#bcdcc7').text('VISTA SERVICE', 66, 65);
  document.fontSize(25).fillColor('#ffffff').text('Warranty card', 66, 83);
  document.font('Vista').fontSize(10).fillColor('#dfeae5').text(data.cardNumber, 66, 116);

  drawSection(document, 168, 'Covered equipment', [
    ['Product', data.productName],
    ['Serial number', data.serialNumber],
    ['Coverage', `${date(data.warrantyStartsOn)} – ${date(data.warrantyEndsOn)}`],
  ]);
  drawSection(document, 326, 'Customer', [
    ['Customer', data.customerName],
    ['Location', data.customerLocationName],
  ]);
  drawSection(document, 448, 'Sale reference', [
    ['Sale', data.saleNumber],
    ['Receipt', data.fiscalReceiptNumber],
    ['Issued', dateTime(data.issuedAt)],
  ]);

  document
    .font(fontFor(data.issuerName, true))
    .fontSize(9)
    .fillColor('#17382f')
    .text(data.issuerName, 42, 650, { width: 511 });
  document
    .font(fontFor(data.issuerAddress))
    .fontSize(8)
    .fillColor('#65736e')
    .text(data.issuerAddress, 42, 666, { width: 511 });
  document.moveTo(42, 708).lineTo(553, 708).strokeColor('#d8e1dd').lineWidth(1).stroke();
  document
    .fontSize(7.5)
    .fillColor('#65736e')
    .text(
      'Keep this card together with the receipt. Warranty service is subject to the agreed coverage conditions and verified serial number.',
      42,
      722,
      { lineGap: 3, width: 511 },
    );
  document.end();
  return finished;
}

function drawSection(
  document: PDFKit.PDFDocument,
  y: number,
  title: string,
  rows: Array<[string, string]>,
): void {
  const height = 54 + rows.length * 28;
  document.roundedRect(42, y, 511, height, 12).fillAndStroke('#f6f8f7', '#d8e1dd');
  document
    .font('VistaBold')
    .fontSize(11)
    .fillColor('#17382f')
    .text(title, 60, y + 18);
  rows.forEach(([label, value], index) => {
    const rowY = y + 49 + index * 28;
    document.font('Vista').fontSize(8).fillColor('#65736e').text(label, 60, rowY, { width: 120 });
    document.font(fontFor(value, true)).fontSize(9).fillColor('#263a33').text(value, 185, rowY, {
      ellipsis: true,
      width: 348,
    });
  });
}

function fontFor(value: string, bold = false): string {
  const cyrillic = /[\u0400-\u04ff]/u.test(value);
  return cyrillic ? (bold ? 'VistaCyrillicBold' : 'VistaCyrillic') : bold ? 'VistaBold' : 'Vista';
}

function date(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00Z`));
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    timeZone: 'Europe/Sofia',
    year: 'numeric',
  }).format(new Date(value));
}
