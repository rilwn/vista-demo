import { createRequire } from 'node:module';

import type { FinancialDocument, VatTreatment } from '@vista/contracts';
import PDFDocument from 'pdfkit';

const require = createRequire(import.meta.url);
const latinRegular = require.resolve('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff');
const latinBold = require.resolve('@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff');
const cyrillicRegular =
  require.resolve('@fontsource/noto-sans/files/noto-sans-cyrillic-400-normal.woff');
const cyrillicBold =
  require.resolve('@fontsource/noto-sans/files/noto-sans-cyrillic-700-normal.woff');

const pageLeft = 42;
const pageRight = 553;
const contentWidth = pageRight - pageLeft;

export async function renderFinancialDocument(documentData: FinancialDocument): Promise<Buffer> {
  const pdf = new PDFDocument({ margin: pageLeft, size: 'A4' });
  pdf.info.Author = documentData.issuerSnapshot.name;
  pdf.info.Creator = 'Vista Operations';
  pdf.info.Title = `${documentLabel(documentData.documentType)} ${documentData.officialNumber ?? documentData.number}`;
  pdf.registerFont('VistaLatin', latinRegular);
  pdf.registerFont('VistaLatinBold', latinBold);
  pdf.registerFont('VistaCyrillic', cyrillicRegular);
  pdf.registerFont('VistaCyrillicBold', cyrillicBold);

  const chunks: Buffer[] = [];
  pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });

  drawHeader(pdf, documentData);
  let y = 145;
  if (documentData.status !== 'issued') {
    pdf.roundedRect(pageLeft, y, contentWidth, 28, 6).fill('#fff3d9');
    drawText(pdf, 'DRAFT / ПРОЕКТ', pageLeft + 12, y + 8, 9, '#815b0b', true);
    y += 40;
  }
  y = drawParties(pdf, documentData, y);
  y = drawDates(pdf, documentData, y + 8);
  if (documentData.correctionOf) {
    y += 4;
    y = drawDetail(
      pdf,
      'Original invoice / Оригинална фактура',
      documentData.correctionOf.number,
      y,
    );
    if (documentData.correctionReason)
      y = drawDetail(pdf, 'Reason / Основание', documentData.correctionReason, y);
  }
  y += 14;
  y = drawLineTable(pdf, documentData, y);
  y = drawTotals(pdf, documentData, y + 14);
  if (documentData.notes) {
    y += 22;
    y = ensureSpace(pdf, y, 58);
    drawText(pdf, 'Notes / Бележки', pageLeft, y, 8, '#60736a', true);
    y += 14;
    pdf
      .font(fontFor(documentData.notes))
      .fontSize(8)
      .fillColor('#24382f')
      .text(documentData.notes, pageLeft, y, { width: contentWidth, lineGap: 2 });
    y = pdf.y + 14;
  }
  if (documentData.exchangeRate !== '1.00000000') {
    y = ensureSpace(pdf, y + 6, 32);
    drawText(
      pdf,
      `Accounting rate / Счетоводен курс: 1 ${documentData.currencyCode} = ${documentData.exchangeRate} EUR · ${formatDate(documentData.rateDate)} · ${documentData.rateSource}`,
      pageLeft,
      y,
      7,
      '#60736a',
    );
    y += 14;
    drawText(
      pdf,
      `Accounting total / Счетоводна стойност: ${money(documentData.eurGrossTotal, 'EUR')}`,
      pageLeft,
      y,
      8,
      '#24382f',
      true,
    );
  }
  drawSignature(pdf, documentData, Math.max(y + 22, pdf.page.height - 92));
  pdf.end();
  return finished;
}

function drawHeader(pdf: PDFKit.PDFDocument, data: FinancialDocument): void {
  pdf.roundedRect(pageLeft, 42, contentWidth, 87, 10).fill('#17382f');
  drawText(pdf, data.issuerSnapshot.name.toUpperCase(), pageLeft + 18, 55, 9, '#d5e9dd', true);
  drawText(
    pdf,
    `${documentLabel(data.documentType)} / ${documentLabelBg(data.documentType)}`,
    pageLeft + 18,
    75,
    19,
    '#ffffff',
    true,
  );
  const number = data.officialNumber ?? data.number;
  drawText(pdf, number, pageLeft + 18, 104, 10, '#e5f0e9', true);
  const state =
    data.status === 'issued'
      ? 'ISSUED / ИЗДАДЕН'
      : data.status === 'cancelled'
        ? 'CANCELLED / АНУЛИРАН'
        : 'DRAFT / ПРОЕКТ';
  pdf
    .font(fontFor(state, true))
    .fontSize(7)
    .fillColor('#ffffff')
    .text(state, pageRight - 160, 107, { width: 142, align: 'right', lineBreak: false });
}

