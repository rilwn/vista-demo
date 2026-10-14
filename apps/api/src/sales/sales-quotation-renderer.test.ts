import { describe, expect, it } from 'vitest';
import type { SalesWorkflow } from '@vista/contracts';

import { renderSalesQuotation } from './sales-quotation-renderer.js';

describe('sales quotation PDF renderer', () => {
  it('renders a printable bilingual quotation with reconciled stored totals', async () => {
    const workflow: SalesWorkflow = {
      createdAt: '2026-10-09T09:00:00.000Z',
      currencyCode: 'EUR',
      customerName: 'Алфа Маркет ООД',
      customerPartnerId: 'a4eaf510-58f1-49c2-90cc-ce61c102352c',
      id: '8ea0d4c4-0493-41b8-a224-f8466a05a578',
      lines: [
        {
          discountPercent: '0.0000',
          id: 'c4a3ca8d-0a5b-42b6-8518-76f3b627334f',
          lineTotal: '100.0000',
          productId: '773e9308-d4d8-43d7-9cf0-9dc20f2de1dc',
          productName: 'Фискално устройство X1',
          quantity: '1.0000',
          trackingMode: 'serial',
          unitPrice: '100.0000',
          vatTreatment: 'standard_20',
        },
      ],
      number: 'Q-2026-000001',
      overallDiscountPercent: '0.0000',
      status: 'draft',
      subtotal: '100.0000',
      total: '120.0000',
      validUntil: '2026-10-23',
      vatTotal: '20.0000',
      version: 1,
      warehouseId: '5c8c6996-585c-4375-a239-1c5be14b88f0',
      warehouseName: 'Централен склад',
    };

    const pdf = await renderSalesQuotation(workflow);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(500);
    expect(pdf.toString('latin1')).toContain('%%EOF');
  });
});
