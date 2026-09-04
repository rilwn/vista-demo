import { describe, expect, it } from 'vitest';

import { renderPosWarrantyCard } from './pos-warranty-card-renderer.js';

describe('POS warranty-card renderer', () => {
  it('renders a printable PDF with the card and serial references', async () => {
    const result = await renderPosWarrantyCard({
      cardNumber: 'WCR-POS-01-2026-000001',
      customerLocationName: 'Central Store',
      customerName: 'Alfa Market Demo Ltd.',
      fiscalReceiptNumber: 'SIM-RECEIPT-01-2026-000001',
      issuedAt: '2026-09-05T09:30:00.000Z',
      issuerAddress: 'Vratsa, Bulgaria',
      issuerName: 'Vista Demo Ltd.',
      productName: 'Demo Fiscal Register X1',
      saleNumber: 'SALE-POS-01-2026-000001',
      serialNumber: 'DEMO-FR-STOCK-01',
      warrantyEndsOn: '2028-09-05',
      warrantyStartsOn: '2026-09-05',
    });

    expect(result.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(result.length).toBeGreaterThan(1_000);
  });
});
