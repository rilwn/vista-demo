import { describe, expect, it } from 'vitest';
import type { FinancialDocument } from '@vista/contracts';

import { renderFinancialDocument } from './financial-document-renderer.js';

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