function drawParties(pdf: PDFKit.PDFDocument, data: FinancialDocument, y: number): number {
  const gap = 24;
  const half = (contentWidth - gap) / 2;
  drawText(pdf, 'SUPPLIER / ДОСТАВЧИК', pageLeft, y, 7, '#60736a', true);
  drawText(pdf, 'CUSTOMER / КЛИЕНТ', pageLeft + half + gap, y, 7, '#60736a', true);
  y += 15;
  const leftY = drawParty(pdf, data.issuerSnapshot, pageLeft, y, half);
  const rightY = drawParty(pdf, data.customerSnapshot, pageLeft + half + gap, y, half);
  return Math.max(leftY, rightY) + 4;
}

function drawParty(
  pdf: PDFKit.PDFDocument,
  party: FinancialDocument['issuerSnapshot'],
  x: number,
  y: number,
  width: number,
): number {
  pdf
    .font(fontFor(party.name, true))
    .fontSize(9)
    .fillColor('#24382f')
    .text(party.name, x, y, { width, lineGap: 1 });
  y = pdf.y + 3;
  const identifiers = [
    party.uic ? `UIC / ЕИК: ${party.uic}` : '',
    party.vatNumber ? `VAT / ДДС: ${party.vatNumber}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  if (identifiers) {
    pdf
      .font(fontFor(identifiers))
      .fontSize(7)
      .fillColor('#60736a')
      .text(identifiers, x, y, { width, lineGap: 1 });
    y = pdf.y + 3;
  }
  pdf
    .font(fontFor(party.address))
    .fontSize(7)
    .fillColor('#465950')
    .text(party.address, x, y, { width, lineGap: 1 });
  return pdf.y + 5;
}

function drawDates(pdf: PDFKit.PDFDocument, data: FinancialDocument, y: number): number {
  const columns = [
    ['Document date / Дата', formatDate(data.issueDate)],
    ['Tax event / Данъчно събитие', formatDate(data.taxEventDate)],
    ['Due date / Падеж', data.dueDate ? formatDate(data.dueDate) : '—'],
  ];
  const columnWidth = contentWidth / columns.length;
  columns.forEach(([label, value], index) => {
    const x = pageLeft + index * columnWidth;
    drawText(pdf, label!, x, y, 7, '#60736a');
    drawText(pdf, value!, x, y + 14, 8, '#24382f', true);
  });
  return y + 34;
}

function drawDetail(pdf: PDFKit.PDFDocument, label: string, value: string, y: number): number {
  drawText(pdf, label, pageLeft, y, 7, '#60736a');
  pdf
    .font(fontFor(value))
    .fontSize(8)
    .fillColor('#24382f')
    .text(value, pageLeft + 180, y - 1, { width: contentWidth - 180, lineGap: 1 });
  return Math.max(y + 16, pdf.y + 3);
}

function drawLineTable(pdf: PDFKit.PDFDocument, data: FinancialDocument, y: number): number {
  const columns = [
    { key: 'description', label: 'Description / Описание', width: 168 },
    { key: 'quantity', label: 'Qty / Кол.', width: 43 },
    { key: 'unit', label: 'Unit / Ед.', width: 42 },
    { key: 'net', label: 'Net / Основа', width: 65 },
    { key: 'vatRate', label: 'VAT % / ДДС', width: 54 },
    { key: 'vat', label: 'VAT / Данък', width: 62 },
    { key: 'gross', label: 'Total / Общо', width: 77 },
  ];
  pdf.rect(pageLeft, y, contentWidth, 27).fill('#edf3ef');
  let x = pageLeft;
  for (const column of columns) {
    pdf
      .font(fontFor(column.label, true))
      .fontSize(6.4)
      .fillColor('#465850')
      .text(column.label, x + 4, y + 9, { width: column.width - 8, lineBreak: false });
    x += column.width;
  }
  y += 27;
  data.lines.forEach((line, index) => {
    const descriptionHeight = pdf
      .font(fontFor(line.description))
      .fontSize(7)
      .heightOfString(line.description, { width: columns[0]!.width - 10 });
    const rowHeight = Math.max(28, descriptionHeight + 12);
    if (y + rowHeight > pdf.page.height - 115) {
      pdf.addPage({ margin: pageLeft, size: 'A4' });
      y = 46;
      pdf.rect(pageLeft, y, contentWidth, 27).fill('#edf3ef');
      let headerX = pageLeft;
      for (const column of columns) {
        pdf
          .font(fontFor(column.label, true))
          .fontSize(6.4)
          .fillColor('#465850')
          .text(column.label, headerX + 4, y + 9, { width: column.width - 8, lineBreak: false });
        headerX += column.width;
      }
      y += 27;
    }
    if (index % 2 === 0) pdf.rect(pageLeft, y, contentWidth, rowHeight).fill('#fafcfb');
    const values = [
      line.description,
      line.quantity,
      line.unitCode,
      money(line.netTotal, data.currencyCode),
      vatTreatmentLabel(line.vatTreatment, line.vatRate),
      money(line.vatAmount, data.currencyCode),
      money(line.grossTotal, data.currencyCode),
    ];
    let cellX = pageLeft;
    values.forEach((value, cellIndex) => {
      const column = columns[cellIndex]!;
      pdf
        .font(fontFor(value, cellIndex === 6))
        .fontSize(6.8)
        .fillColor(cellIndex === 6 ? '#17382f' : '#24382f')
        .text(value, cellX + 4, y + 7, {
          width: column.width - 8,
          lineGap: 1,
          align: cellIndex >= 3 ? 'right' : 'left',
        });
      cellX += column.width;
    });
    pdf
      .moveTo(pageLeft, y + rowHeight)
      .lineTo(pageRight, y + rowHeight)
      .strokeColor('#d8e1dd')
      .lineWidth(0.5)
      .stroke();
    y += rowHeight;
  });
  return y;
}

function drawTotals(pdf: PDFKit.PDFDocument, data: FinancialDocument, y: number): number {
  y = ensureSpace(pdf, y, 100);
  const labelX = pageLeft + 300;
  const amountX = pageLeft + 398;
  const width = pageRight - amountX;
  const rows = [
    ['Net / Данъчна основа', money(data.netTotal, data.currencyCode)],
    ['VAT / ДДС', money(data.vatTotal, data.currencyCode)],
  ];
  rows.forEach(([label, amount], index) => {
    drawText(pdf, label!, labelX, y + index * 20, 8, '#60736a');
    pdf
      .font(fontFor(amount!, true))
      .fontSize(8)
      .fillColor('#24382f')
      .text(amount!, amountX, y + index * 20, { width, align: 'right', lineBreak: false });
  });
  y += 45;
  pdf.roundedRect(labelX - 8, y, pageRight - labelX + 8, 34, 6).fillAndStroke('#e9f1ec', '#cfddd4');
  drawText(pdf, 'TOTAL / ОБЩО', labelX + 4, y + 11, 9, '#17382f', true);
  pdf
    .font(fontFor(data.grossTotal, true))
    .fontSize(10)
    .fillColor('#17382f')
    .text(money(data.grossTotal, data.currencyCode), amountX, y + 10, {
      width,
      align: 'right',
      lineBreak: false,
    });
  return y + 34;
}

function drawSignature(pdf: PDFKit.PDFDocument, data: FinancialDocument, y: number): void {
  if (y > pdf.page.height - 86) {
    pdf.addPage({ margin: pageLeft, size: 'A4' });
    y = pdf.page.height - 86;
  }
  pdf
    .moveTo(pageLeft, y)
    .lineTo(pageLeft + 205, y)
    .strokeColor('#aabbb1')
    .lineWidth(0.7)
    .stroke();
  pdf
    .moveTo(pageRight - 205, y)
    .lineTo(pageRight, y)
    .strokeColor('#aabbb1')
    .lineWidth(0.7)
    .stroke();
  drawText(pdf, 'Issued by / Издал', pageLeft, y + 8, 7, '#60736a');
  if (data.issuedByName) drawText(pdf, data.issuedByName, pageLeft, y + 21, 8, '#24382f', true);
  drawText(pdf, 'Customer / Получател', pageRight - 205, y + 8, 7, '#60736a');
}

function ensureSpace(pdf: PDFKit.PDFDocument, y: number, height: number): number {
  if (y + height <= pdf.page.height - 112) return y;
  pdf.addPage({ margin: pageLeft, size: 'A4' });
  return 48;
}

function documentLabel(type: FinancialDocument['documentType']): string {
  return {
    invoice: 'Invoice',
    proforma: 'Proforma invoice',
    credit_note: 'Credit note',
    debit_note: 'Debit note',
  }[type];
}

function documentLabelBg(type: FinancialDocument['documentType']): string {
  return {
    invoice: 'Фактура',
    proforma: 'Проформа фактура',
    credit_note: 'Кредитно известие',
    debit_note: 'Дебитно известие',
  }[type];
}

function vatTreatmentLabel(treatment: VatTreatment, rate: string): string {
  const label = {
    standard_20: 'Standard / Стандартен',
    reduced_9: 'Reduced / Намален',
    zero: 'Zero / Нулев',
    exempt: 'Exempt / Освободен',
    ica: 'ICA / ВОП',
  }[treatment];
  return `${rate.replace(/\.0000$/u, '')}% ${label}`;
}

function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}

function money(value: string, currency: string): string {
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(value);
  if (!match) return `${value} ${currency}`;
  const fraction = (match[2] ?? '').padEnd(3, '0');
  let minor = BigInt(fraction.slice(0, 2));
  if ((fraction[2] ?? '0') >= '5') minor += 1n;
  let whole = BigInt(match[1]!);
  if (minor >= 100n) {
    whole += 1n;
    minor = 0n;
  }
  return `${whole.toString()}.${minor.toString().padStart(2, '0')} ${currency}`;
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

function drawText(
  pdf: PDFKit.PDFDocument,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  bold = false,
): void {
  pdf
    .font(fontFor(value, bold))
    .fontSize(size)
    .fillColor(color)
    .text(value, x, y, {
      width: Math.max(10, pageRight - x),
      lineBreak: false,
    });
}
