import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { fixtureId } from '../database/development-fixtures.js';
import { CreateSupplierInvoiceDto } from './procurement.dto.js';

describe('CreateSupplierInvoiceDto', () => {
  it('accepts a supplier invoice with a recorded standard VAT snapshot', async () => {
    const input = plainToInstance(CreateSupplierInvoiceDto, {
      invoiceDate: '2026-08-25',
      invoiceNumber: 'TEST-SUP-2026-001',
      lines: [
        {
          orderLineId: fixtureId('procurement-order-line:open-adapter'),
          quantity: '2',
          unitPrice: '12.50',
          vatTreatment: 'standard_20',
        },
      ],
      purchaseOrderId: fixtureId('procurement-order:open'),
    });

    expect(await validate(input)).toEqual([]);
  });

  it('rejects an intra-community acquisition without its recorded rate', async () => {
    const input = plainToInstance(CreateSupplierInvoiceDto, {
      invoiceDate: '2026-08-25',
      invoiceNumber: 'TEST-SUP-2026-002',
      lines: [
        {
          orderLineId: fixtureId('procurement-order-line:open-adapter'),
          quantity: '2',
          unitPrice: '12.50',
          vatTreatment: 'ica',
        },
      ],
      purchaseOrderId: fixtureId('procurement-order:open'),
    });

    const errors = await validate(input);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('lines');
    expect(errors[0]?.children?.[0]?.children?.map((error) => error.property)).toContain('vatRate');
  });
});
