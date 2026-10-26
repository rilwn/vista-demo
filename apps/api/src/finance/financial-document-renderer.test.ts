import type { FinancialDocument } from '@vista/contracts';
import { describe, expect, it } from 'vitest';
import { renderFinancialDocument } from './financial-document-renderer.js';
import { pdfTextWidth, pdfWrappedLines } from './financial-pdf-text.js';

const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQt9D/DwACZgF+JMBukQAAAABJRU5ErkJggg==',
  'base64',
);
const document: FinancialDocument = {
  id: '00000000-0000-4000-8000-000000000001',
  number: 'DINV-QA-1',
  officialNumber: '0000000042',
  documentType: 'invoice',
  status: 'issued',
  version: 2,
  createdAt: '2026-10-23T10:00:00Z',
  issuedAt: '2026-10-23T10:00:00Z',
  issuedByName: 'Test issuer',
  legalEntityId: '00000000-0000-4000-8000-000000000002',
  businessLocationId: '00000000-0000-4000-8000-000000000003',
  businessLocationName: 'Vratsa',
  branchName: 'Vratsa',
  customerPartnerId: '00000000-0000-4000-8000-000000000004',
  issuerSnapshot: {
    name: 'Vista QA / Тестова фирма',
    uic: '205555555',
    vatNumber: 'BG205555555',
    address: 'Vratsa / Враца, 1 Test Street',
  },
  customerSnapshot: {
    name: 'QA Customer / Клиент',
    uic: '205555556',
    vatNumber: 'BG205555556',
    address: '2 Test Street / Тестова улица',
  },
  issueDate: '2026-10-23',
  taxEventDate: '2026-10-23',
  dueDate: '2026-11-06',
  currencyCode: 'EUR',
  exchangeRate: '1.00000000',
  rateDate: '2026-10-23',
  rateSource: 'internal_eur',
  netTotal: '50.0000',
  vatTotal: '10.0000',
  grossTotal: '60.0000',
  eurNetTotal: '50.0000',
  eurVatTotal: '10.0000',
  eurGrossTotal: '60.0000',
  lines: [
    {
      id: '00000000-0000-4000-8000-000000000005',
      lineNumber: 1,
      description: 'Power adapter / Захранващ адаптер',
      unitCode: 'PCS',
      quantity: '1.0000',
      unitPrice: '50.0000',
      discountPercent: '0.0000',
      vatTreatment: 'standard_20',
      vatRate: '20.0000',
      netTotal: '50.0000',
      vatAmount: '10.0000',
      grossTotal: '60.0000',
    },
  ],
  vatSummary: [
    { netTotal: '50.0000', vatAmount: '10.0000', vatRate: '20.0000', vatTreatment: 'standard_20' },
  ],
  branding: { version: 1, signatoryName: 'Sample signer / Тестов подпис' },
};
describe('branded financial PDFs', () => {
  it('prints a compact issued page with logo and signature, but no signature image on a draft', async () => {
    const issued = await renderFinancialDocument(document, { logo: image, signature: image });
    const draft = await renderFinancialDocument(
      { ...document, status: 'draft' },
      { logo: image, signature: image },
    );
    expect(issued.subarray(0, 4).toString()).toBe('%PDF');
    expect(pageCount(issued)).toBe(1);
    expect(pageCount(draft)).toBe(1);
    expect(imageCount(issued)).toBeGreaterThan(imageCount(draft));
  });
  it('paginates long bilingual line descriptions and notes without dropping the final signature', async () => {
    const pdf = await renderFinancialDocument(
      {
        ...document,
        lines: Array.from({ length: 35 }, (_, index) => ({
          ...document.lines[0]!,
          id: `line-${index}`,
          lineNumber: index + 1,
          description:
            `${index + 1}. Replacement part / Резервна част. ` +
            'Checks and service / Проверки и обслужване. '.repeat(6),
        })),
        notes: 'Delivery and payment instructions / Условия за доставка и плащане. '.repeat(35),
      },
      { logo: image, signature: image },
    );
    expect(pageCount(pdf)).toBeGreaterThan(2);
    expect(imageCount(pdf)).toBeGreaterThan(1);
  });
  it('measures both scripts with their own font subset and preserves numbers while wrapping', () => {
    const fonts: string[] = [];
    const mock = {
      font(name: string) {
        fonts.push(name);
        return this;
      },
      fontSize() {
        return this;
      },
      widthOfString(value: string) {
        return value.length;
      },
    } as unknown as PDFKit.PDFDocument;
    expect(pdfTextWidth(mock, 'UIC / ЕИК: 205555555', 8)).toBe('UIC / ЕИК: 205555555'.length);
    expect(fonts).toContain('VistaLatin');
    expect(fonts).toContain('VistaCyrillic');
    expect(pdfWrappedLines(mock, 'BG205555555 / България', 12, 8).join(' ')).toBe(
      'BG205555555 / България',
    );
  });
});
function pageCount(pdf: Buffer) {
  return (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
}
function imageCount(pdf: Buffer) {
  return (pdf.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length;
}
describe('renderFinancialDocument', () => {
  it('renders an issued Bulgarian invoice as a printable PDF', async () => {
    const document: FinancialDocument = {
      branchName: 'Vratsa',
      businessLocationId: 'location-1',
      businessLocationName: 'Service Centre',
      createdAt: '2026-10-14T09:00:00.000Z',
      currencyCode: 'EUR',
      customerPartnerId: 'customer-1',
      customerSnapshot: {
        address: 'ул. „Христо Ботев“ 1, Враца',
        name: 'Тест Клиент ЕООД',
        uic: '123456789',
        vatNumber: 'BG123456789',
      },
      documentType: 'invoice',
      eurGrossTotal: '60.00',
      eurNetTotal: '50.00',
      eurVatTotal: '10.00',
      exchangeRate: '1.00000000',
      grossTotal: '60.00',
      id: 'document-1',
      issueDate: '2026-10-14',
      issuerSnapshot: {
        address: 'ул. „Козлодуй“ 10, Враца',
        name: 'Виста Сървис ООД',
        uic: '987654321',
        vatNumber: 'BG987654321',
      },
      legalEntityId: 'entity-1',
      lines: [
        {
          description: 'Сервизна услуга',
          discountPercent: '0.0000',
          grossTotal: '60.00',
          id: 'line-1',
          lineNumber: 1,
          netTotal: '50.00',
          quantity: '1.0000',
          unitCode: 'бр.',
          unitPrice: '50.00',
          vatAmount: '10.00',
          vatRate: '20.00',
          vatTreatment: 'standard_20',
        },
      ],
      netTotal: '50.00',
      number: 'FIN-DRAFT-1',
      officialNumber: '0000000001',
      rateDate: '2026-10-14',
      rateSource: 'EUR base currency',
      status: 'issued',
      taxEventDate: '2026-10-14',
      vatSummary: [
        {
          netTotal: '50.00',
          vatAmount: '10.00',
          vatRate: '20.00',
          vatTreatment: 'standard_20',
        },
      ],
      vatTotal: '10.00',
      version: 2,
    };

    const pdf = await renderFinancialDocument(document);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(2_000);
  });
});
